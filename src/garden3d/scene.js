// Escena 3D del jardín. Tiene la misma interfaz que la escena 2D de la app, así que la app
// no necesita saber cuál está usando. Si WebGL falla o se pierde, cambia sola a la 2D.
import { Camera3D } from "./camera.js";
import { bindAttribs, buffer, createProgram, dataTexture, loadImage, texture } from "./gl.js";
import { BED_H, blobTexture, buildGround, buildPaths, clearingTexture } from "./ground.js";
import { Grass, loadGrass } from "./grass.js";
import { clamp, hashString, hexToRgb, lerp, rng } from "./math.js";
import { buildMilestoneRing, buildPlant } from "./plants.js";
import { buildTree } from "./trees.js";
import * as SH from "./shaders.js";

const PLANT_LAYOUT = [
  { name: "a_pos", size: 3, offset: 0 },
  { name: "a_nrm", size: 3, offset: 3 },
  { name: "a_col", size: 3, offset: 6 },
  { name: "a_mat", size: 2, offset: 9 },
];
const INST = 24; // floats por instancia de planta
const INST_LAYOUT = [
  { name: "i_a", size: 4, offset: 0 },
  { name: "i_b", size: 4, offset: 4 },
  { name: "i_c", size: 4, offset: 8 },
  { name: "i_light", size: 3, offset: 12 },
  { name: "i_base", size: 3, offset: 15 },
  { name: "i_deep", size: 3, offset: 18 },
  { name: "i_center", size: 3, offset: 21 },
];
const SAND = hexToRgb("#e6dcc4"), SAND_EDGE = hexToRgb("#c9bb98"), MEADOW = hexToRgb("#b8c99f");
const rgb255 = (c) => [c[0] / 255, c[1] / 255, c[2] / 255];

// Árboles de nacimiento: roble para la primera persona y cerezo en flor para la segunda.
const TREES = [
  { angle: 222, bar: "#6f9a5b", palette: { light: "#9fc47a", base: "#689652", deep: "#3c663a", center: "#6b4f3a" } },
  { angle: 318, bar: "#e58fb8", palette: { light: "#fcd9e7", base: "#f0a8c5", deep: "#d4799f", center: "#5a3e36" } },
];

// Edad entre dos fechas AAAA-MM-DD (hoy, en la zona horaria del jardín) y avance hacia el siguiente cumpleaños.
export function treeAge(birth, today) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/, b = re.exec(birth ?? ""), t = re.exec(today ?? "");
  if (!b || !t || birth > today) return null;
  const [by, bm, bd] = b.slice(1).map(Number), ty = +t[1];
  const day = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;
  const leap = (y) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  // Quien nació un 29 de febrero celebra el 28 en los años que no son bisiestos.
  const bday = (y) => day(y, bm, bm === 2 && bd === 29 && !leap(y) ? 28 : bd);
  const now = day(ty, +t[2], +t[3]);
  const lastY = bday(ty) <= now ? ty : ty - 1, last = bday(lastY), next = bday(lastY + 1);
  const years = lastY - by, progress = (now - last) / (next - last);
  return {
    years,
    months: Math.floor((now - day(by, bm, bd)) / 30.4375),
    progress,
    age: years + progress,
    birthday: now === last && years > 0,
    daysToNext: next - now,
    nextDate: new Date(next * 864e5).toISOString().slice(0, 10),
  };
}

