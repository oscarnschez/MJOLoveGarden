// Cámara 3D con el mismo estado que la cámara 2D de la app (centro x/y en coordenadas
// del mundo 2D, zoom en píxeles por unidad), para que el resto de la app no cambie.
// El suelo 3D usa X = x y Z = y / H (H es el aplastamiento vertical de la vista 2D).
import { clamp, invert, lookAt, mat4, multiply, perspective, smooth } from "./math.js";

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const FOV = (30 * Math.PI) / 180;

export class Camera3D {
  constructor(H) {
    this.H = H;
    this.x = 0;
    this.y = 0;
    this.zoom = 1.6;
    this.width = 390;
    this.height = 844;
    this.insets = { top: 80, bottom: 110, left: 0, right: 0 };
    this.minZoom = 0.05;
    this.maxZoom = 4.5;
    this.bounds = { x0: -200, y0: -150, x1: 200, y1: 150 };
    this.flight = null;
    this.vx = 0;
    this.vy = 0;
    this.view = mat4();
    this.proj = mat4();
    this.viewProj = mat4();
    this.invViewProj = mat4();
    this.eye = [0, 0, 0];
    this.pitch = 0.6;
    this.updateMatrices();
  }

  // De lejos se ve casi desde arriba; de cerca, más de lado para que las plantas luzcan en 3D.
  pitchFor(zoom) {
    const t = smooth(clamp((Math.log(zoom) - Math.log(0.45)) / (Math.log(3.2) - Math.log(0.45)), 0, 1));
    return ((56 - 26 * t) * Math.PI) / 180;
  }

  // Unidades del suelo que caben en un píxel vertical en el centro, relativo a la vista 2D.
  groundStretch() {
    return this.H / Math.sin(this.pitch);
  }

  updateMatrices() {
    this.pitch = this.pitchFor(this.zoom);
    const dist = this.height / (2 * this.zoom * Math.tan(FOV / 2));
    const tx = this.x, tz = this.y / this.H;
    this.dist = dist;
    this.eye = [tx, dist * Math.sin(this.pitch), tz + dist * Math.cos(this.pitch)];
    lookAt(this.view, this.eye, [tx, 0, tz], [0, 1, 0]);
    perspective(this.proj, FOV, this.width / this.height, Math.max(2, dist * 0.08), dist * 4 + 4000);
    multiply(this.viewProj, this.proj, this.view);
    invert(this.invViewProj, this.viewProj);
  }

  setViewport(w, h) {
    this.width = w;
    this.height = h;
    this.clampToBounds();
  }

  setBounds(b) {
    this.bounds = b;
    this.minZoom = Math.min(this.fitZoom(b) * 0.8, 1.2);
    this.clampToBounds();
  }

  getBounds() {
    return this.bounds;
  }

  fitZoom(b, pad = 24) {
    const w = Math.max(1, this.width - this.insets.left - this.insets.right - pad * 2);
    const h = Math.max(1, this.height - this.insets.top - this.insets.bottom - pad * 2);
    // En 3D el suelo se ve más alto o más bajo según la inclinación: se corrige iterando.
    let z = Math.min(w / Math.max(1, b.x1 - b.x0), h / Math.max(1, b.y1 - b.y0));
    for (let i = 0; i < 3; i++) {
      const stretch = this.H / Math.sin(this.pitchFor(z));
      z = Math.min(w / Math.max(1, b.x1 - b.x0), (h * stretch) / Math.max(1, b.y1 - b.y0));
    }
    return z;
  }

  stageCenterFor(x, y, zoom) {
    const dx = (this.insets.left - this.insets.right) / 2 / zoom;
    const dy = ((this.insets.top - this.insets.bottom) / 2 / zoom) * (this.H / Math.sin(this.pitchFor(zoom)));
    return { x: x - dx, y: y - dy };
  }

  // Proyecta un punto 3D (X, alto, Z) a píxeles de pantalla.
  project(X, Y, Z) {
    const m = this.viewProj;
    const w = m[3] * X + m[7] * Y + m[11] * Z + m[15];
    const x = (m[0] * X + m[4] * Y + m[8] * Z + m[12]) / w;
    const y = (m[1] * X + m[5] * Y + m[9] * Z + m[13]) / w;
    return { x: (x * 0.5 + 0.5) * this.width, y: (0.5 - y * 0.5) * this.height, w };
  }

