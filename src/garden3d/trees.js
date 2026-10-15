// Árboles de nacimiento con aspecto natural: roble (kind 0) y cerezo en flor (kind 1).
// growTree genera la estructura (ramas con su grosor y follaje hoja por hoja) que usan
// el modelo 3D (buildTree) y la ilustración del jardín 2D (tree2D). m es la madurez:
// 0 arbolito, 1 árbol adulto; la escena lo escala según la edad.
import { MeshBuilder, finish } from "./plants.js";
import { add, cross, dot, hashString, hexToRgb, lerp, mix3, norm, perpendicular, rng, scale, sub } from "./math.js";

const DEG = Math.PI / 180;

const LOOK = [
  {
    bark: "#6e5d4e", groove: "#40342b", ridge: "#8f7d6b",
    leaves: ["#355f2e", "#41703a", "#4d7e3e", "#5b8c45", "#6b9b4e", "#7da95a", "#4a6b2c"],
  },
  {
    bark: "#4f3430", groove: "#2f1f1c", ridge: "#7a5a51",
    leaves: ["#fff7fa", "#fdeaf1", "#fbd9e5", "#f8c7d8", "#f3b2c9", "#ec9dbb"],
    green: ["#8fae62", "#9cbb6c", "#7fa055"],
  },
];

const cache = new Map();