export class Scene3D {
  constructor(host, events, deps) {
    this.host = host;
    this.events = events;
    this.deps = deps;
    this.H = deps.H;
    this.camera = new Camera3D(deps.H);
    this.world = null;
    this.water = new deps.Water();
    this.life = new deps.Life();
    this.dpr = 1;
    this.maxDpr = 2;
    this.width = 0;
    this.height = 0;
    this.raf = 0;
    this.lastT = 0;
    this.running = false;
    this.dirty = true;
    this.mode = "explore";
    this.selected = null;
    this.reactions = new Map();
    this.wetUntil = new Map();
    this.appear = new Map();
    this.highlights = new Map();
    this.highlightColor = "#B7A5CE";
    this.motion = true;
    this.reduceEffects = false;
    this.look = deps.looks.tarde;
    this.lookFrom = this.look;
    this.lookTo = this.look;
    this.lookT0 = 0;
    this.frameTimes = [];
    this.quality = 2;
    this.qualityCap = 2;
    this.lastQualityChange = 0;
    this.emptyBed = false;
    this.lastActive = 0;
    this.lastRender = 0;
    this.continuous = false;
    this.fb = null;
    this.errors = 0;
    this.worldVersion = -1;
    this.overlayDirty = false;
    this.t0 = performance.now();
    this.groups = new Map();
    this.byDay = new Map();
    this.treeGroups = new Map();
    this.treeInput = [];
    this.trees = [];
    this.treeFocus = null;
    this.treeShadow = new Float32Array(0);
    this.plantShadow = new Float32Array(0);
    this.bounds = null;
    this.entered = false;
    this.loop = (now) => this.tick(now);

    this.canvas = document.createElement("canvas");
    this.canvas.className = "garden-canvas";
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-roledescription", "jardín interactivo");
    this.overlay = document.createElement("canvas");
    this.overlay.setAttribute("aria-hidden", "true");
    this.overlay.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none";
    const gl = this.canvas.getContext("webgl2", { antialias: true, alpha: false, depth: true, stencil: false, powerPreference: "default" });
    if (!gl) throw new Error("WebGL2 no disponible");
    this.gl = gl;
    this.ctx = this.overlay.getContext("2d");
    host.append(this.canvas, this.overlay);
    // Safari puede quitar WebGL a las páginas en segundo plano: se espera a que lo devuelva
    // y, si no llega en 3 s con la página visible, se usa el jardín 2D.
    this.canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.lost = true;
      this.stop();
      this.armLossTimer();
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      clearTimeout(this.lossTimer);
      this.restoreGL();
      this.start();
    });
    this.initGL();
    this.loadAssets(deps.assets);

    this.life.setTargetPicker(() => this.pickLifeTarget());
    this.detach = deps.input(this.canvas, {
      mode: () => this.mode,
      interaction: () => {
        this.events.onInteraction();
        this.camera.stopMotion();
        this.invalidate();
      },
      tap: (x, y) => this.handleTap(x, y),
      pan: (dx, dy) => {
        this.camera.panBy(dx, dy);
        this.invalidate();
      },
      panEnd: (vx, vy) => {
        if (this.motion) this.camera.setVelocity(clamp(vx, -3, 3), clamp(vy, -3, 3));
        this.invalidate();
      },
      zoom: (f, x, y) => {
        this.camera.zoomAt(f, x, y);
        this.invalidate();
      },
      waterStart: (x, y) => {
        this.water.start(x, y, performance.now());
        this.events.onWaterActive(true);
        this.waterTick();
        this.invalidate();
      },
      waterMove: (x, y) => {
        this.water.move(x, y);
        this.invalidateOverlay();
      },
      waterEnd: () => {
        this.water.end(performance.now());
        this.events.onWaterActive(false);
        this.invalidate();
      },
      hover: (x, y, inside) => {
        this.hoverInside = inside && this.mode === "water";
        this.water.setHover(this.hoverInside, x, y);
        this.canvas.style.cursor = this.mode === "water" ? (inside ? "none" : "") : "grab";
        if (this.mode === "water") this.invalidateOverlay();
      },
    });
    this.resize();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(host);
    this.onOrientation = () => setTimeout(() => this.resize(), 250);
    window.addEventListener("orientationchange", this.onOrientation);
    this.onVisibility = () => {
      if (document.hidden) return this.stop();
      if (this.lost) this.armLossTimer();
      this.start();
    };
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  // --- WebGL ---

  initGL() {
    const gl = this.gl;
    this.progs = {
      sky: createProgram(gl, SH.SKY.vs, SH.SKY.fs, "cielo"),
      ground: createProgram(gl, SH.GROUND.vs, SH.GROUND.fs, "suelo"),
      path: createProgram(gl, SH.PATH.vs, SH.PATH.fs, "camino"),
      grass: createProgram(gl, SH.GRASS.vs, SH.GRASS.fs, "pasto"),
      plant: createProgram(gl, SH.PLANT.vs, SH.PLANT.fs, "planta"),
      decal: createProgram(gl, SH.DECAL.vs, SH.DECAL.fs, "calca"),
    };
    this.emptyVao = gl.createVertexArray();
    const one = (r, g, b) => dataTexture(gl, 1, 1, new Uint8Array([r, g, b, 255]), { repeatS: true });
    this.placeholder = one(0, 0, 0);
    this.tex = { soil: one(110, 84, 60), blade: one(90, 140, 50), blob: this.placeholder, clear: this.placeholder };
    this.blobMax = 1;
    this.clearRect = [-1, -1, 0.5, 0.5];
    // Cuadro de las calcomanías (sombras y anillos).
    this.decalVao = gl.createVertexArray();
    gl.bindVertexArray(this.decalVao);
    bindAttribs(gl, this.progs.decal, buffer(gl, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])), [{ name: "a_corner", size: 2, offset: 0 }], 2);
    this.decalBuf = gl.createBuffer();
    bindAttribs(gl, this.progs.decal, this.decalBuf, [{ name: "i_pos", size: 4, offset: 0 }, { name: "i_col", size: 4, offset: 4 }], 8, 1);
    gl.bindVertexArray(null);
    this.shadowData = new Float32Array(0);
    this.ground = null;
    this.paths = null;
    this.grass = null;
  }

  async loadAssets(assets) {
    try {
      const [grass, blade, soil] = await Promise.all([loadGrass(assets.grass), loadImage(assets.blade), loadImage(assets.soil)]);
      this.loaded = { grass, blade, soil };
      if (this.fb || this.gl.isContextLost()) return;
      this.uploadAssets();
      this.invalidate();
    } catch (err) {
      console.warn("jardín 3D: no se pudo cargar el pasto", err);
    }
  }

  uploadAssets() {
    const gl = this.gl, a = this.loaded;
    this.tex.blade = texture(gl, a.blade, { repeat: false });
    this.tex.soil = texture(gl, a.soil);
    this.grass = new Grass(gl, this.progs.grass, a.grass);
    if (this.world) this.scheduleGrass();
  }

  armLossTimer() {
    clearTimeout(this.lossTimer);
    if (document.hidden) return;
    this.lossTimer = setTimeout(() => this.lost && this.toFallback("contexto perdido"), 3000);
  }

  // Vuelve a crear todo en la GPU después de que el navegador devolvió el contexto.
  restoreGL() {
    this.groups = new Map();
    this.byDay.clear();
    this.treeGroups = new Map();
    this.grass = null;
    this.grassReady = false;
    this.lawnKey = null;
    this.initGL();
    if (this.loaded) this.uploadAssets();
    if (this.world) {
      this.setupWorld(this.world);
      this.placeTrees(false);
      this.buildInstances();
    }
    this.invalidate();
  }

  // El pasto se coloca justo después del primer cuadro, para que el jardín aparezca enseguida.
  scheduleGrass() {
    clearTimeout(this.grassTimer);
    this.grassReady = false;
    this.grassTimer = setTimeout(() => {
      if (this.fb || !this.world || !this.grass) return;
      this.rebuildGrass();
      this.grassReady = true;
      this.invalidate();
    }, 40);
  }

  // Coloca el pasto sobre el arriate (fuera de los caminos y más bajo junto a las plantas).
  rebuildGrass() {
    const radii = this.blobRadii, n = radii.length, w = this.world, eng = w.engine;
    const cl = this.clearing, cs = cl.size, [x0, z0, iw, ih] = cl.rect;
    const pathsOn = w.paths.length > 0, phase = eng?.pathPhase ?? 0;
    const sample = (list) => (th) => {
      const f = (((th / (Math.PI * 2)) % 1) + 1) % 1 * n - 0.5, i = Math.floor(f), t = f - i;
      return list[(i + n) % n] * (1 - t) + list[(i + 1) % n] * t;
    };
    const lawn = this.lawn;
    this.grass.rebuild({
      maxRadius: lawn ? Math.max(this.blobMax, lawn.max) : this.blobMax,
      bedRadius: this.blobMax,
      radius: sample(radii),
      lawn: lawn ? sample(lawn.radii) : null,
      trunks: lawn ? lawn.trunks : [],
      clear: (X, Z) => {
        const u = Math.floor((X - x0) * iw * cs), v = Math.floor((Z - z0) * ih * cs);
        return u < 0 || v < 0 || u >= cs || v >= cs ? 0 : cl.data[(v * cs + u) * 4] / 255;
      },
      onPath: (r, th) => {
        if (!pathsOn || r < 78 * 0.82) return false;
        const hw = 11.5 + r * 0.012;
        for (let k = 0; k < 3; k++) {
          let d = (th - (phase + (k * Math.PI * 2) / 3 + r * 0.0026)) % (Math.PI * 2);
          if (d > Math.PI) d -= Math.PI * 2;
          if (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) * r < hw) return true;
        }
        return false;
      },
    });
  }

  meshVao(prog, layout, stride, vertices, indices) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribs(gl, prog, buffer(gl, vertices), layout, stride);
    buffer(gl, indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    return { vao, count: indices.length, type: indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  // --- Interfaz de la escena (igual que la 2D) ---

  resize() {
    const r = this.host.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    const dpr = Math.min(window.devicePixelRatio || 1, [1, 1.5, this.maxDpr][this.quality]);
    if (w === this.width && h === this.height && dpr === this.dpr) return;
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.camera.setViewport(w, h);
    this.invalidate();
    this.renderFrame(performance.now());
  }

  setInsets(top, bottom, left = 0, right = 0) {
    this.camera.insets = { top, bottom, left, right };
  }

  setFlowers(world, keepView) {
    const first = !this.world;
    if (this.world !== world || this.worldVersion !== world.version) this.setupWorld(world);
    this.emptyBed = world.flowers.length === 0;
    this.placeTrees(!first);
    this.camera.setBounds(this.bounds);
    if (first || !keepView) this.camera.fit(this.defaultRect(), 0, 2.2);
    if (this.selected) this.selected = world.flowerByDay(this.selected.dayNumber) ?? null;
    this.buildInstances();
    this.updateLabel();
    this.invalidate();
  }

  // Suelo, caminos, contorno y claros del pasto para este mundo.
  setupWorld(world) {
    const gl = this.gl;
    this.world = world;
    this.worldVersion = world.version;
    this.emptyBed = world.flowers.length === 0;
    // Libera las texturas del mundo anterior.
    for (const k of ["blob", "clear"]) if (this.tex[k] && this.tex[k] !== this.placeholder) gl.deleteTexture(this.tex[k]);
    const blob = blobTexture(world);
    this.blobMax = blob.max;
    this.blobRadii = blob.radii;
    this.tex.blob = dataTexture(gl, blob.size, 1, blob.data, { repeatS: true });
    const g = buildGround(world, this.H);
    this.ground = this.meshVao(this.progs.ground, [
      { name: "a_pos", size: 3, offset: 0 }, { name: "a_nrm", size: 3, offset: 3 }, { name: "a_kind", size: 1, offset: 6 },
    ], 7, g.vertices, g.indices);
    const p = buildPaths(world, this.H);
    this.paths = p.indices.length ? this.meshVao(this.progs.path, [{ name: "a_pos", size: 3, offset: 0 }, { name: "a_uv", size: 2, offset: 3 }], 5, p.vertices, p.indices) : null;
    const clear = clearingTexture(world.flowers, this.H, this.blobMax);
    this.tex.clear = dataTexture(gl, clear.size, clear.size, clear.data);
    this.clearRect = clear.rect;
    this.clearing = clear;
    if (this.grass) this.scheduleGrass();
  }

  defaultRect() {
    const w = this.world;
    if (w.flowers.length <= 60) return this.bounds ?? w.bounds;
    const last = w.flowers[w.flowers.length - 1], c = { x: last.position.x * 0.72, y: last.position.y * 0.72 };
    return { x0: c.x - 170, y0: c.y - 150, x1: c.x + 170, y1: c.y + 110 };
  }

  updateLabel() {
    const n = this.world?.flowers.length ?? 0;
    this.canvas.setAttribute("aria-label", n === 0 ? "Jardín preparado, aún sin flores." : `Jardín con ${n === 1 ? "1 flor" : `${n} flores`}. Usa Historia para recorrerlas una por una.`);
  }

  setMode(mode) {
    this.mode = mode;
    this.canvas.style.cursor = mode === "water" ? "none" : "grab";
    if (mode !== "water") this.water.setHover(false);
    this.invalidate();
  }

  setMotion(motion, reduce) {
    // La app vuelve a limitar la calidad después si se piden menos efectos.
    this.qualityCap = 2;
    this.motion = motion;
    this.reduceEffects = reduce;
    this.water.reduced = reduce || !motion;
    this.invalidate();
  }

  setLight(name, instant = false) {
    this.lookFrom = this.look;
    this.lookTo = this.deps.looks[name];
    this.lookT0 = instant || !this.motion ? -1e9 : performance.now();
    this.invalidate();
  }

  get light() {
    return this.look;
  }

  get pixelRatio() {
    return this.dpr;
  }

  bump() {
    this.lastActive = performance.now();
  }

  invalidate() {
    this.dirty = true;
    this.bump();
    this.requestFrame();
  }

  // Solo cambió la capa 2D (gotas, regadera): la vista 3D puede seguir a su ritmo.
  invalidateOverlay() {
    this.overlayDirty = true;
    this.requestFrame();
  }

  // Un solo cuadro pendiente a la vez: pedir otro mientras ya hay uno duplicaría el bucle de dibujo.
  requestFrame() {
    if (this.running && !this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  start() {
    if (this.running || this.lost) return;
    this.running = true;
    this.lastT = performance.now();
    this.requestFrame();
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.water.end(0);
  }

  destroy() {
    this.stop();
    this.detach?.();
    this.resizeObs?.disconnect();
    window.removeEventListener("orientationchange", this.onOrientation);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
    this.canvas.remove();
    this.overlay.remove();
  }

  zoomBy(f) {
    this.camera.zoomAt(f, this.width / 2, (this.height + this.camera.insets.top - this.camera.insets.bottom) / 2);
    this.invalidate();
  }

  showAll(dur = 900) {
    if (!this.world) return;
    this.camera.fit(this.bounds ?? this.world.bounds, this.motion ? dur : 0, 2.2);
    this.invalidate();
  }

  showDefault(dur = 900) {
    if (!this.world) return;
    this.camera.fit(this.defaultRect(), this.motion ? dur : 0, 2.2);
    this.invalidate();
  }

  focusFlower(day, select = true, dur = 900) {
    const f = this.world?.flowerByDay(day);
    if (!f) return;
    const info = this.infoFor(f), z = Math.max(this.camera.zoom, 2.2);
    // Centra la mitad de la planta: el punto del suelo que queda detrás de ella en pantalla.
    const half = BED_H + info.head[1] * f.scale * 0.5, pitch = this.camera.pitchFor(z);
    this.camera.flyTo(f.position.x, f.position.y - (half / Math.tan(pitch)) * this.H, z, this.motion ? dur : 0);
    if (select) this.select(f);
    this.invalidate();
  }

  fitDays(days, dur = 1000) {
    if (!this.world || !days.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const d of days) {
      const f = this.world.flowerByDay(d);
      if (!f) continue;
      x0 = Math.min(x0, f.position.x - 30);
      x1 = Math.max(x1, f.position.x + 30);
      y0 = Math.min(y0, f.position.y - 80);
      y1 = Math.max(y1, f.position.y + 20);
    }
    if (x0 === Infinity) return;
    this.camera.fit({ x0, y0, x1, y1 }, this.motion ? dur : 0, 2.4);
    this.invalidate();
  }

  highlight(days, ms = 7000, color = "#B7A5CE") {
    const until = performance.now() + ms;
    this.highlightColor = color;
    for (const d of days) this.highlights.set(d, until);
    this.invalidate();
  }

  select(f) {
    this.selected = f;
    if (f) this.react(f.dayNumber);
    this.events.onSelect(f);
    this.invalidate();
  }

  clearSelection() {
    this.selected = null;
    this.invalidate();
  }

  waterFlower(day) {
    const f = this.world?.flowerByDay(day);
    if (!f) return;
    const head = this.headScreen(f);
    this.water.pourAt(head.x, head.y, performance.now(), 1300);
    setTimeout(() => this.applyWater([f]), 380);
    this.invalidate();
  }

  playAppear(kind, days) {
    if (!this.world || !this.motion) return;
    const now = performance.now();
    if (kind === "sprout" || kind === "new") {
      days.forEach((d, i) => this.appear.set(d, { t0: now + 250 + i * 120, dur: 1400 }));
    } else {
      const r = this.world.radius || 1;
      for (const d of days) {
        const f = this.world.flowerByDay(d);
        if (!f) continue;
        const dist = Math.hypot(f.position.x, f.position.y / this.H);
        this.appear.set(d, { t0: now + 200 + (dist / r) * 1500, dur: 700 });
      }
    }
    for (const d of days) this.writeInstance(d);
    this.invalidate();
  }

  celebrate() {
    if (!this.world || !this.motion) return;
    this.life.celebrate(this.width, ["#F2C3C8", "#FBEFDC", "#D8A6AB", "#E8DAF0", "#FBF8F1", "#F6D2DD"], this.reduceEffects);
    this.invalidate();
  }

  snapshot() {
    this.renderFrame(performance.now());
    const c = document.createElement("canvas");
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext("2d");
    g.drawImage(this.canvas, 0, 0);
    g.drawImage(this.overlay, 0, 0);
    return c;
  }

  setQualityCap(q) {
    this.qualityCap = q;
    if (this.quality > q) {
      this.quality = q;
      this.resize();
    }
  }

  // --- Plantas ---

  keyFor(f) {
    const variety = f.speciesId === "silvestre" ? Math.max(0, f.paletteIndex) % 3 : 0;
    if (f.growthStage === 0) return { key: "seed", species: f.speciesId, variety, shape: 0, stage: 0 };
    if (f.growthStage === 1) return { key: `${f.speciesId}|sprout`, species: f.speciesId, variety, shape: 0, stage: 1 };
    return { key: `${f.speciesId}|${variety}|${f.shapeVariant}|${f.growthStage}`, species: f.speciesId, variety, shape: f.shapeVariant, stage: f.growthStage };
  }

  // Cada grupo (especie, forma y etapa) tiene su geometría en detalle completo y, si hace falta,
  // una liviana para ver de lejos; las dos comparten el buffer de instancias.
  geometry(k) {
    let g = this.groups.get(k.key);
    if (g) return g;
    const gl = this.gl;
    g = { k, inst: gl.createBuffer(), data: new Float32Array(0), flowers: [], dirty: true, full: null, lite: null };
    g.full = this.meshFor(g, false);
    g.geo = g.full.geo;
    this.groups.set(k.key, g);
    return g;
  }

  meshFor(g, lite) {
    const k = g.k, gl = this.gl, prog = this.progs.plant;
    const geo = k.key === "milestone" ? buildMilestoneRing(lite) : buildPlant(this.deps.species[k.species], k.variety, k.shape, k.stage, lite);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    bindAttribs(gl, prog, buffer(gl, geo.vertices), PLANT_LAYOUT, 11);
    bindAttribs(gl, prog, g.inst, INST_LAYOUT, INST, 1);
    buffer(gl, geo.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    return { geo, vao, count: geo.indices.length, type: geo.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
  }

  infoFor(f) {
    return this.byDay.get(f.dayNumber)?.group.geo ?? { head: [0, 30, 0], radius: 10, height: 40 };
  }

  buildInstances() {
    for (const g of this.groups.values()) g.flowers = [];
    this.byDay.clear();
    const flowers = this.world.flowers;
    const list = this.emptyBed ? [{ dayNumber: 0, speciesId: "rosa", paletteIndex: 0, shapeVariant: 0, growthStage: 0, position: { x: 0, y: 0 }, scale: 1.6, lean: 0, swayPhase: 0 }] : flowers;
    for (const f of list) {
      const g = this.geometry(this.keyFor(f));
      this.byDay.set(f.dayNumber, { group: g, index: g.flowers.length });
      g.flowers.push(f);
    }
    const milestones = flowers.filter((f) => f.milestone && f.growthStage >= 2);
    const ring = this.geometry({ key: "milestone" });
    ring.flowers = milestones;
    for (const g of this.groups.values()) {
      g.data = new Float32Array(g.flowers.length * INST);
      g.flowers.forEach((f, i) => this.fillInstance(g, i, f));
      g.dirty = true;
    }
    // Sombras de contacto bajo cada planta.
    const sh = new Float32Array(list.length * 8);
    list.forEach((f, i) => {
      const r = (f.growthStage <= 1 ? 7 : f.growthStage === 2 ? 10 : 9 + this.deps.species[f.speciesId].headRadius * 0.6) * f.scale;
      sh.set([f.position.x, f.position.y / this.H, r, 0, 0.1, 0.13, 0.07, 0.3], i * 8);
    });
    this.plantShadow = sh;
    this.mergeShadows();
  }

  mergeShadows() {
    const a = this.plantShadow, b = this.treeShadow, sh = new Float32Array(a.length + b.length);
    sh.set(a);
    sh.set(b, a.length);
    this.shadowData = sh;
    this.shadowDirty = true;
  }

  // --- Árboles de nacimiento ---

  // list: [{ name, birth, today, kind }]. El árbol crece con la edad y suma ramas al madurar.
  setTrees(list) {
    this.treeInput = Array.isArray(list) ? list : [];
    if (!this.world) return;
    this.placeTrees(true);
    this.camera.setBounds(this.bounds);
    this.invalidate();
  }

  setEntered(on) {
    this.entered = !!on;
    this.invalidate();
  }

  placeTrees(animate) {
    const w = this.world;
    if (!w) return;
    const before = new Set(this.trees.map((t) => t.kind)), now = performance.now();
    this.trees = [];
    for (const input of this.treeInput) {
      const spec = TREES[input.kind], a = spec && treeAge(input.birth, input.today);
      if (!a) continue;
      const m = Math.round(Math.min(1, a.age / 25) * 4) / 4, key = `tree|${input.kind}|${m}`;
      const g = this.treeGeometry(key, input.kind, m);
      const h = 55 + 150 * (1 - Math.exp(-a.age / 18)), s = h / g.geo.height;
      // Detrás del arriate, lo bastante lejos para que la copa no tape las flores.
      const th = (spec.angle * Math.PI) / 180, R = w.blobRadiusAt(th) + 12 + g.geo.radius * s * 0.7;
      const yaw = (rng(hashString(`tree${input.kind}`))() - 0.5) * 1.6;
      this.trees.push({ ...input, ...a, key, m, h, s, yaw, x: Math.cos(th) * R, z: Math.sin(th) * R, geo: g.geo });
      if (animate && this.motion && !before.has(input.kind)) this.appear.set(`tree${input.kind}`, { t0: now + 350, dur: 1800 });
    }
    this.fillTrees();
    this.updateLawn();
    // Sombra bajo cada copa.
    const sh = new Float32Array(this.trees.length * 8);
    this.trees.forEach((t, i) => sh.set([t.x, t.z, t.geo.radius * t.s * 0.75, 0, 0.1, 0.13, 0.07, 0.34], i * 8));
    this.treeShadow = sh;
    this.mergeShadows();
    // Límites del jardín con los árboles (el alto cuenta como profundidad, como en el 2D).
    let { x0, y0, x1, y1 } = w.bounds;
    for (const t of this.trees) {
      const r = t.geo.radius * t.s, y = t.z * this.H;
      x0 = Math.min(x0, t.x - r);
      x1 = Math.max(x1, t.x + r);
      y0 = Math.min(y0, y - t.h * 0.6);
      y1 = Math.max(y1, y + 24);
    }
    this.bounds = { x0, y0, x1, y1 };
  }

  // Césped alrededor del arriate que llega hasta los árboles: una franja angosta en todo el
  // contorno que se ensancha hacia cada árbol hasta pasar un poco más allá de su tronco.
  updateLawn() {
    const radii = this.blobRadii, n = radii?.length ?? 0;
    let lawn = null;
    if (n && this.trees.length) {
      const out = new Float32Array(n), trunks = [];
      const need = this.trees.map((t) => {
        const th = Math.atan2(t.z, t.x), d = Math.hypot(t.x, t.z), i = Math.round(((((th / (Math.PI * 2)) % 1) + 1) % 1) * n - 0.5);
        trunks.push({ x: t.x, z: t.z, r: (1 + 4.6 * t.m) * 1.9 * t.s + 1.5 });
        return { th, extra: d + Math.max(60, t.geo.radius * t.s * 0.8) - radii[(i + n) % n] };
      });
      let max = 0;
      for (let i = 0; i < n; i++) {
        const th = ((i + 0.5) / n) * Math.PI * 2;
        let pad = 22;
        for (const q of need) {
          let dth = Math.abs(th - q.th) % (Math.PI * 2);
          if (dth > Math.PI) dth = Math.PI * 2 - dth;
          pad = Math.max(pad, 22 + (q.extra - 22) * Math.exp(-((dth / 0.75) ** 2)));
        }
        out[i] = radii[i] + pad * (0.94 + 0.12 * Math.sin(th * 5 + 1.3) * Math.sin(th * 3));
        max = Math.max(max, out[i]);
      }
      lawn = { radii: out, max: max * 1.02, trunks };
    }
    const key = lawn ? Array.from(lawn.radii.filter((_, i) => i % 32 === 0), (v) => Math.round(v)).join(",") : "";
    if (key === this.lawnKey) return;
    this.lawnKey = key;
    this.lawn = lawn;
    const gl = this.gl;
    if (this.tex.lawn && this.tex.lawn !== this.placeholder) gl.deleteTexture(this.tex.lawn);
    this.tex.lawn = this.placeholder;
    if (lawn) {
      const data = new Uint8Array(n * 4);
      lawn.radii.forEach((r, i) => {
        const v = (r / lawn.max) * 255, hi = Math.floor(v);
        data[i * 4] = hi;
        data[i * 4 + 1] = Math.round((v - hi) * 255);
        data[i * 4 + 3] = 255;
      });
      this.tex.lawn = dataTexture(gl, n, 1, data, { repeatS: true });
    }
    if (this.grass) this.scheduleGrass();
    this.invalidate();
  }

  treeGeometry(key, kind, m) {
    let g = this.treeGroups.get(key);
    if (g) return g;
    const gl = this.gl, prog = this.progs.plant, geo = buildTree(kind, m);
    g = { geo, inst: gl.createBuffer(), data: new Float32Array(0), list: [], dirty: true };
    g.vao = gl.createVertexArray();
    gl.bindVertexArray(g.vao);
    bindAttribs(gl, prog, buffer(gl, geo.vertices), PLANT_LAYOUT, 11);
    bindAttribs(gl, prog, g.inst, INST_LAYOUT, INST, 1);
    buffer(gl, geo.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    g.count = geo.indices.length;
    g.type = geo.indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
    this.treeGroups.set(key, g);
    return g;
  }

  fillTrees() {
    for (const g of this.treeGroups.values()) g.list = [];
    for (const t of this.trees) this.treeGroups.get(t.key).list.push(t);
    for (const g of this.treeGroups.values()) {
      const d = (g.data = new Float32Array(g.list.length * INST));
      g.list.forEach((t, i) => {
        const o = i * INST, a = this.appear.get(`tree${t.kind}`), pal = TREES[t.kind].palette;
        d.set([t.x, t.z, t.yaw, t.s, 0, t.kind * 2.1, -1e5, a ? (a.t0 - this.t0) / 1000 : 0, a ? a.dur / 1000 : 0], o);
        d.set(hexToRgb(pal.light), o + 12);
        d.set(hexToRgb(pal.base), o + 15);
        d.set(hexToRgb(pal.deep), o + 18);
        d.set(hexToRgb(pal.center), o + 21);
      });
      g.dirty = true;
    }
  }

  // Copa del árbol en el mundo (para tocarlo).
  treeCrown(t) {
    const [hx, hy, hz] = t.geo.head, c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    return [t.x + (hx * c + hz * s) * t.s, hy * t.s, t.z + (-hx * s + hz * c) * t.s];
  }

  hitTree(x, y) {
    for (const t of this.trees) {
      const base = this.camera.project(t.x, 0, t.z);
      if (base.w <= 0) continue;
      const lr = t.labelRect;
      if (lr && x >= lr[0] && y >= lr[1] && x <= lr[0] + lr[2] && y <= lr[1] + lr[3]) return t;
      const cw = this.treeCrown(t), head = this.camera.project(cw[0], cw[1], cw[2]);
      const side = this.camera.project(cw[0] + t.geo.radius * t.s * 0.7, cw[1], cw[2]);
      const r = Math.max(24, Math.hypot(side.x - head.x, side.y - head.y));
      const vx = head.x - base.x, vy = head.y - base.y;
      const k = clamp(((x - base.x) * vx + (y - base.y) * vy) / Math.max(1, vx * vx + vy * vy), 0, 1);
      if (Math.hypot(x - head.x, y - head.y) < r || Math.hypot(x - (base.x + vx * k), y - (base.y + vy * k)) < 14) return t;
    }
    return null;
  }

  treeInfo(t) {
    const { name, birth, kind, years, months, birthday, daysToNext, nextDate, progress } = t;
    return { name, birth, kind, years, months, birthday, daysToNext, nextDate, progress };
  }

  // Nombre, edad y avance del año bajo cada árbol (solo con el jardín abierto).
  drawTreeLabels(g, now) {
    const cam = this.camera;
    g.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const t of this.trees) {
      t.labelRect = null;
      const a = this.appear.get(`tree${t.kind}`);
      if (a && now < a.t0 + a.dur) continue;
      const p = cam.project(t.x, 0, t.z);
      if (p.w <= 0 || p.x < -80 || p.y < -40 || p.x > this.width + 80 || p.y > this.height + 40) continue;
      const age = t.years > 0 ? `${t.years} ${t.years === 1 ? "año" : "años"}` : `${t.months} ${t.months === 1 ? "mes" : "meses"}`;
      const text = t.birthday ? `${t.name} · ¡${t.years} hoy!` : `${t.name} · ${age}`;
      const w = Math.max(70, g.measureText(text).width + 22), h = 28, x = clamp(p.x - w / 2, 6, Math.max(6, this.width - w - 6)), y = p.y + 8;
      g.beginPath();
      g.roundRect ? g.roundRect(x, y, w, h, 10) : g.rect(x, y, w, h);
      g.fillStyle = "rgba(28,40,33,.28)";
      g.fill();
      g.beginPath();
      g.roundRect ? g.roundRect(x + 1, y + 1, w - 2, h - 2, 9) : g.rect(x + 1, y + 1, w - 2, h - 2);
      g.fillStyle = t.birthday ? "rgba(253,228,239,.96)" : "rgba(250,243,221,.94)";
      g.fill();
      g.fillStyle = "#2f4a3a";
      g.fillText(text, x + w / 2, y + 11);
      const bw = w - 20, bx = x + 10, by = y + 19;
      this.pill(g, bx, by, bw, 4, "rgba(47,74,58,.16)");
      this.pill(g, bx, by, Math.max(4, bw * (t.birthday ? 1 : t.progress)), 4, TREES[t.kind].bar);
      t.labelRect = [x, y, w, h];
    }
  }

  fillInstance(g, i, f) {
    const d = g.data, o = i * INST, sp = this.deps.species[f.speciesId];
    const yaw = (rng(hashString(`yaw${f.dayNumber}`))() - 0.5) * 1.1;
    const a = this.appear.get(f.dayNumber), react = this.reactions.get(f.dayNumber);
    d[o] = f.position.x;
    d[o + 1] = f.position.y / this.H;
    d[o + 2] = yaw;
    d[o + 3] = f.scale;
    d[o + 4] = f.lean ?? 0;
    d[o + 5] = f.swayPhase ?? 0;
    d[o + 6] = react ? (react.t0 - this.t0) / 1000 : -1e5;
    d[o + 7] = a ? (a.t0 - this.t0) / 1000 : 0;
    d[o + 8] = a ? a.dur / 1000 : 0;
    if (!sp) return;
    const pal = this.deps.palette(f.speciesId, f.paletteIndex);
    d.set(hexToRgb(pal.light), o + 12);
    d.set(hexToRgb(pal.base), o + 15);
    d.set(hexToRgb(pal.deep), o + 18);
    d.set(hexToRgb(pal.center), o + 21);
  }

  writeInstance(day) {
    const e = this.byDay.get(day);
    if (!e || !this.world) return;
    const f = this.world.flowerByDay(day);
    if (!f) return;
    this.fillInstance(e.group, e.index, f);
    e.group.dirty = true;
  }

  // Cabeza de la flor en pantalla (para tocar, regar y la capa 2D).
  headWorld(f) {
    const info = this.infoFor(f), yaw = (rng(hashString(`yaw${f.dayNumber}`))() - 0.5) * 1.1;
    const [hx, hy, hz] = info.head, c = Math.cos(yaw), s = Math.sin(yaw);
    return [f.position.x + (hx * c + hz * s) * f.scale, BED_H + hy * f.scale, f.position.y / this.H + (-hx * s + hz * c) * f.scale];
  }

  headScreen(f) {
    const h = this.headWorld(f);
    return this.camera.project(h[0], h[1], h[2]);
  }

  pickLifeTarget() {
    if (!this.world) return null;
    const open = [];
    for (const f of this.world.flowers) {
      if (f.growthStage < 4) continue;
      const p = this.headScreen(f);
      if (p.w > 0 && p.x > 0 && p.y > 0 && p.x < this.width && p.y < this.height) open.push(p);
      if (open.length > 40) break;
    }
    if (!open.length) return null;
    const p = open[Math.floor(Math.random() * open.length)];
    return this.camera.toWorld(p.x, p.y);
  }

  handleTap(x, y) {
    if (this.mode === "water") return;
    const f = this.hitTest(x, y);
    if (f) return this.select(f);
    if (this.selected) this.select(null);
    const t = this.hitTree(x, y);
    if (!t) return;
    this.treeFocus = { kind: t.kind, until: performance.now() + 2600 };
    this.events.onTree?.(this.treeInfo(t));
    this.invalidate();
  }

  hitTest(x, y, minR = 22) {
    if (!this.world) return null;
    const hits = [];
    for (const f of this.world.flowers) {
      const info = this.infoFor(f), base = this.camera.project(f.position.x, BED_H, f.position.y / this.H);
      if (base.w <= 0) continue;
      const head = this.headScreen(f);
      const side = this.camera.project(f.position.x + info.radius * f.scale, BED_H + info.head[1] * f.scale, f.position.y / this.H);
      const r = Math.max(Math.hypot(side.x - head.x, side.y - head.y), minR);
      const vx = head.x - base.x, vy = head.y - base.y;
      const t = clamp(((x - base.x) * vx + (y - base.y) * vy) / Math.max(1, vx * vx + vy * vy), 0, 1);
      const dStem = Math.hypot(x - (base.x + vx * t), y - (base.y + vy * t));
      const score = Math.min(Math.hypot(x - head.x, y - head.y) / r, dStem / Math.max(10, minR * 0.6));
      if (score < 1) hits.push({ f, score, depth: base.w });
    }
    // Como en el 2D: gana la más cercana a la cámara, salvo que otra quede claramente mejor.
    hits.sort((a, b) => a.depth - b.depth);
    let best = null, bestScore = Infinity;
    for (const h of hits)
      if (h.score < bestScore - 0.25) {
        best = h.f;
        bestScore = h.score;
      }
    return best;
  }

  waterTick() {
    if (!this.world) return;
    const x = this.water.x, y = this.water.y, R = 30, hit = [];
    for (const f of this.world.flowers) {
      const info = this.infoFor(f), head = this.headScreen(f);
      if (head.w <= 0) continue;
      const base = this.camera.project(f.position.x, BED_H, f.position.y / this.H);
      const side = this.camera.project(f.position.x + info.radius * f.scale, BED_H + info.head[1] * f.scale, f.position.y / this.H);
      const r = Math.hypot(side.x - head.x, side.y - head.y) + R;
      const mid = { x: (head.x + base.x) / 2, y: (head.y + base.y) / 2 };
      if (Math.hypot(x - head.x, y - head.y) < r || Math.hypot(x - base.x, (y - base.y) * 1.4) < R + 6 || Math.hypot(x - mid.x, y - mid.y) < R) hit.push(f);
    }
    if (hit.length) this.applyWater(hit);
  }

  applyWater(list) {
    const now = performance.now(), fresh = [];
    for (const f of list) {
      const r = this.reactions.get(f.dayNumber);
      if (!r || now - r.t0 > 700) {
        this.react(f.dayNumber);
        fresh.push(f);
      }
      this.wetUntil.set(f.dayNumber, now + 7000);
    }
    if (fresh.length) this.events.onWatered(fresh);
    this.dirty = true;
    this.requestFrame();
  }

  react(day) {
    this.reactions.set(day, { t0: performance.now() });
    this.writeInstance(day);
  }

  // --- Bucle de dibujo ---

  tick(now) {
    this.raf = 0;
    if (!this.running || this.fb) return;
    const dt = Math.min(64, now - this.lastT || 16);
    this.lastT = now;
    const animating = this.update(now, dt);
    // En reposo con viento se dibuja a ~30 cuadros por segundo, y a ~15 tras 20 s sin tocar nada.
    // Al regar, la vista 3D sigue ese ritmo y solo las gotas y la regadera (capa 2D) van a ritmo completo.
    const idle = now - this.lastActive, gap = idle > 20000 ? 66 : 30;
    const effects = (this.water.animating ?? this.water.busy) || this.overlayDirty;
    if (animating && !this.dirty && idle > 2500 && !this.camera.isFlying && !this.appear.size && (!this.reactions.size || this.mode === "water") && now - this.lastRender < gap) {
      if (effects) {
        this.overlayDirty = false;
        this.renderOverlay(now);
      }
      this.requestFrame();
      return;
    }
    this.lastRender = now;
    const was = this.dirty || this.overlayDirty;
    this.dirty = false;
    this.overlayDirty = false;
    if (was || animating) {
      this.renderFrame(now);
      if (this.continuous) this.adapt(dt);
      this.continuous = animating;
    } else this.continuous = false;
    // Algo dentro de este cuadro (como regar una flor) pudo pedir ya el siguiente.
    if (animating || this.dirty || this.overlayDirty) this.requestFrame();
  }

  update(now, dt) {
    let busy = false;
    if (this.camera.update(now, dt)) {
      busy = true;
      this.bump();
    }
    if (this.lookT0 > 0) {
      const t = clamp((now - this.lookT0) / 1400, 0, 1);
      this.look = this.deps.mixLook(this.lookFrom, this.lookTo, t);
      if (t < 1) busy = true;
      else this.lookT0 = 0;
    } else if (this.look !== this.lookTo) {
      this.look = this.lookTo;
      busy = true;
    }
    if (this.water.update(dt, now, this.camera)) this.waterTick();
    if (this.water.busy) busy = true;
    for (const [d, r] of this.reactions) now - r.t0 > 2400 ? this.reactions.delete(d) : (busy = true);
    for (const [d, w] of this.wetUntil) now > w ? this.wetUntil.delete(d) : (busy = true);
    for (const [d, a] of this.appear) now > a.t0 + a.dur ? this.appear.delete(d) : (busy = true);
    for (const [d, h] of this.highlights) now > h ? this.highlights.delete(d) : (busy = true);
    if (this.treeFocus) now > this.treeFocus.until ? (this.treeFocus = null) : (busy = true);
    if (this.selected) busy = busy || this.motion;
    this.life.update(dt, this.camera, { motion: this.motion, reduced: this.reduceEffects || this.quality === 0, night: this.look.night });
    if ((this.motion && !this.emptyBed) || this.life.busy) busy = true;
    if (this.motion && this.world?.flowers.length) busy = true;
    return busy;
  }

  adapt(dt) {
    if (dt > 200) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const median = this.frameTimes.slice().sort((a, b) => a - b)[45];
    this.frameTimes.length = 0;
    const now = performance.now();
    if (median > 24 && this.quality > 0) {
      this.quality--;
      this.lastQualityChange = now;
      this.resize();
    } else if (median < 17.5 && this.quality < this.qualityCap && now - this.lastQualityChange > 20000) {
      this.quality++;
      this.lastQualityChange = now;
      this.resize();
    }
  }

  renderOverlay(now) {
    try {
      this.drawOverlay(now);
    } catch (err) {
      console.warn("jardín 3D: capa omitida", err);
    }
  }

  renderFrame(now) {
    if (this.fb) return;
    try {
      this.draw(now);
      this.drawOverlay(now);
      this.errors = 0;
    } catch (err) {
      console.warn("jardín 3D: cuadro omitido", err);
      if (++this.errors > 3) this.toFallback("errores al dibujar");
    }
  }

  lighting() {
    const L = this.look, n = L.night, paper = rgb255(L.paper), glow = rgb255(L.glow);
    const sx = (L.glowX - 0.5) * 1.5, sy = 1.15 - L.glowY * 1.6, sz = -0.55, sl = Math.hypot(sx, sy, sz);
    const warm = [1, 0.96, 0.88];
    return {
      paper,
      sunDir: [sx / sl, sy / sl, sz / sl],
      sunCol: [0, 1, 2].map((i) => lerp(warm[i], glow[i], 0.3) * lerp(0.72, 0.42, n)),
      sky: [0, 1, 2].map((i) => lerp([0.66, 0.69, 0.64][i], [0.48, 0.53, 0.7][i], n)),
      gnd: [0, 1, 2].map((i) => lerp([0.46, 0.44, 0.36][i], [0.26, 0.28, 0.36][i], n)),
    };
  }

  common(p, light) {
    const gl = this.gl, u = p.uniforms, L = this.look, cam = this.camera;
    gl.useProgram(p.program);
    const set3 = (k, v) => u[k] && gl.uniform3f(u[k], v[0], v[1], v[2]);
    const set1 = (k, v) => u[k] && gl.uniform1f(u[k], v);
    u.u_viewProj && gl.uniformMatrix4fv(u.u_viewProj, false, cam.viewProj);
    set3("u_tint", rgb255(L.tint));
    set1("u_tintA", L.tintAlpha);
    set3("u_glow", rgb255(L.glow));
    set1("u_glowA", L.glowAlpha);
    u.u_glowPos && gl.uniform2f(u.u_glowPos, L.glowX, L.glowY);
    set1("u_vig", L.vignette);
    u.u_res && gl.uniform2f(u.u_res, this.canvas.width, this.canvas.height);
    set3("u_fogColor", light.paper);
    u.u_fog && gl.uniform2f(u.u_fog, cam.dist * 1.7, cam.dist * 3.6 + 400);
    set3("u_eye", cam.eye);
    set3("u_sunDir", light.sunDir);
    set3("u_sunCol", light.sunCol);
    set3("u_sky", light.sky);
    set3("u_gnd", light.gnd);
    set3("u_paper", light.paper);
    set1("u_time", (performance.now() - this.t0) / 1000);
    set1("u_bedH", BED_H);
    set1("u_blobMax", this.blobMax);
    u.u_clearRect && gl.uniform4f(u.u_clearRect, ...this.clearRect);
  }

  bindTex(p, name, tex, unit) {
    const gl = this.gl;
    if (!p.uniforms[name]) return;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(p.uniforms[name], unit);
  }

  draw(now) {
    const gl = this.gl, P = this.progs, light = this.lighting();
    this.camera.updateMatrices();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.clearColor(...light.paper, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.common(P.sky, light);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this.world || !this.ground) return;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    this.common(P.ground, light);
    this.bindTex(P.ground, "u_soil", this.tex.soil, 0);
    this.bindTex(P.ground, "u_blob", this.tex.blob, 1);
    this.bindTex(P.ground, "u_lawn", this.tex.lawn ?? this.placeholder, 3);
    gl.uniform1f(P.ground.uniforms.u_lawnMax, this.lawn ? this.lawn.max : 0);
    this.bindTex(P.ground, "u_clear", this.tex.clear, 2);
    gl.uniform3f(P.ground.uniforms.u_meadow, ...MEADOW);
    // De lejos las hojas ya no se distinguen: la tierra se tiñe del verde del pasto.
    gl.uniform3f(P.ground.uniforms.u_grassColor, 0.36, 0.52, 0.16);
    gl.uniform1f(P.ground.uniforms.u_grassFar, this.grassReady ? clamp((1.5 - this.camera.zoom) / 1.0, 0, 1) * 0.75 : 0);
    gl.bindVertexArray(this.ground.vao);
    gl.drawElements(gl.TRIANGLES, this.ground.count, this.ground.type, 0);

    if (this.paths) {
      this.common(P.path, light);
      gl.uniform3f(P.path.uniforms.u_sand, ...SAND);
      gl.uniform3f(P.path.uniforms.u_sandEdge, ...SAND_EDGE);
      gl.bindVertexArray(this.paths.vao);
      gl.drawElements(gl.TRIANGLES, this.paths.count, this.paths.type, 0);
    }

    // Sombras de contacto.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    this.common(P.decal, light);
    this.drawDecals(this.shadowData, this.shadowDirty);
    this.shadowDirty = false;
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    if (this.grass && this.grassReady) {
      this.common(P.grass, light);
      this.bindTex(P.grass, "u_blade", this.tex.blade, 0);
      gl.uniform1f(P.grass.uniforms.u_wind, this.motion ? (this.reduceEffects ? 0.5 : 1) : 0);
      this.grass.draw(this.camera, this.H, this.quality);
    }

    // Anillos de selección y de resaltado (se ven a través del pasto).
    const rings = this.ringData(now);
    if (rings.length) {
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      gl.disable(gl.DEPTH_TEST);
      this.common(P.decal, light);
      this.drawDecals(rings, true, true);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.depthMask(true);
    }

    this.common(P.plant, light);
    gl.uniform1f(P.plant.uniforms.u_motion, this.motion ? 1 : 0);
    gl.uniform1f(P.plant.uniforms.u_noFlip, 0);
    // De lejos, plantas livianas (con margen para que no parpadee al cambiar).
    const z = this.camera.zoom;
    this.liteMode = this.liteMode ? z < 0.95 : z < 0.8;
    for (const g of this.groups.values()) {
      if (!g.flowers.length) continue;
      if (g.dirty) {
        gl.bindBuffer(gl.ARRAY_BUFFER, g.inst);
        gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.DYNAMIC_DRAW);
        g.dirty = false;
      }
      const m = this.liteMode ? (g.lite ??= this.meshFor(g, true)) : g.full;
      gl.uniform1f(P.plant.uniforms.u_height, g.geo.height);
      gl.bindVertexArray(m.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, m.count, m.type, 0, g.flowers.length);
    }
    if (this.trees.length) {
      gl.uniform1f(P.plant.uniforms.u_bedH, 0);
      gl.uniform1f(P.plant.uniforms.u_motion, this.motion ? 0.3 : 0);
      gl.uniform1f(P.plant.uniforms.u_noFlip, 1);
      for (const g of this.treeGroups.values()) {
        if (!g.list.length) continue;
        if (g.dirty) {
          gl.bindBuffer(gl.ARRAY_BUFFER, g.inst);
          gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.DYNAMIC_DRAW);
          g.dirty = false;
        }
        gl.uniform1f(P.plant.uniforms.u_height, g.geo.height);
        gl.bindVertexArray(g.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, g.count, g.type, 0, g.list.length);
      }
    }
    gl.bindVertexArray(null);
  }

  drawDecals(data, upload, temp = false) {
    const gl = this.gl;
    if (!data.length) return;
    if (upload || temp) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.decalBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    }
    gl.bindVertexArray(this.decalVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.length / 8);
    if (temp) {
      // Restaura las sombras en el buffer compartido para el siguiente cuadro.
      gl.bindBuffer(gl.ARRAY_BUFFER, this.decalBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.shadowData, gl.DYNAMIC_DRAW);
    }
  }

  ringData(now) {
    const out = [];
    const pulse = this.motion ? 0.5 + 0.5 * Math.sin(now / 420) : 1;
    const push = (f, kind, col, a) => {
      const r = (this.deps.species[f.speciesId].headRadius + 10) * f.scale * 1.15;
      out.push(f.position.x, f.position.y / this.H, Math.max(r, 12), kind, col[0], col[1], col[2], a);
    };
    if (this.selected) push(this.selected, 1, [0.28, 0.42, 0.34], 0.85);
    if (this.world) {
      const hc = hexToRgb(this.highlightColor);
      for (const [d, until] of this.highlights) {
        const f = this.world.flowerByDay(d);
        if (f) push(f, 2, hc, (0.55 + pulse * 0.35) * clamp((until - now) / 800, 0, 1));
      }
    }
    const tf = this.treeFocus, tree = tf && this.trees.find((t) => t.kind === tf.kind);
    if (tree) {
      const c = hexToRgb(TREES[tree.kind].bar);
      out.push(tree.x, tree.z, tree.geo.radius * tree.s * 0.8, 2, c[0], c[1], c[2], (0.55 + pulse * 0.35) * clamp((tf.until - now) / 800, 0, 1));
    }
    return new Float32Array(out);
  }

  // Capa 2D encima: riego, mariposas y luciérnagas, brillos, gotas y barras de crecimiento.
  drawOverlay(now) {
    const g = this.ctx, dpr = this.dpr, cam = this.camera;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.overlay.width, this.overlay.height);
    if (!this.world) return;
    this.water.drawSpots(g, cam, dpr, now);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Brillo de las flores resaltadas.
    for (const [d, until] of this.highlights) {
      const f = this.world.flowerByDay(d);
      if (!f) continue;
      const p = this.headScreen(f), k = clamp((until - now) / 800, 0, 1);
      const pulse = this.motion ? 0.5 + 0.5 * Math.sin(now / 420) : 1, r = 16 + pulse * 6;
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(255,255,255,${0.85 * k})`);
      grad.addColorStop(0.35, this.rgba(this.highlightColor, 0.6 * k));
      grad.addColorStop(1, this.rgba(this.highlightColor, 0));
      g.fillStyle = grad;
      g.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    }
    // Gotas sobre las flores recién regadas.
    for (const [d, until] of this.wetUntil) {
      const f = this.world.flowerByDay(d);
      if (!f || f.growthStage < 1) continue;
      const p = this.headScreen(f), k = clamp((until - now) / 7000, 0, 1), rand = rng(d * 7919);
      const rad = Math.max(8, this.infoFor(f).radius * f.scale * cam.zoom * 0.7);
      const glow = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 1.6);
      glow.addColorStop(0, `rgba(255,255,244,${0.4 * k})`);
      glow.addColorStop(1, "rgba(255,255,244,0)");
      g.fillStyle = glow;
      g.fillRect(p.x - rad * 1.6, p.y - rad * 1.6, rad * 3.2, rad * 3.2);
      for (let i = 0; i < 5; i++) {
        const x = p.x + (rand() - 0.5) * rad * 1.6, y = p.y + (rand() - 0.4) * rad * 1.2, r = (0.9 + rand() * 0.8) * Math.min(2, cam.zoom);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fillStyle = `rgba(214,236,246,${0.75 * k})`;
        g.fill();
        g.beginPath();
        g.arc(x - r * 0.3, y - r * 0.35, r * 0.38, 0, Math.PI * 2);
        g.fillStyle = `rgba(255,255,255,${0.95 * k})`;
        g.fill();
      }
    }
    // Barras de crecimiento de las plantas que aún no maduran.
    if (this.entered) this.drawTreeLabels(g, now);
    if (this.entered && cam.zoom >= 0.9) {
      const today = this.world.flowers.length;
      for (let day = Math.max(1, today - 6); day <= today; day++) {
        const f = this.world.flowerByDay(day);
        if (!f || this.appear.has(day)) continue;
        const age = today - day, p = cam.project(f.position.x, BED_H, f.position.y / this.H);
        if (p.w <= 0 || p.x < -40 || p.y < -40 || p.x > this.width + 40 || p.y > this.height + 40) continue;
        const w = Math.round(Math.min(30, Math.max(18, 12 * cam.zoom * f.scale))), h = 4, x = p.x - w / 2, y = p.y + 6;
        this.pill(g, x - 1.5, y - 1.5, w + 3, h + 3, "rgba(28,40,33,.45)");
        this.pill(g, x, y, w, h, "rgba(250,243,221,.88)");
        this.pill(g, x, y, Math.max(h, (w * (age + 1)) / 8), h, f.growthStage >= 4 ? "#e58fb8" : "#6f9a5b");
      }
    }
    this.life.drawWorld(g, cam, dpr, now);
    this.water.draw(g, dpr, now);
    this.life.drawScreen(g, this.width, this.height, dpr, now, this.look.night);
    this.life.drawGlow(g, this.width, this.height, dpr, now, this.look.night);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
  }

  pill(g, x, y, w, h, color) {
    g.beginPath();
    g.roundRect ? g.roundRect(x, y, w, h, h / 2) : g.rect(x, y, w, h);
    g.fillStyle = color;
    g.fill();
  }

  rgba(hex, a) {
    const [r, gg, b] = hexToRgb(hex);
    return `rgba(${(r * 255) | 0},${(gg * 255) | 0},${(b * 255) | 0},${a})`;
  }

  // --- Respaldo 2D ---

  toFallback(reason) {
    if (this.fb) return;
    console.warn(`jardín 3D: se usa el jardín 2D (${reason})`);
    const state = { world: this.world, insets: this.camera.insets, mode: this.mode, motion: this.motion, reduce: this.reduceEffects, look: this.lookTo, selected: this.selected, running: this.running };
    this.stop();
    this.detach?.();
    this.resizeObs?.disconnect();
    window.removeEventListener("orientationchange", this.onOrientation);
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.canvas.remove();
    this.overlay.remove();
    const fb = new this.deps.Scene2D(this.host, this.events);
    this.fb = fb;
    fb.setEntered?.(this.entered);
    fb.setTrees?.(this.treeInput);
    fb.setInsets(state.insets.top, state.insets.bottom, state.insets.left, state.insets.right);
    fb.setMotion(state.motion, state.reduce);
    const name = Object.keys(this.deps.looks).find((k) => this.deps.looks[k] === state.look);
    if (name) fb.setLight(name, true);
    if (state.world) fb.setFlowers(state.world, false);
    fb.setMode(state.mode);
    if (state.selected) fb.select(state.selected);
    // Si el contexto se perdió, la escena ya se había detenido: el 2D arranca si la página está visible.
    if (state.running || !document.hidden) fb.start();
  }
}

// Cuando hay respaldo 2D, todas las llamadas de la app se le pasan a él.
for (const name of Object.getOwnPropertyNames(Scene3D.prototype)) {
  if (name === "constructor" || name === "toFallback") continue;
  const desc = Object.getOwnPropertyDescriptor(Scene3D.prototype, name);
  if (typeof desc.value === "function") {
    const fn = desc.value;
    Scene3D.prototype[name] = function (...args) {
      return this.fb ? this.fb[name]?.(...args) : fn.apply(this, args);
    };
  } else if (desc.get) {
    const get = desc.get;
    Object.defineProperty(Scene3D.prototype, name, { get() { return this.fb ? this.fb[name] : get.call(this); }, configurable: true });
  }
}
