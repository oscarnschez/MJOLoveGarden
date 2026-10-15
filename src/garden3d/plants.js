// Plantas 3D procedurales: una geometría por especie, forma y etapa de crecimiento.
// Los pétalos se pintan con la paleta de cada flor en el shader (modo 1 = degradado,
// modo 2 = centro); tallos y hojas llevan su color fijo (modos 0 y 3).
import { add, cross, dot, hexToRgb, hashString, lerp, norm, perpendicular, rng, scale, sub } from "./math.js";

const F = 11; // floats por vértice: posición 3, normal 3, color 3, modo, t
const DEG = Math.PI / 180;
// Versión liviana para ver de lejos: menos pétalos, segmentos y caras.
let LITE = false;

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.i = [];
  }
  get n() {
    return this.v.length / F;
  }
  vert(p, nrm, col, mode, t) {
    this.v.push(p[0], p[1], p[2], nrm[0], nrm[1], nrm[2], col[0], col[1], col[2], mode, t);
    return this.n - 1;
  }
  tri(a, b, c) {
    this.i.push(a, b, c);
  }
  // Normales suaves para los vértices desde v0 con los triángulos desde i0.
  normals(v0, i0) {
    const v = this.v, acc = new Float64Array((this.n - v0) * 3);
    for (let k = i0; k < this.i.length; k += 3) {
      const a = this.i[k], b = this.i[k + 1], c = this.i[k + 2];
      const pa = [v[a * F], v[a * F + 1], v[a * F + 2]];
      const pb = [v[b * F], v[b * F + 1], v[b * F + 2]];
      const pc = [v[c * F], v[c * F + 1], v[c * F + 2]];
      const fn = cross(sub(pb, pa), sub(pc, pa));
      for (const x of [a, b, c]) {
        const j = (x - v0) * 3;
        acc[j] += fn[0];
        acc[j + 1] += fn[1];
        acc[j + 2] += fn[2];
      }
    }
    for (let x = v0; x < this.n; x++) {
      const j = (x - v0) * 3, l = Math.hypot(acc[j], acc[j + 1], acc[j + 2]) || 1;
      v[x * F + 3] = acc[j] / l;
      v[x * F + 4] = acc[j + 1] / l;
      v[x * F + 5] = acc[j + 2] / l;
    }
  }
}

// Perfiles de ancho a lo largo de hojas y pétalos (u de 0 en la base a 1 en la punta).
const P = {
  leaf: (u) => Math.pow(Math.sin(Math.PI * Math.min(0.985, u * 0.97 + 0.02)), 0.75),
  round: (u) => Math.pow(Math.sin(Math.PI * (0.1 + 0.85 * u)), 0.6),
  point: (u) => Math.pow(Math.sin(Math.PI * Math.min(0.985, u * 0.95 + 0.03)), 0.8),
  strap: (u) => Math.min(1, u * 5 + 0.25) * (1 - Math.pow(u, 6) * 0.75),
  wedge: (u) => (0.3 + 0.7 * u) * (1 - Math.pow(u, 7) * 0.5),
  tulip: (u) => Math.pow(Math.sin(Math.PI * (0.06 + 0.88 * u)), 0.45),
  cotyledon: (u) => Math.pow(Math.sin(Math.PI * (0.05 + 0.9 * u)), 0.5),
};

// Superficie (hoja o pétalo) que sigue una espina curva.
function sheet(b, o) {
  const {
    origin, side, length, width, profile = P.leaf, cols = 1, fold = 0.3,
    curl = 0, curlTip = 0, color = [0, 0, 0], mode = 1, t0 = 0, t1 = 1, baseShade = 0.82,
  } = o;
  const want = o.segs ?? 3, segs = LITE ? Math.max(1, Math.round(want / 2)) : want;
  const v0 = b.n, i0 = b.i.length;
  let p = origin.slice(), d = norm(o.dir), n = norm(cross(d, side));
  const ds = length / segs, rows = [];
  for (let s = 0; s <= segs; s++) {
    const u = s / segs, w = width * profile(u), row = [];
    for (let c = -cols; c <= cols; c++) {
      const k = c / cols;
      const q = add(add(p, scale(side, w * k * 0.5)), scale(n, fold * w * k * k * 0.5));
      const col = mode === 1 ? color : scale(color, baseShade + (1 - baseShade) * u);
      row.push(b.vert(q, n, col, mode, mode === 1 ? lerp(t0, t1, u) : mode === 2 ? lerp(t0, t1, u) : 0));
    }
    rows.push(row);
    const bend = curl / segs + curlTip * (u * u) * 2.2 / segs;
    d = norm(add(scale(d, Math.cos(bend)), scale(n, Math.sin(bend))));
    n = norm(cross(d, side));
    p = add(p, scale(d, ds));
  }
  for (let s = 0; s < segs; s++)
    for (let c = 0; c < 2 * cols; c++) {
      const a = rows[s][c], e = rows[s][c + 1], f = rows[s + 1][c], g = rows[s + 1][c + 1];
      b.tri(a, f, e);
      b.tri(e, f, g);
    }
  b.normals(v0, i0);
}

