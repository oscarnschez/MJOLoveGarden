"use strict";
(() => {
  // Cada usuario se identifica por el SHA-256 de su nombre en minúsculas.
  // Las contraseñas solo se guardan como PBKDF2-SHA256 con sal propia.
  const USERS = {
    "af1136eedf0bd54c1af9b0393fafb6134159cc9d999c8d40eb0770bb490afb16": {
      salt: "MRy69WqxJVJzHBOaV2x29A==",
      hash: "vLhBWoUJIvgczqn0/VE/kfcdYKPYCFHgrA6/ll+ZPOw=",
    },
    "613f96aa61ea3ac01624993f9fa1ccb559cdc3d7b47bb268b6903d5c0e0d2ab7": {
      salt: "smVabpN59dgEYjUA4bvjhw==",
      hash: "E6XGkQbTPe/c1t4MgmuOGabzNt0UrlwBO7UgePJIQoA=",
    },
  };
  const ITERATIONS = 600000;
  const SESSION_KEY = "jardin-sesion";
  const appSrc = document.currentScript.dataset.app;

  const enc = new TextEncoder();
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function userKey(name) {
    const digest = await crypto.subtle.digest("SHA-256", enc.encode(name.trim().toLowerCase()));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function verify(name, password) {
    const key = await userKey(name);
    const user = USERS[key];
    if (!user) return null;
    const material = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: fromB64(user.salt), iterations: ITERATIONS },
      material,
      256
    );
    return toB64(bits) === user.hash ? key : null;
  }

  function startApp() {
    const s = document.createElement("script");
    s.src = appSrc;
    document.body.append(s);
  }

  // La sesión se recuerda en este dispositivo hasta cerrar sesión.
  function readSession() {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  function saveSession(key) {
    try {
      localStorage.setItem(SESSION_KEY, key);
    } catch {}
  }

  window.jardinSesion = {
    cerrar() {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch {}
      location.reload();
    },
  };

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    node.append(...children);
    return node;
  }

  function field(id, label, attrs) {
    const input = el("input", { id, required: "", ...attrs });
    return { input, wrap: el("div", { class: "field" }, el("label", { for: id }, label), input) };
  }

  function showLogin() {
    const user = field("login-user", "Usuario", {
      type: "text",
      name: "username",
      autocomplete: "username",
      autocapitalize: "none",
      autocorrect: "off",
      spellcheck: "false",
      maxlength: "60",
    });
    const pass = field("login-pass", "Contraseña", {
      type: "password",
      name: "password",
      autocomplete: "current-password",
      maxlength: "200",
    });
    const error = el("p", { class: "login-error", role: "alert", hidden: "" });
    const submit = el("button", { class: "btn primary block", type: "submit" }, "Entrar");
    const form = el(
      "form",
      { class: "login-card", novalidate: "" },
      el("img", { class: "login-icon", src: "icons/icon.svg", alt: "", width: "72", height: "72" }),
      el("h1", {}, "Nuestro jardín"),
      el("p", { class: "tagline" }, "Inicia sesión para entrar."),
      user.wrap,
      pass.wrap,
      error,
      submit
    );
    const screen = el("section", { class: "login", "aria-label": "Iniciar sesión" }, form);

    const fail = (message, input) => {
      error.textContent = message;
      error.hidden = false;
      input.focus();
      input.select();
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!user.input.value.trim()) return fail("Escribe tu usuario.", user.input);
      if (!pass.input.value) return fail("Escribe tu contraseña.", pass.input);
      if (!crypto.subtle) return fail("Abre el jardín desde una dirección segura (https).", user.input);
      submit.disabled = true;
      submit.textContent = "Entrando…";
      error.hidden = true;
      try {
        const key = await verify(user.input.value, pass.input.value);
        if (!key) return fail("Usuario o contraseña incorrectos.", pass.input);
        saveSession(key);
        screen.remove();
        startApp();
      } finally {
        submit.disabled = false;
        submit.textContent = "Entrar";
      }
    });

    document.body.prepend(screen);
    user.input.focus();
  }

  const session = readSession();
  if (session && Object.hasOwn(USERS, session)) startApp();
  else showLogin();
})();
