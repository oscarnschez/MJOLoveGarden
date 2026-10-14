// Suelo del jardín: prado alrededor, arriate elevado con su borde, caminos de arena,
// y dos texturas que usa el pasto: el contorno del arriate y los claros junto a las plantas.

export const BED_H = 1.2;

// Vértices: posición 3, normal 3, tipo (0 prado, 1 arriba del arriate, 2 borde).
export function buildGround(world, H) {
  const outline = [];
  const n = 160;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2, r = world.blobRadiusAt(a);
    outline.push([Math.cos(a) * r, Math.sin(a) * r, Math.cos(a), Math.sin(a)]);
  }
  const v = [], idx = [];
  const add = (x, y, z, nx, ny, nz, kind) => {
    v.push(x, y, z, nx, ny, nz, kind);
    return v.length / 7 - 1;
  };
  // Prado: disco grande que se pierde en la niebla.
  const meadowR = Math.max(4000, world.blobR * 6);
  const mc = add(0, 0, 0, 0, 1, 0, 0);
  const meadow = [];
  for (let k = 0; k < 64; k++) {
    const a = (k / 64) * Math.PI * 2;
    meadow.push(add(Math.cos(a) * meadowR, 0, Math.sin(a) * meadowR, 0, 1, 0, 0));
  }
  for (let k = 0; k < 64; k++) idx.push(mc, meadow[(k + 1) % 64], meadow[k]);
  // Arriba del arriate: abanico desde el centro, con un anillo intermedio.
  const top = add(0, BED_H, 0, 0, 1, 0, 1);
  const mid = outline.map(([x, z]) => add(x * 0.5, BED_H, z * 0.5, 0, 1, 0, 1));
  const rim = outline.map(([x, z, cx, cz]) => add(x - cx * 1.2, BED_H, z - cz * 1.2, 0, 1, 0, 1));
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    idx.push(top, mid[k1], mid[k]);
    idx.push(mid[k], mid[k1], rim[k1], mid[k], rim[k1], rim[k]);
  }
  // Borde redondeado del arriate.
  const edgeA = outline.map(([x, z, cx, cz]) => add(x - cx * 1.2, BED_H, z - cz * 1.2, cx * 0.5, 0.86, cz * 0.5, 2));
  const edgeB = outline.map(([x, z, cx, cz]) => add(x + cx * 0.3, BED_H - 0.7, z + cz * 0.3, cx * 0.9, 0.4, cz * 0.9, 2));
  const edgeC = outline.map(([x, z, cx, cz]) => add(x + cx * 1.2, -0.05, z + cz * 1.2, cx, 0.1, cz, 2));
  for (let k = 0; k < n; k++) {
    const k1 = (k + 1) % n;
    idx.push(edgeA[k], edgeA[k1], edgeB[k1], edgeA[k], edgeB[k1], edgeB[k]);
    idx.push(edgeB[k], edgeB[k1], edgeC[k1], edgeB[k], edgeC[k1], edgeC[k]);
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}

// Caminos: tiras de arena siguiendo las polilíneas del mundo 2D.
export function buildPaths(world, H) {
  const v = [], idx = [];
  for (const line of world.paths) {
    if (line.length < 2) continue;
    const base = v.length / 5;
    let along = 0;
    line.forEach((p, k) => {
      const a = line[Math.max(0, k - 1)], b = line[Math.min(line.length - 1, k + 1)];
      const tx = b.x - a.x, tz = (b.y - a.y) / H, l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l, nz = tx / l, x = p.x, z = p.y / H;
      if (k > 0) along += Math.hypot(x - line[k - 1].x, z - line[k - 1].y / H);
      const w = p.w * (1 + Math.sin(along * 0.11) * 0.06);
      v.push(x + nx * w, BED_H + 0.12, z + nz * w, along, -1);
      v.push(x - nx * w, BED_H + 0.12, z - nz * w, along, 1);
      if (k > 0) {
        const i = base + k * 2;
        idx.push(i - 2, i, i - 1, i - 1, i, i + 1);
      }
    });
  }
  return { vertices: new Float32Array(v), indices: new Uint32Array(idx) };
}

// Radio del arriate por ángulo, en 16 bits repartidos en rojo y verde.
export function blobTexture(world) {
  const size = 512, data = new Uint8Array(size * 4);
  let max = 0;
  const radii = [];
  for (let i = 0; i < size; i++) {
    const r = world.blobRadiusAt(((i + 0.5) / size) * Math.PI * 2);
    radii.push(r);
    max = Math.max(max, r);
  }
  max *= 1.02;
  radii.forEach((r, i) => {
    const v = (r / max) * 255, hi = Math.floor(v), lo = Math.round((v - hi) * 255);
    data[i * 4] = hi;
    data[i * 4 + 1] = lo;
    data[i * 4 + 3] = 255;
  });
  return { size, data, max, radii };
}

// Claros alrededor de cada planta: el pasto se acorta y la tierra se oscurece un poco.
export function clearingTexture(flowers, H, extent) {
  const size = extent > 700 ? 1024 : extent > 300 ? 512 : 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, size, size);
  const k = size / (extent * 2);
  for (const f of flowers) {
    const x = (f.position.x + extent) * k, y = (f.position.y / H + extent) * k;
    const r = (f.growthStage <= 1 ? 9 : f.growthStage === 2 ? 11 : 14) * f.scale * k;
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.55, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const data = new Uint8Array(g.getImageData(0, 0, size, size).data.buffer);
  return { size, data, rect: [-extent, -extent, 1 / (extent * 2), 1 / (extent * 2)] };
}
