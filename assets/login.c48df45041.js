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
  const engineSrc = document.currentScript.dataset.engine;
  const soundSrc = document.currentScript.dataset.sound;
  const AUTHOR = "Oscar A. Sánchez";
  const version = document.documentElement.dataset.version;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  // Carga el sonido, el motor 3D y la app (se descargan en paralelo y se ejecutan en orden) y se
  // resuelve cuando la app ya pintó su primera pantalla. Si el motor 3D no carga, la app usa el 2D.
  function startApp() {
    return new Promise((resolve) => {
      const host = document.getElementById("app");
      const t0 = performance.now();
      const ready = () =>
        host.childElementCount || performance.now() - t0 > 4000
          ? requestAnimationFrame(() => requestAnimationFrame(resolve))
          : setTimeout(ready, 50);
      const load = (src) => {
        const s = document.createElement("script");
        s.async = false;
        s.src = src;
        document.body.append(s);
        return s;
      };
      if (soundSrc) load(soundSrc);
      if (engineSrc) load(engineSrc);
      const s = load(appSrc);
      s.onload = ready;
      s.onerror = resolve;
    });
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

  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  // Pétalos que salen de un capullo (coordenadas de pantalla).
  function burst(layer, x, y) {
    const colors = ["#ff66c4", "#ff8fd3", "#ffc2e6", "#fde3f1"];
    for (let i = 0; i < 9; i++) {
      const angle = ((-90 + (Math.random() - 0.5) * 150) * Math.PI) / 180;
      const dist = 90 + Math.random() * 170;
      const petal = el("i", { class: "je-petal" });
      petal.style.cssText =
        `--x:${x}px;--y:${y}px;--tx:${Math.cos(angle) * dist}px;--ty:${Math.sin(angle) * dist}px;` +
        `--r:${(Math.random() - 0.5) * 720}deg;--s:${0.7 + Math.random() * 0.7};` +
        `--d:${Math.random() * 180}ms;--t:${1500 + Math.random() * 900}ms;background:${colors[i % colors.length]}`;
      layer.append(petal);
    }
  }

  // Abre un hueco circular con borde suave que crece desde (x, y) hasta cubrir la pantalla.
  function reveal(node, x, y, ms) {
    const feather = 70;
    const max = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + feather;
    const t0 = performance.now();
    return new Promise((done) => {
      const frame = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        const eased = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        const r = eased * max - feather;
        const mask = `radial-gradient(circle at ${x}px ${y}px, transparent ${r}px, #000 ${r + feather}px)`;
        node.style.webkitMaskImage = node.style.maskImage = mask;
        if (p < 1) requestAnimationFrame(frame);
        else done();
      };
      requestAnimationFrame(frame);
    });
  }

  // Después de iniciar sesión: el logo pasa al centro, las dos flores vuelven a crecer,
  // florecen soltando pétalos y el jardín se abre desde ellas. Tocar la pantalla la salta.
  async function playIntro(screen, logo, body, appReady) {
    body.inert = true;
    document.activeElement?.blur?.();
    screen.setAttribute("aria-hidden", "true");
    screen.classList.add("is-leaving");
    const svg = logo.querySelector("svg");
    const petals = el("div", { class: "je-petals", "aria-hidden": "true" });
    let ended = false;
    const end = async (fast) => {
      if (ended) return;
      ended = true;
      await appReady;
      if (fast) {
        screen.classList.add("is-gone");
        petals.classList.add("is-gone");
        await wait(380);
      }
      screen.remove();
      setTimeout(() => petals.remove(), fast ? 0 : 2200);
    };
    screen.addEventListener("pointerdown", () => end(true), { once: true });
    if (!svg || matchMedia("(prefers-reduced-motion: reduce)").matches) return end(true);

    await wait(260); // deja que se cierre el teclado antes de medir
    if (ended) return;
    const r = logo.getBoundingClientRect();
    const scale = Math.min(innerWidth * 0.88, 560) / r.width;
    const dx = innerWidth / 2 - (r.left + r.width / 2);
    const dy = innerHeight / 2 - (r.top + r.height / 2);
    const centered = `translate(${dx}px, ${dy}px) scale(${scale})`;
    logo.style.transform = centered;
    await wait(560);
    if (ended) return;

    for (const stem of svg.querySelectorAll(".stem")) stem.style.setProperty("--len", `${stem.getTotalLength() + 2}px`);
    screen.classList.add("is-growing");
    await wait(1750);
    if (ended) return;

    const buds = [...svg.querySelectorAll(".bud")].map((b) => b.getBoundingClientRect());
    const cx = buds.reduce((sum, b) => sum + b.left + b.width / 2, 0) / buds.length;
    const cy = buds.reduce((sum, b) => sum + b.top + b.height / 2, 0) / buds.length;
    const glow = el("i", { class: "je-glow" });
    glow.style.cssText = `--x:${cx}px;--y:${cy}px`;
    petals.append(glow);
    document.body.append(petals);
    for (const b of buds) burst(petals, b.left + b.width / 2, b.top + b.height / 2);
    await wait(450);
    if (ended) return;

    await appReady;
    if (ended) return;
    logo.style.transform = `${centered} scale(1.35)`;
    screen.classList.add("is-revealing");
    await reveal(screen, cx, cy, 950);
    end(false);
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
    const logo = el("h1", { class: "login-logo" });
    // El SVG viene de assets/logo.*.js, un archivo propio generado desde el logo.
    if (window.jardinLogo) logo.innerHTML = window.jardinLogo;
    else logo.textContent = "Jardín Eterno";
    const body = el(
      "div",
      { class: "login-body" },
      el("p", { class: "tagline" }, "Inicia sesión para entrar."),
      user.wrap,
      pass.wrap,
      error,
      submit
    );
    const form = el("form", { class: "login-card", novalidate: "" }, logo, body);
    const foot = el("p", { class: "login-foot" }, `${version ? `v${version} · ` : ""}© 2026 ${AUTHOR}`);
    const screen = el("section", { class: "login", "aria-label": "Iniciar sesión" }, form, foot);

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
        playIntro(screen, logo, body, startApp());
      } finally {
        submit.disabled = false;
        submit.textContent = "Entrar";
      }
    });

    document.body.prepend(screen);
    return { screen, logo, focus: () => user.input.focus() };
  }

  // Pantalla de apertura: logo, autor, versión y copyright. Se ve cada vez que se abre la app,
  // mientras carga lo demás; tocarla la acorta.
  function openSplash() {
    const splash = document.getElementById("splash");
    if (!splash) return null;
    const logo = el("div", { class: "splash-logo" });
    if (window.jardinLogo) logo.innerHTML = window.jardinLogo;
    else logo.textContent = "Jardín Eterno";
    splash.append(
      el("div", { class: "splash-center" }, logo, el("p", { class: "splash-author" }, el("span", {}, "Creado por"), ` ${AUTHOR}`)),
      el("p", { class: "splash-foot" }, `${version ? `Versión ${version} · ` : ""}© 2026 ${AUTHOR}`),
    );
    splash.setAttribute("aria-label", `Jardín Eterno, creado por ${AUTHOR}`);
    const svg = logo.querySelector("svg");
    for (const stem of svg?.querySelectorAll(".stem") ?? []) stem.style.setProperty("--len", `${stem.getTotalLength() + 2}px`);
    requestAnimationFrame(() => splash.classList.add("is-playing"));
    let skip;
    const skipped = new Promise((done) => (skip = done));
    splash.addEventListener("pointerdown", () => skip(), { once: true });
    const shown = Promise.race([wait(reduced ? 1200 : 2600), skipped]);
    return { splash, logo, svg, shown };
  }

  // La apertura se convierte en el inicio de sesión: el logo sube a su lugar y aparece el formulario.
  async function splashToLogin(sp, login) {
    const a = sp.logo.getBoundingClientRect(), b = login.logo.getBoundingClientRect();
    sp.splash.classList.add("is-leaving");
    login.screen.classList.add("is-arriving");
    if (!reduced && a.width && b.width) {
      const k = b.width / a.width;
      sp.logo.style.transform = `translate(${b.left + b.width / 2 - (a.left + a.width / 2)}px, ${b.top + b.height / 2 - (a.top + a.height / 2)}px) scale(${k})`;
      await wait(700);
    }
    login.screen.classList.remove("is-waiting", "is-arriving");
    sp.splash.remove();
    login.focus();
  }

  // Con la sesión guardada, el jardín se abre desde las flores del logo.
  async function splashToGarden(sp, appReady) {
    await appReady;
    if (reduced || !sp.svg) {
      sp.splash.classList.add("is-gone");
      await wait(350);
      sp.splash.remove();
      return;
    }
    const buds = [...sp.svg.querySelectorAll(".bud")].map((n) => n.getBoundingClientRect());
    const cx = buds.reduce((sum, n) => sum + n.left + n.width / 2, 0) / buds.length;
    const cy = buds.reduce((sum, n) => sum + n.top + n.height / 2, 0) / buds.length;
    sp.splash.classList.add("is-revealing");
    sp.logo.style.transform = "scale(1.3)";
    await reveal(sp.splash, cx, cy, 950);
    sp.splash.remove();
  }

  const session = readSession();
  const sp = openSplash();
  if (session && Object.hasOwn(USERS, session)) {
    const ready = startApp();
    if (sp) sp.shown.then(() => splashToGarden(sp, ready));
  } else {
    const login = showLogin();
    if (sp) {
      login.screen.classList.add("is-waiting");
      sp.shown.then(() => splashToLogin(sp, login));
    } else login.focus();
  }
})();