// Tallo: tubo a lo largo de una curva, más delgado hacia arriba. Con radii se da el radio
// de cada anillo, y con mode 1 se pinta con el degradado de la paleta (espigas de lavanda).
function tube(b, pts, r0, r1, color, sides = 5, { radii = null, mode = 0, t0 = 0, t1 = 1 } = {}) {
  if (LITE && !radii) {
    sides = 3;
    if (pts.length > 3) pts = pts.filter((_, k) => k % 2 === 0 || k === pts.length - 1);
  }
  const i0 = b.i.length, rings = [];
  let prevN = perpendicular(norm(sub(pts[1], pts[0])));
  for (let k = 0; k < pts.length; k++) {
    const t = norm(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]));
    const nn = norm(sub(prevN, scale(t, dot(prevN, t))));
    prevN = nn;
    const f = k / (pts.length - 1), bi = cross(t, nn), r = radii ? radii[k] : lerp(r0, r1, f), ring = [];
    const shade = 0.82 + 0.18 * f;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, dv = add(scale(nn, Math.cos(a)), scale(bi, Math.sin(a)));
      ring.push(b.vert(add(pts[k], scale(dv, r)), dv, mode ? [0, 0, 0] : scale(color, shade), mode, lerp(t0, t1, f)));
    }
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++)
    for (let s = 0; s < sides; s++) {
      const a = rings[k][s], c = rings[k][(s + 1) % sides], d = rings[k + 1][s], e = rings[k + 1][(s + 1) % sides];
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
  return i0;
}

// Domo (centro de la flor, montículo de tierra).
function dome(b, c, axis, r, h, { mode = 2, color = [1, 1, 1], tApex = 1.12, tEdge = 0.72, segs = 10 } = {}) {
  if (LITE) segs = 6;
  const v0 = b.n, i0 = b.i.length, u0 = perpendicular(axis), w0 = cross(axis, u0);
  const ring = (rr, hh, t) =>
    Array.from({ length: segs }, (_, s) => {
      const a = (s / segs) * Math.PI * 2;
      const q = add(add(c, scale(axis, hh)), add(scale(u0, Math.cos(a) * rr), scale(w0, Math.sin(a) * rr)));
      return b.vert(q, axis, mode === 2 ? [0, 0, 0] : scale(color, t), mode, t);
    });
  const apex = b.vert(add(c, scale(axis, h)), axis, mode === 2 ? [0, 0, 0] : scale(color, tApex), mode, tApex);
  const mid = ring(r * 0.62, h * 0.78, lerp(tApex, tEdge, 0.4)), edge = ring(r, 0, tEdge);
  for (let s = 0; s < segs; s++) {
    const s1 = (s + 1) % segs;
    b.tri(apex, mid[s], mid[s1]);
    b.tri(mid[s], edge[s], mid[s1]);
    b.tri(mid[s1], edge[s], edge[s1]);
  }
  b.normals(v0, i0);
}

// Bolita de pocas caras (flores diminutas, semillas, estambres).
function bead(b, c, r, { mode = 0, color = [1, 1, 1], t = 1, stretch = 1, axis = [0, 1, 0] } = {}) {
  const v0 = b.n, i0 = b.i.length, u0 = perpendicular(axis), w0 = cross(axis, u0), rows = [];
  const R = 2, C = LITE ? 3 : 4;
  for (let i = 0; i <= R; i++) {
    const ph = (i / R) * Math.PI, row = [];
    for (let j = 0; j < C; j++) {
      const th = (j / C) * Math.PI * 2;
      const dv = add(scale(axis, Math.cos(ph) * stretch), add(scale(u0, Math.sin(ph) * Math.cos(th)), scale(w0, Math.sin(ph) * Math.sin(th))));
      row.push(b.vert(add(c, scale(dv, r)), dv, mode === 1 || mode === 2 ? [0, 0, 0] : color, mode, t));
    }
    rows.push(row);
  }
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) {
      const j1 = (j + 1) % C;
      b.tri(rows[i][j], rows[i + 1][j], rows[i][j1]);
      b.tri(rows[i][j1], rows[i + 1][j], rows[i + 1][j1]);
    }
  b.normals(v0, i0);
}