export function growTree(kind, m) {
  const key = `${kind}|${m}`;
  if (cache.has(key)) return cache.get(key);
  const rand = rng(hashString(`arbol|${key}`)), R = (a, b) => a + rand() * (b - a);
  const oak = kind === 0, look = LOOK[kind];
  const maxDepth = m < 0.2 ? 2 : m < 0.6 ? 3 : 4;
  const branches = [], tips = [];

  // Una rama: tramo curvo que se adelgaza; al final se divide en otras más cortas.
  function grow(start, dir, length, r0, depth) {
    const segs = Math.max(3, Math.min(8, Math.round(length / 5)));
    const last = depth >= maxDepth, rEnd = last ? r0 * 0.35 : r0 * 0.66;
    const pts = [start], radii = [r0];
    let p = start, d = dir;
    for (let i = 1; i <= segs; i++) {
      const f = i / segs;
      const wobble = scale([R(-1, 1), R(-0.5, 0.5), R(-1, 1)], depth === 0 ? 0.05 : 0.15);
      // El roble busca la luz; el cerezo se abre y sus puntas se arquean.
      const tropism = oak ? [0, depth === 0 ? 0.05 : 0.045, 0] : [0, depth <= 1 ? 0.015 : -0.05 * f, 0];
      d = norm(add(add(d, wobble), tropism));
      p = add(p, scale(d, length / segs));
      pts.push(p);
      radii.push(lerp(r0, rEnd, f));
    }
    branches.push({ pts, radii, depth });
    if (last) {
      tips.push({ p, d, pts, depth });
      return;
    }
    const kids = depth === 0 ? (oak ? 4 : 5) : depth === 1 ? 3 : rand() < 0.55 ? 3 : 2;
    const phi0 = rand() * Math.PI * 2;
    for (let k = 0; k < kids; k++) {
      const t = depth === 0 ? R(0.8, 1) : lerp(0.4, 1, (k + 1) / kids) - R(0, 0.12);
      const x = t * segs, i0 = Math.min(segs - 1, Math.floor(x)), fr = x - i0;
      const at = mix3(pts[i0], pts[i0 + 1], fr), rAt = lerp(radii[i0], radii[i0 + 1], fr);
      const along = norm(sub(pts[i0 + 1], pts[i0]));
      const u = perpendicular(along), w = cross(along, u), phi = phi0 + k * 2.39996;
      const axis = add(scale(u, Math.cos(phi)), scale(w, Math.sin(phi)));
      // El primer brote del tronco del roble sigue hacia arriba como guía.
      const leader = oak && depth === 0 && k === 0;
      const theta = (leader ? R(4, 14) : depth === 0 ? (oak ? R(30, 46) : R(40, 56)) : R(28, 52)) * DEG;
      const nd = norm(add(scale(along, Math.cos(theta)), scale(axis, Math.sin(theta))));
      const nl = length * (depth === 0 ? (leader ? 0.82 : oak ? R(0.72, 0.9) : R(0.8, 0.98)) : R(0.6, 0.78));
      grow(at, nd, nl, Math.max(0.22, rAt * (leader ? 0.78 : R(0.6, 0.72))), depth + 1);
    }
  }

  const trunkLen = oak ? 34 + 6 * m : 24 + 4 * m;
  grow([0, -1.2, 0], norm([R(-0.08, 0.08), 1, R(-0.06, 0.06)]), trunkLen, 1 + 4.6 * m, 0);

  // Follaje: racimos de hojas (o de pétalos) en cada punta y a lo largo de las ramas finas.
  const leaves = [];
  const leafLen = oak ? lerp(4.4, 3.2, m) : lerp(2.6, 2, m);
  const spots = [];
  for (const t of tips) {
    spots.push({ c: add(t.p, scale(t.d, 1.5)), r: oak ? lerp(5, 8, m) : lerp(4, 6.5, m), n: oak ? Math.round(lerp(20, 34, m)) : Math.round(lerp(26, 44, m)) });
    // Hojas sobre el último tramo de la rama.
    for (const q of t.pts.slice(Math.floor(t.pts.length * 0.4), -1)) spots.push({ c: q, r: oak ? 4 : 3, n: oak ? 7 : 9 });
  }
  let cx = 0, cy = 0, cz = 0;
  for (const s of spots) {
    cx += s.c[0];
    cy += s.c[1];
    cz += s.c[2];
  }
  const center = [cx / spots.length, cy / spots.length, cz / spots.length];
  for (const s of spots) {
    for (let i = 0; i < s.n; i++) {
      let o;
      do o = [R(-1, 1), R(-1, 1), R(-1, 1)];
      while (dot(o, o) > 1);
      const p = add(s.c, scale(o, s.r));
      const out = norm(add(sub(p, center), [0, 4, 0]));
      const d = norm(add(add([R(-1, 1), R(-0.6, 1), R(-1, 1)], scale(out, 0.9)), [0, oak ? -0.2 : 0.1, 0]));
      const side = norm(cross(d, [R(-1, 1), R(-1, 1), R(-1, 1)]));
      const petal = !oak && !(rand() < 0.08);
      const colors = petal || oak ? look.leaves : look.green;
      const len = leafLen * R(0.8, 1.2) * (petal || oak ? 1 : 1.5);
      leaves.push({ p, d, side, out, len, wid: len * (petal ? R(0.9, 1.1) : oak ? R(0.62, 0.78) : 0.5), col: colors[Math.floor(rand() * colors.length)], petal });
    }
  }
  let height = 0, crown = 0;
  for (const l of leaves) {
    height = Math.max(height, l.p[1] + l.len);
    crown = Math.max(crown, Math.hypot(l.p[0] - center[0], l.p[2] - center[2]) + l.len);
  }
  const tree = { kind, m, branches, leaves, spots, center, crown, height, look };
  cache.set(key, tree);
  return tree;
}