  // Coordenadas 2D del mundo (con alto opcional) → pantalla.
  toScreen(x, y, height = 0) {
    return this.project(x, height, y / this.H);
  }

  // Pantalla → punto del suelo, en coordenadas 2D del mundo.
  toWorld(sx, sy, height = 0) {
    const nx = (sx / this.width) * 2 - 1, ny = 1 - (sy / this.height) * 2;
    const m = this.invViewProj;
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, -1), b = un(nx, ny, 1);
    const dy = b[1] - a[1];
    let t = Math.abs(dy) < 1e-6 ? 1 : (height - a[1]) / dy;
    if (t < 0) t = 1;
    const X = a[0] + (b[0] - a[0]) * t, Z = a[2] + (b[2] - a[2]) * t;
    return { x: X, y: Z * this.H };
  }

  visibleRect(margin = 0) {
    const pts = [
      this.toWorld(0, 0), this.toWorld(this.width, 0),
      this.toWorld(0, this.height), this.toWorld(this.width, this.height),
    ];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0: x0 - margin, y0: y0 - margin, x1: x1 + margin, y1: y1 + margin };
  }

  clampToBounds() {
    const b = this.bounds;
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    const hw = Math.max(0, this.width / 2 / this.zoom - 40 / this.zoom);
    const hh = Math.max(0, this.height / 2 / this.zoom - 60 / this.zoom);
    const x0 = b.x0 - hw * 0.25, x1 = b.x1 + hw * 0.25, y0 = b.y0 - hh * 0.25, y1 = b.y1 + hh * 0.25;
    this.x = x0 > x1 ? (b.x0 + b.x1) / 2 : clamp(this.x, x0, x1);
    this.y = y0 > y1 ? (b.y0 + b.y1) / 2 : clamp(this.y, y0, y1);
    this.updateMatrices();
  }

  panBy(dx, dy) {
    this.flight = null;
    this.x -= dx / this.zoom;
    this.y -= (dy / this.zoom) * this.groundStretch();
    this.clampToBounds();
  }

  zoomAt(f, sx, sy) {
    this.flight = null;
    const a = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, this.minZoom, this.maxZoom);
    this.updateMatrices();
    const b = this.toWorld(sx, sy);
    this.x += a.x - b.x;
    this.y += a.y - b.y;
    this.clampToBounds();
  }

  setVelocity(vx, vy) {
    this.vx = vx;
    this.vy = vy;
  }

  stopMotion() {
    this.vx = this.vy = 0;
    this.flight = null;
  }

  flyTo(x, y, zoom, dur = 800, now = performance.now()) {
    const z = clamp(zoom, this.minZoom, this.maxZoom);
    const c = this.stageCenterFor(x, y, z);
    this.vx = this.vy = 0;
    if (dur <= 0) {
      this.x = c.x;
      this.y = c.y;
      this.zoom = z;
      this.flight = null;
      this.clampToBounds();
      return;
    }
    this.flight = { from: { x: this.x, y: this.y, z: this.zoom }, to: { x: c.x, y: c.y, z }, t0: now, dur };
  }

  fit(rect, dur = 800, maxZoom = 2.6, pad = 24) {
    const z = Math.min(this.fitZoom(rect, pad), maxZoom);
    this.flyTo((rect.x0 + rect.x1) / 2, (rect.y0 + rect.y1) / 2, z, dur);
  }

  update(now, dt) {
    if (this.flight) {
      const f = this.flight, t = clamp((now - f.t0) / f.dur, 0, 1), e = ease(t);
      this.zoom = f.from.z * Math.pow(f.to.z / f.from.z, e);
      this.x = f.from.x + (f.to.x - f.from.x) * e;
      this.y = f.from.y + (f.to.y - f.from.y) * e;
      if (t >= 1) {
        this.flight = null;
        this.clampToBounds();
      } else this.updateMatrices();
      return true;
    }
    if (Math.abs(this.vx) > 0.01 || Math.abs(this.vy) > 0.01) {
      this.x -= (this.vx * dt) / this.zoom;
      this.y -= ((this.vy * dt) / this.zoom) * this.groundStretch();
      const k = Math.pow(0.0025, dt / 1000);
      this.vx *= k;
      this.vy *= k;
      this.clampToBounds();
      if (Math.abs(this.vx) < 0.02 && Math.abs(this.vy) < 0.02) this.vx = this.vy = 0;
      return true;
    }
    return false;
  }

  get isFlying() {
    return this.flight !== null;
  }
}