// Anillo de pétalos alrededor del eje de la flor.
function petalRing(b, c, axis, o, rand) {
  const { r0 = 0, len, wid, rise, curl = 0, curlTip = 0, fold = 0.35, profile = P.round, phase = 0, t0 = 0, t1 = 1, segs = 3, cols = 1, jitter = 0.08 } = o;
  const count = LITE ? Math.max(Math.min(o.count, 5), Math.round(o.count * 0.55)) : o.count;
  const wide = LITE ? Math.min(1.5, o.count / count) : 1;
  const u0 = perpendicular(axis), w0 = cross(axis, u0);
  for (let k = 0; k < count; k++) {
    const a = phase + (k / count) * Math.PI * 2 + (rand() - 0.5) * jitter;
    const rho = add(scale(u0, Math.cos(a)), scale(w0, Math.sin(a)));
    const side = norm(cross(axis, rho));
    const rs = rise + (rand() - 0.5) * 0.12;
    const dir = norm(add(scale(rho, Math.cos(rs)), scale(axis, Math.sin(rs))));
    sheet(b, {
      origin: add(c, scale(rho, r0)), dir, side, length: len * (1 + (rand() - 0.5) * 0.12), width: wid * wide,
      profile, segs, cols, fold, curl, curlTip, mode: 1, t0, t1,
    });
  }
}

function sepals(b, c, axis, r, color, rand, count = 5, rise = 25 * DEG) {
  const u0 = perpendicular(axis), w0 = cross(axis, u0);
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + rand() * 0.4;
    const rho = add(scale(u0, Math.cos(a)), scale(w0, Math.sin(a)));
    const dir = norm(add(scale(rho, Math.cos(rise)), scale(axis, Math.sin(rise))));
    sheet(b, { origin: c, dir, side: norm(cross(axis, rho)), length: r * 0.75, width: r * 0.32, profile: P.point, segs: 2, fold: 0.4, curl: -0.4, mode: 3, color });
  }
}

// Curva del tallo: base en el origen, punta en top, con una curva suave.
function stemCurve(top, bow, n = 6) {
  const ctrl = [top[0] * 0.15 + bow[0], top[1] * 0.55, top[2] * 0.15 + bow[1]];
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = k / n, a = (1 - t) * (1 - t), m = 2 * (1 - t) * t, c = t * t;
    return [a * 0 + m * ctrl[0] + c * top[0], m * ctrl[1] + c * top[1], m * ctrl[2] + c * top[2]];
  });
}

function pointAt(pts, f) {
  const x = f * (pts.length - 1), k = Math.min(pts.length - 2, Math.floor(x)), t = x - k;
  return [lerp(pts[k][0], pts[k + 1][0], t), lerp(pts[k][1], pts[k + 1][1], t), lerp(pts[k][2], pts[k + 1][2], t)];
}

// Hojas alternas a lo largo del tallo.
function stemLeaves(b, pts, o, rand) {
  const { from = 0.12, to = 0.6, len, wid, color, rise = 30 * DEG, curl = -0.7, profile = P.leaf, fold = 0.45, pairs = false } = o;
  const count = LITE ? Math.ceil(o.count / 2) : o.count;
  for (let k = 0; k < count; k++) {
    const f = count === 1 ? from : lerp(from, to, k / (count - 1));
    const at = pointAt(pts, f);
    const yaws = pairs ? [k * 1.7, k * 1.7 + Math.PI] : [k * 2.4 + rand() * 0.6];
    for (const yaw of yaws) {
      const rho = [Math.cos(yaw), 0, Math.sin(yaw)];
      const dir = norm(add(scale(rho, Math.cos(rise)), [0, Math.sin(rise), 0]));
      const sc = 1 - f * 0.35;
      sheet(b, { origin: at, dir, side: norm(cross([0, 1, 0], rho)), length: len * sc * (0.9 + rand() * 0.2), width: wid * sc, profile, segs: 4, fold, curl, mode: 3, color });
    }
  }
}

// Hojas que salen del suelo (tulipán, lavanda, anémona...).
function basalLeaves(b, o, rand) {
  const { len, wid, color, rise = 70 * DEG, curl = -0.9, profile = P.leaf, fold = 0.5, phase = 0 } = o;
  const count = LITE ? Math.ceil(o.count / 2) : o.count;
  for (let k = 0; k < count; k++) {
    const yaw = phase + (k / count) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const rho = [Math.cos(yaw), 0, Math.sin(yaw)];
    const rs = rise + (rand() - 0.5) * 0.2;
    const dir = norm(add(scale(rho, Math.cos(rs)), [0, Math.sin(rs), 0]));
    sheet(b, { origin: scale(rho, 1.2), dir, side: norm(cross([0, 1, 0], rho)), length: len * (0.85 + rand() * 0.3), width: wid, profile, segs: 4, fold, curl, mode: 3, color });
  }
}