// Corteza: tubo con raíces en la base, surcos y variación de color.
function bark(b, br, look, seed) {
  const { pts, radii, depth } = br;
  const base = hexToRgb(look.bark), groove = hexToRgb(look.groove), ridge = hexToRgb(look.ridge);
  const sides = depth === 0 ? 12 : depth === 1 ? 8 : depth === 2 ? 6 : 4;
  const rings = [];
  let prevN = perpendicular(norm(sub(pts[1], pts[0])));
  for (let k = 0; k < pts.length; k++) {
    const t = norm(sub(pts[Math.min(k + 1, pts.length - 1)], pts[Math.max(k - 1, 0)]));
    const nn = norm(sub(prevN, scale(t, dot(prevN, t))));
    prevN = nn;
    const bi = cross(t, nn), ring = [];
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2, dv = add(scale(nn, Math.cos(a)), scale(bi, Math.sin(a)));
      let r = radii[k];
      // Raíces que se abren en la base del tronco.
      if (depth === 0 && k === 0) r *= 1.6 + 0.6 * Math.pow(Math.max(0, Math.cos(a * 5 + seed)), 3);
      else if (depth === 0 && k === 1) r *= 1.12 + 0.12 * Math.pow(Math.max(0, Math.cos(a * 5 + seed)), 3);
      const furrow = depth <= 1 ? Math.sin(a * (depth === 0 ? 9 : 6) + pts[k][1] * 0.08 + seed) : 0;
      r *= 1 + 0.06 * furrow;
      const col = furrow < -0.35 ? mix3(base, groove, 0.55) : furrow > 0.55 ? mix3(base, ridge, 0.45) : base;
      ring.push(b.vert(add(pts[k], scale(dv, r)), dv, scale(col, 0.85 + 0.15 * Math.min(1, pts[k][1] / 40)), 0, 0));
    }
    rings.push(ring);
  }
  for (let k = 0; k < rings.length - 1; k++)
    for (let s = 0; s < sides; s++) {
      const a = rings[k][s], c = rings[k][(s + 1) % sides], d = rings[k + 1][s], e = rings[k + 1][(s + 1) % sides];
      b.tri(a, d, c);
      b.tri(c, d, e);
    }
}

// Hoja (rombo con la nervadura levantada) o pétalo (redondeado). La normal apunta hacia
// afuera de la copa para que la luz le dé volumen al follaje, como en un árbol de verdad.
function leaf(b, l) {
  const { p, d, side, out, len, wid } = l;
  const face = norm(cross(side, d)), up = dot(face, out) < 0 ? scale(face, -1) : face;
  const at = (f, w, lift = 0) => add(add(add(p, scale(d, len * f)), scale(side, wid * w)), scale(up, lift));
  const n = l.petal ? out : norm(add(scale(up, 0.35), scale(out, 0.65)));
  const col = hexToRgb(l.col), dark = scale(col, l.petal ? 0.9 : 0.8);
  const ring = l.petal
    ? [at(0, 0), at(0.4, -0.5), at(0.92, -0.32), at(0.92, 0.32), at(0.4, 0.5)]
    : [at(0, 0), at(0.42, -0.5, -wid * 0.12), at(1, 0), at(0.42, 0.5, -wid * 0.12)];
  const ids = ring.map((q, i) => b.vert(q, n, i === 0 ? dark : col, 3, 0));
  // Abanico desde la base, con la cara de frente hacia afuera de la copa.
  const front = dot(cross(sub(ring[1], ring[0]), sub(ring[2], ring[0])), up) >= 0;
  for (let i = 1; i < ids.length - 1; i++) front ? b.tri(ids[0], ids[i], ids[i + 1]) : b.tri(ids[0], ids[i + 1], ids[i]);
}

export function buildTree(kind, m) {
  const t = growTree(kind, m), b = new MeshBuilder(), seed = kind * 1.7 + m * 3.1;
  for (const br of t.branches) bark(b, br, t.look, seed);
  for (const l of t.leaves) leaf(b, l);
  return finish(b, t.center, t.crown, t.height);
}

// --- Ilustración 2D ---

// La misma estructura vista de frente y un poco desde arriba, ajustada a 100 de alto.
// Devuelve las medidas para tocar el árbol y paint(ctx) para dibujarlo con la base en (0, 0).
const cache2D = new Map();