const TILT = {
  girasol: 0.95, margarita: 0.55, cosmos: 0.6, anemona: 0.5, silvestre: 0.5, jazmin: 0.4,
  camelia: 0.45, gardenia: 0.4, dalia: 0.5, rosa: 0.35, peonia: 0.3, tulipan: 0.2, hortensia: 0.15, lavanda: 0,
};

// Cabeza de flor según especie. open: 0 botón, 0.8 abierta, 1 madura.
function head(b, sp, variety, c, axis, R, open, rand) {
  const id = sp.id, leaf = hexToRgb(sp.leafColor);
  const L = (a, z) => lerp(a, z, open);
  if (open === 0 && id !== "hortensia" && id !== "lavanda" && id !== "jazmin") {
    // Botón cerrado con sépalos.
    const tall = id === "tulipan" ? 1.35 : id === "girasol" ? 0.7 : 1;
    petalRing(b, add(c, scale(axis, -R * 0.1)), axis, { count: 5, len: R * 0.95 * tall, wid: R * 0.9, rise: 76 * DEG, curl: 0.9, fold: 0.55, t0: 0, t1: 0.62, profile: P.tulip }, rand);
    sepals(b, add(c, scale(axis, -R * 0.12)), axis, R * 0.9, leaf, rand);
    return;
  }
  switch (id) {
    case "rosa":
      petalRing(b, c, axis, { count: 5, len: R * 0.62, wid: R * 0.62, rise: 72 * DEG, curl: 0.6, fold: 0.6, t0: 0, t1: 0.55 }, rand);
      petalRing(b, c, axis, { count: 6, r0: R * 0.08, len: R * 0.86, wid: R * 0.8, rise: L(70, 46) * DEG, curl: 0.3, fold: 0.5, phase: 0.5, t0: 0.15, t1: 0.82 }, rand);
      petalRing(b, c, axis, { count: 7, r0: R * 0.14, len: R * 1.0, wid: R * 0.95, rise: L(58, 20) * DEG, curl: 0.1, curlTip: -0.45 * open, fold: 0.42, phase: 0.2, t0: 0.3, t1: 1 }, rand);
      dome(b, add(c, scale(axis, R * 0.15)), axis, R * 0.16, R * 0.08, { tApex: 0.9, tEdge: 0.7 });
      sepals(b, add(c, scale(axis, -R * 0.08)), axis, R * 0.8, leaf, rand, 5, -15 * DEG);
      return;
    case "camelia":
      petalRing(b, c, axis, { count: 6, r0: R * 0.1, len: R * 0.75, wid: R * 0.72, rise: L(60, 36) * DEG, curl: 0.25, fold: 0.35, t0: 0.15, t1: 0.85 }, rand);
      petalRing(b, c, axis, { count: 7, r0: R * 0.15, len: R * 1.0, wid: R * 0.95, rise: L(40, 12) * DEG, curl: 0.12, fold: 0.3, phase: 0.45, t0: 0.3, t1: 1 }, rand);
      for (let k = 0; k < (LITE ? 0 : 9); k++) {
        const a = (k / 9) * Math.PI * 2, u0 = perpendicular(axis), w0 = cross(axis, u0);
        bead(b, add(add(c, scale(axis, R * 0.22)), add(scale(u0, Math.cos(a) * R * 0.13), scale(w0, Math.sin(a) * R * 0.13))), R * 0.06, { mode: 2, t: 1.1 });
      }
      return;
    case "peonia": {
      const layers = [[6, 82, 0.55, 0.55], [8, 64, 0.72, 0.4], [9, 44, 0.9, 0.25], [10, L(32, 20), 1.05, 0.1]];
      layers.forEach(([count, rise, len, curl], i) =>
        petalRing(b, c, axis, { count, r0: R * 0.06 * i, len: R * len, wid: R * len * 0.95, rise: rise * DEG, curl, fold: 0.7, phase: i * 0.37, t0: 0.1 + i * 0.1, t1: 0.6 + i * 0.13 }, rand),
      );
      return;
    }
    case "tulipan":
      petalRing(b, c, axis, { count: 3, len: R * 1.4, wid: R * 0.98, rise: L(84, 66) * DEG, curl: L(0.45, 0.25), fold: 0.5, profile: P.tulip, t0: 0.05, t1: 1 }, rand);
      petalRing(b, c, axis, { count: 3, r0: R * 0.05, len: R * 1.42, wid: R * 1.0, rise: L(82, 60) * DEG, curl: L(0.42, 0.2), fold: 0.5, profile: P.tulip, phase: Math.PI / 3, t0: 0.05, t1: 1 }, rand);
      return;
    case "gardenia":
      [[5, 62, 0.6], [6, 36, 0.82], [7, 12, 1.0]].forEach(([count, rise, len], i) =>
        petalRing(b, c, axis, { count, r0: R * 0.05 * i, len: R * len, wid: R * len * 0.82, rise: L(rise + 15, rise) * DEG, curl: -0.12, fold: 0.25, phase: i * 0.6, t0: 0.35, t1: 1 }, rand),
      );
      dome(b, add(c, scale(axis, R * 0.1)), axis, R * 0.12, R * 0.08, { tApex: 1.05 });
      return;
    case "margarita":
      petalRing(b, c, axis, { count: 22, r0: R * 0.22, len: R * 0.95, wid: R * 0.24, rise: L(26, 6) * DEG, curl: -0.18, fold: 0.15, profile: P.strap, t0: 0.55, t1: 1, segs: 2, jitter: 0.04 }, rand);
      dome(b, c, axis, R * 0.32, R * 0.2, {});
      return;
    case "cosmos":
      petalRing(b, c, axis, { count: 8, r0: R * 0.14, len: R * 1.0, wid: R * 0.62, rise: L(34, 10) * DEG, curl: 0.12, fold: 0.22, profile: P.wedge, t0: 0.2, t1: 1 }, rand);
      dome(b, c, axis, R * 0.2, R * 0.14, {});
      return;
    case "anemona":
      petalRing(b, c, axis, { count: 6, r0: R * 0.1, len: R * 1.0, wid: R * 0.88, rise: L(56, 28) * DEG, curl: 0.22, fold: 0.35, t0: 0.25, t1: 1 }, rand);
      dome(b, add(c, scale(axis, R * 0.05)), axis, R * 0.3, R * 0.2, { tApex: 1.25, tEdge: 0.9 });
      for (let k = 0; k < (LITE ? 0 : 10); k++) {
        const a = (k / 10) * Math.PI * 2, u0 = perpendicular(axis), w0 = cross(axis, u0);
        bead(b, add(add(c, scale(axis, R * 0.1)), add(scale(u0, Math.cos(a) * R * 0.36), scale(w0, Math.sin(a) * R * 0.36))), R * 0.05, { mode: 2, t: 0.8 });
      }
      return;
    case "dalia":
      [[14, 8, 1.05, 0.3], [12, 38, 0.8, 0.28], [10, 64, 0.58, 0.26], [7, 82, 0.36, 0.24]].forEach(([count, rise, len, wid], i) =>
        petalRing(b, c, axis, { count, r0: R * 0.04 * (3 - i), len: R * len, wid: R * wid * 1.1, rise: L(rise + 18, rise) * DEG, curl: 0.15, fold: 0.95, profile: P.point, phase: i * 0.29, t0: 0.15 + i * 0.05, t1: 1 - i * 0.12, segs: 3 }, rand),
      );
      return;
    case "girasol":
      petalRing(b, c, axis, { count: 20, r0: R * 0.42, len: R * 0.72, wid: R * 0.26, rise: L(22, 4) * DEG, curl: -0.1, fold: 0.3, profile: P.point, t0: 0.4, t1: 1, segs: 2, jitter: 0.05 }, rand);
      petalRing(b, c, axis, { count: 18, r0: R * 0.4, len: R * 0.62, wid: R * 0.24, rise: L(32, 14) * DEG, curl: -0.05, fold: 0.3, profile: P.point, phase: 0.17, t0: 0.25, t1: 0.9, segs: 2, jitter: 0.05 }, rand);
      dome(b, add(c, scale(axis, R * 0.02)), axis, R * 0.46, R * 0.12, { tApex: 1.05, tEdge: 0.75, segs: 12 });
      sepals(b, add(c, scale(axis, -R * 0.06)), axis, R * 0.75, leaf, rand, 8, -5 * DEG);
      return;
    case "hortensia": {
      // Bola de florecitas de cuatro pétalos.
      const center = add(c, scale(axis, R * 0.55)), n = LITE ? 12 : open === 0 ? 16 : 24;
      for (let k = 0; k < n; k++) {
        const y = 1 - (k + 0.5) / n * 1.25, r = Math.sqrt(Math.max(0, 1 - y * y)), th = k * 2.39996;
        const dv = norm([Math.cos(th) * r, y, Math.sin(th) * r]);
        const at = add(center, scale(dv, R * 0.85));
        if (open === 0) bead(b, at, R * 0.16, { mode: 1, t: 0.15 + rand() * 0.3 });
        else {
          petalRing(b, at, dv, { count: 4, len: R * 0.36, wid: R * 0.34, rise: 12 * DEG, curl: -0.1, fold: 0.2, phase: rand() * 3, t0: 0.35, t1: 1, segs: 2 }, rand);
        }
      }
      return;
    }
    case "jazmin":
      // La cabeza son varias estrellitas de cinco pétalos.
      for (let k = 0; k < 4; k++) {
        const a = k * 1.9 + rand() * 0.5, off = [Math.cos(a) * R * 0.75, (rand() - 0.3) * R * 0.5, Math.sin(a) * R * 0.75];
        const ax = norm(add(axis, [off[0] * 0.04, 0.2, off[2] * 0.04]));
        const at = add(c, off);
        if (open === 0) bead(b, at, R * 0.14, { mode: 1, t: 0.7, stretch: 1.8, axis: ax });
        else {
          petalRing(b, at, ax, { count: 5, len: R * 0.5, wid: R * 0.3, rise: 6 * DEG, curl: -0.15, fold: 0.2, profile: P.point, phase: rand() * 3, t0: 0.5, t1: 1, segs: 2 }, rand);
          bead(b, at, R * 0.05, { mode: 2, t: 1 });
        }
      }
      return;
    case "silvestre":
      if (variety === 0) {
        // Amapola: cuatro pétalos anchos y centro oscuro.
        petalRing(b, c, axis, { count: 4, r0: R * 0.08, len: R * 0.95, wid: R * 1.1, rise: L(58, 34) * DEG, curl: 0.3, fold: 0.45, t0: 0.3, t1: 1 }, rand);
        dome(b, add(c, scale(axis, R * 0.05)), axis, R * 0.2, R * 0.18, { tApex: 1.2, tEdge: 0.9 });
      } else if (variety === 1) {
        // Aciano: corona de florecitas en embudo.
        petalRing(b, c, axis, { count: 9, r0: R * 0.2, len: R * 0.8, wid: R * 0.36, rise: L(36, 20) * DEG, curl: 0.1, fold: 0.9, profile: P.point, t0: 0.2, t1: 1 }, rand);
        petalRing(b, c, axis, { count: 6, r0: R * 0.08, len: R * 0.42, wid: R * 0.3, rise: 62 * DEG, fold: 0.9, profile: P.point, phase: 0.3, t0: 0, t1: 0.6 }, rand);
        dome(b, c, axis, R * 0.18, R * 0.1, { tApex: 1, tEdge: 0.8 });
      } else {
        // Nomeolvides: ramillete de flores diminutas.
        for (let k = 0; k < 6; k++) {
          const a = k * 2.2 + rand(), at = add(c, [Math.cos(a) * R * 0.55, (rand() - 0.5) * R * 0.4, Math.sin(a) * R * 0.55]);
          petalRing(b, at, axis, { count: 5, len: R * 0.32, wid: R * 0.3, rise: 10 * DEG, fold: 0.2, phase: rand() * 3, t0: 0.4, t1: 1, segs: 2 }, rand);
          bead(b, add(at, scale(axis, R * 0.03)), R * 0.07, { mode: 2, t: 1 });
        }
      }
      return;
  }
}