export function tree2D(kind, m) {
  const key = `${kind}|${m}`;
  if (cache2D.has(key)) return cache2D.get(key);
  const t = growTree(kind, m), proj = (p) => [p[0], -p[1] * 0.96 + p[2] * 0.28];
  let x0 = 0, x1 = 0, y0 = 0, y1 = -Infinity;
  for (const l of t.leaves) {
    const [x, y] = proj(l.p);
    x0 = Math.min(x0, x - l.len);
    x1 = Math.max(x1, x + l.len);
    y0 = Math.min(y0, y - l.len);
    y1 = Math.max(y1, y + l.len);
  }
  const k = 100 / -y0, P = (p) => proj(p).map((v) => v * k);
  const shape = {
    rx: ((x1 - x0) / 2) * k, ry: ((y1 - y0) / 2) * k, cx: ((x0 + x1) / 2) * k, cy: ((y0 + y1) / 2) * k,
    w0: t.branches[0].radii[0] * k * 1.3, half: Math.max(-x0, x1) * k + 6,
  };
  shape.paint = (g) => paintTree(g, t, P, k);
  cache2D.set(key, shape);
  return shape;
}

const LIGHT = norm([-0.5, 0.75, 0.45]);

function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex).map((v) => Math.round(Math.min(1, v * f) * 255));
  return `rgb(${r},${g},${b})`;
}