function seedMound(b) {
  const soil = hexToRgb("#7a5b3e");
  dome(b, [0, -0.3, 0], [0, 1, 0], 7, 2.6, { mode: 0, color: soil, tApex: 1.05, tEdge: 0.8, segs: 12 });
  bead(b, [0.6, 2.4, 0.4], 1.1, { color: hexToRgb("#c9a46a"), stretch: 1.4, axis: norm([0.3, 1, 0.2]) });
}

function sprout(b, sp, rand) {
  const leaf = hexToRgb(sp.leafColor), stem = hexToRgb(sp.stemColor);
  const top = [(rand() - 0.5) * 1.5, 10, (rand() - 0.5) * 1.5];
  tube(b, stemCurve(top, [0.5, 0], 3), 0.7, 0.5, stem, 4);
  dome(b, [0, -0.2, 0], [0, 1, 0], 4.5, 1.2, { mode: 0, color: hexToRgb("#7a5b3e"), segs: 8 });
  for (const s of [-1, 1]) {
    const rho = [s * 0.95, 0, 0.3 * s];
    sheet(b, { origin: top, dir: norm([rho[0], 0.55, rho[2]]), side: norm(cross([0, 1, 0], norm(rho))), length: 6, width: 4, profile: P.cotyledon, segs: 3, fold: 0.5, curl: -0.4, mode: 3, color: scale(leaf, 1.15) });
  }
}

// Construye la geometría de una planta. Devuelve vértices, índices y medidas de la cabeza.
export function buildPlant(sp, variety, shape, stage, lite = false) {
  LITE = lite;
  const b = new MeshBuilder(), rand = rng(hashString(`${sp.id}|${variety}|${shape}|${stage}`));
  const leaf = hexToRgb(sp.leafColor), stem = hexToRgb(sp.stemColor), id = sp.id;
  let headAt = [0, 4, 0], radius = 8, top = 8;
  if (stage === 0) {
    seedMound(b);
    return finish(b, [0, 3, 0], 7, 4);
  }
  if (stage === 1) {
    sprout(b, sp, rand);
    return finish(b, [0, 10, 0], 7, 12);
  }
  const grown = stage === 2 ? 0.45 : stage === 3 ? 0.86 : stage === 4 ? 0.95 : 1;
  const H = sp.height * 1.08 * grown * (0.94 + shape * 0.04);
  const open = stage === 3 ? 0 : stage === 4 ? 0.8 : 1;
  const R = sp.headRadius * (stage === 4 ? 0.88 : stage === 3 ? 0.7 : 1);
  const bow = [(rand() - 0.5) * 5 + (shape - 1) * 2.5, (rand() - 0.5) * 3];
  const tip = [bow[0] * 0.9, H, bow[1] * 0.4];
  const axis = norm([tip[0] * 0.01, 1, TILT[id] ?? 0.4]);

  if (id === "lavanda") {
    // Varias espigas desde una mata de hojas finas.
    basalLeaves(b, { count: 9, len: H * 0.32, wid: 1.6, color: leaf, rise: 65 * DEG, curl: -0.5, profile: P.strap, fold: 0.3 }, rand);
    const spikes = 5 + shape;
    for (let k = 0; k < spikes; k++) {
      const a = (k / spikes) * Math.PI * 2 + rand() * 0.5, spread = 0.12 + rand() * 0.1;
      const t = [Math.cos(a) * H * spread, H * (0.82 + rand() * 0.22), Math.sin(a) * H * spread * 0.7];
      const pts = stemCurve(t, [0, 0], 5);
      tube(b, pts, 0.55, 0.35, stem, 4);
      if (stage === 2) continue;
      // Espiga: tubo abultado (un bulto por verticilo de florecitas) con el color de la paleta.
      const from = 0.6, n = LITE ? 6 : 12, sp = [], radii = [];
      for (let q = 0; q <= n; q++) {
        sp.push(pointAt(pts, from + (q / n) * (1 - from)));
        radii.push((q % 2 ? 0.7 : 1.35) * (1 - (q / n) * 0.5) * (stage === 3 ? 0.75 : 1) + (q === n ? -0.6 : 0));
      }
      tube(b, sp, 0, 0, null, LITE ? 4 : 5, { radii, mode: 1, t0: stage === 3 ? 0.05 : 0.15, t1: stage === 3 ? 0.4 : 0.95 });
    }
    return finish(b, [0, H * 0.85, 0], sp.headRadius * 1.3, H);
  }

  if (id === "jazmin" || id === "gardenia" || id === "camelia" || id === "hortensia") {
    // Arbustos: varios tallos con hojas brillantes; la flor arriba del tallo principal.
    const stems = id === "hortensia" ? 3 : id === "jazmin" ? 4 : 3;
    const leafLen = id === "jazmin" ? 7 : id === "hortensia" ? 14 : 11;
    const leafWid = id === "jazmin" ? 3.6 : id === "hortensia" ? 9 : 6;
    for (let k = 0; k < stems; k++) {
      const main = k === 0, a = k * 2.3 + rand();
      const h = main ? H : H * (0.55 + rand() * 0.25);
      const t = main ? tip : [Math.cos(a) * H * 0.28, h, Math.sin(a) * H * 0.2];
      const pts = stemCurve(t, main ? bow : [Math.cos(a) * 3, Math.sin(a) * 2], 5);
      tube(b, pts, 1.0, 0.6, stem, 5);
      stemLeaves(b, pts, { count: id === "jazmin" ? 4 : 3, from: 0.3, to: 0.92, len: leafLen, wid: leafWid, color: leaf, rise: 18 * DEG, curl: -0.45, fold: 0.35, pairs: id !== "jazmin" }, rand);
    }
    if (stage === 2) return finish(b, [tip[0], H * 0.8, tip[2]], 10, H);
    const c = add(tip, scale(axis, sp.headRadius * 0.15));
    head(b, sp, variety, c, axis, R, open, rand);
    return finish(b, id === "hortensia" ? add(c, [0, R * 0.6, 0]) : c, R * (id === "hortensia" || id === "jazmin" ? 1.5 : 1.1), H + R);
  }

  // Planta de un tallo con hojas, o con hojas basales.
  const pts = stemCurve(tip, bow, 6);
  if (id === "tulipan") {
    basalLeaves(b, { count: 2, len: H * (stage === 2 ? 0.95 : 0.62), wid: 9, color: leaf, rise: 78 * DEG, curl: -0.7, profile: P.leaf, fold: 0.6, phase: rand() * 3 }, rand);
    if (stage === 2) return finish(b, [0, H * 0.6, 0], 9, H);
  } else if (id === "anemona" || id === "silvestre") {
    basalLeaves(b, { count: 5, len: id === "anemona" ? 11 : 8, wid: id === "anemona" ? 6 : 3, color: leaf, rise: 38 * DEG, curl: -0.8, profile: P.point, fold: 0.5, phase: rand() * 3 }, rand);
  }
  const thick = id === "girasol" ? 1.8 : id === "dalia" || id === "peonia" ? 1.2 : 0.95;
  tube(b, pts, thick, thick * 0.65, stem, id === "girasol" ? 6 : 5);
  const leafSpec = {
    rosa: { count: 4, len: 11, wid: 6.5 }, peonia: { count: 4, len: 13, wid: 7 }, margarita: { count: 3, len: 10, wid: 3 },
    dalia: { count: 4, len: 13, wid: 7 }, girasol: { count: 5, len: 22, wid: 17 }, cosmos: { count: 5, len: 11, wid: 1.5 },
    anemona: { count: 1, len: 7, wid: 4 }, silvestre: { count: 2, len: 6, wid: 2 },
  }[id];
  if (leafSpec) {
    stemLeaves(b, pts, { ...leafSpec, count: stage === 2 ? Math.max(1, leafSpec.count - 1) : leafSpec.count, from: 0.14, to: stage === 2 ? 0.8 : 0.62, color: leaf, curl: id === "girasol" ? -0.9 : -0.7, fold: id === "cosmos" ? 0.1 : 0.45, profile: id === "cosmos" || id === "margarita" ? P.strap : P.leaf, pairs: id === "rosa" || id === "peonia" || id === "dalia" }, rand);
  }
  if (stage === 2) return finish(b, [tip[0], H * 0.85, tip[2]], 9, H);
  const c = add(tip, scale(axis, R * 0.05));
  head(b, sp, variety, c, axis, R, open, rand);
  headAt = add(c, scale(axis, R * 0.25));
  radius = R * 1.1;
  top = H + R;
  return finish(b, headAt, radius, top);
}