function paintTree(g, t, P, k) {
  const look = t.look, oak = t.kind === 0;
  g.save();
  g.lineJoin = "round";
  g.lineCap = "round";
  // Sombra suave en el suelo.
  g.save();
  g.translate(0, 1.5);
  g.scale(1, 0.3);
  const rs = t.crown * k * 0.8, sh = g.createRadialGradient(0, 0, 0, 0, 0, rs);
  sh.addColorStop(0, "rgba(60,80,55,.32)");
  sh.addColorStop(1, "rgba(60,80,55,0)");
  g.fillStyle = sh;
  g.beginPath();
  g.arc(0, 0, rs, 0, Math.PI * 2);
  g.fill();
  g.restore();

  // Follaje en dos capas (detrás y delante de las ramas), cada una agrupada por tono.
  const center = t.center, tones = 7;
  const layers = [new Map(), new Map()];
  for (const l of t.leaves) {
    const light = Math.max(0, dot(l.out, LIGHT)), depth = Math.min(1, Math.hypot(...sub(l.p, center)) / (t.crown * 0.9));
    // Más luz arriba y a la izquierda, y más sombra hacia el interior de la copa.
    const f = Math.min(1, 0.15 + light * 0.6 + depth * 0.35);
    const tone = Math.round(f * (tones - 1)), layer = l.p[2] < center[2] ? 0 : 1, id = `${l.col}|${tone}|${layer}`;
    let list = layers[layer].get(id);
    const lo = oak ? 0.55 : 0.8, span = oak ? 0.7 : 0.28;
    if (!list) layers[layer].set(id, (list = { color: shade(l.col, lo + (tone / (tones - 1)) * span - (layer ? 0 : 0.06)), items: [] }));
    list.items.push(l);
  }
  const drawLeaves = (layer) => {
    for (const { color, items } of layer.values()) {
      g.beginPath();
      for (const l of items) {
        const [x, y] = P(l.p), [tx, ty] = P(add(l.p, scale(l.d, l.len)));
        const dx = tx - x, dy = ty - y, w = l.wid * k * 0.5;
        const nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1);
        if (l.petal) {
          const r = Math.max(0.5, l.len * k * 0.3);
          g.moveTo(x + dx * 0.5 + r, y + dy * 0.5);
          g.arc(x + dx * 0.5, y + dy * 0.5, r, 0, Math.PI * 2);
        } else {
          g.moveTo(x, y);
          g.quadraticCurveTo(x + dx * 0.45 + nx * w, y + dy * 0.45 + ny * w, tx, ty);
          g.quadraticCurveTo(x + dx * 0.45 - nx * w, y + dy * 0.45 - ny * w, x, y);
        }
      }
      g.fillStyle = color;
      g.fill();
    }
  };
  // Masa de follaje en sombra detrás de las hojas, para que la copa se vea llena.
  g.save();
  g.globalAlpha = oak ? 0.85 : 0.45;
  g.fillStyle = oak ? "#2f4f29" : "#e4a3bd";
  g.beginPath();
  for (const s of t.spots) {
    if (s.n < 10) continue;
    const [x, y] = P(s.c), r = s.r * k * 0.5;
    g.moveTo(x + r, y);
    g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
  drawLeaves(layers[0]);

  // Ramas: de las más gruesas a las más finas, con luz del lado izquierdo y surcos en el tronco.
  const branches = t.branches.slice().sort((a, b) => a.depth - b.depth);
  for (const br of branches) {
    const pts = br.pts.map(P), rad = br.radii.map((r) => r * k);
    if (br.depth === 0) rad[0] *= 1.7;
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)];
      const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
      left.push([pts[i][0] - nx * rad[i], pts[i][1] - ny * rad[i]]);
      right.push([pts[i][0] + nx * rad[i], pts[i][1] + ny * rad[i]]);
    }
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const q of left.slice(1)) g.lineTo(q[0], q[1]);
    for (const q of right.reverse()) g.lineTo(q[0], q[1]);
    g.closePath();
    const x0 = Math.min(...pts.map((q) => q[0])) - rad[0], x1 = Math.max(...pts.map((q) => q[0])) + rad[0];
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, look.ridge);
    gr.addColorStop(0.45, look.bark);
    gr.addColorStop(1, look.groove);
    g.fillStyle = gr;
    g.fill();
    if (br.depth <= 1 && rad[0] > 1.2) {
      // Textura de la corteza: surcos verticales en el roble, marcas horizontales en el cerezo.
      g.save();
      g.clip();
      g.strokeStyle = oak ? "rgba(40,30,24,.35)" : "rgba(214,184,172,.28)";
      g.lineWidth = Math.max(0.3, rad[0] * 0.12);
      g.beginPath();
      if (oak)
        for (let s = -2; s <= 2; s++)
          for (let i = 0; i < pts.length - 1; i++) {
            const f = s / 2.5;
            g.moveTo(pts[i][0] + f * rad[i] + Math.sin(i * 1.7 + s) * 0.4, pts[i][1]);
            g.lineTo(pts[i + 1][0] + f * rad[i + 1] + Math.sin(i * 1.7 + s + 1) * 0.4, pts[i + 1][1]);
          }
      else {
        // Lenticelas: marcas cortas y horizontales repartidas sin orden.
        const mark = rng(hashString(`lenticela${t.m}${br.pts.length}`));
        for (let i = 0; i < pts.length - 1; i++)
          for (let s = 0; s < 4; s++) {
            const f = mark(), y = lerp(pts[i][1], pts[i + 1][1], f), x = lerp(pts[i][0], pts[i + 1][0], f), r = lerp(rad[i], rad[i + 1], f);
            const c = (mark() - 0.5) * r * 1.2, w = r * (0.15 + mark() * 0.3);
            g.moveTo(x + c - w, y);
            g.lineTo(x + c + w, y);
          }
      }
      g.stroke();
      g.restore();
    }
  }
  drawLeaves(layers[1]);
  // Centros de las flores del cerezo.
  if (!oak) {
    g.beginPath();
    for (const l of t.leaves) {
      if (!l.petal || l.col === look.leaves[0]) continue;
      const [x, y] = P(add(l.p, scale(l.d, l.len * 0.5)));
      g.moveTo(x + 0.35, y);
      g.arc(x, y, 0.35, 0, Math.PI * 2);
    }
    g.fillStyle = "rgba(196,92,132,.55)";
    g.fill();
  }
  g.restore();
}