export function finish(b, head, radius, height) {
  const vertices = new Float32Array(b.v);
  const indices = b.n > 65535 ? new Uint32Array(b.i) : new Uint16Array(b.i);
  return { vertices, indices, head, radius, height: Math.max(4, height) };
}

// Florecitas en círculo alrededor de las flores de días especiales.
export function buildMilestoneRing(lite = false) {
  LITE = lite;
  const b = new MeshBuilder(), rand = rng(77);
  const white = hexToRgb("#fbf6ea"), yellow = hexToRgb("#e9c46a"), stem = hexToRgb("#6c9563");
  const n = lite ? 8 : 14, r = 19;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + rand() * 0.2, at = [Math.cos(a) * r, 3 + rand() * 1.5, Math.sin(a) * r];
    tube(b, [[at[0], 0, at[2]], at], 0.3, 0.25, stem, 3);
    const ax = norm([0, 1, 0.45]), u0 = perpendicular(ax), w0 = cross(ax, u0);
    for (let q = 0; q < 5; q++) {
      const aa = (q / 5) * Math.PI * 2 + rand();
      const rho = add(scale(u0, Math.cos(aa)), scale(w0, Math.sin(aa)));
      sheet(b, { origin: at, dir: norm(add(rho, scale(ax, 0.15))), side: norm(cross(ax, rho)), length: 2, width: 1.5, profile: P.round, segs: 1, fold: 0.1, mode: 0, color: k % 3 === 0 ? yellow : white, baseShade: 1 });
    }
  }
  return finish(b, [0, 4, 0], r, 6);
}
