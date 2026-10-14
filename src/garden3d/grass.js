// Pasto del modelo "Patch of Grass": una sola hoja dibujada miles de veces (instancias).
// El parche se repite en mosaicos sobre el arriate. Las hojas que caen fuera del contorno
// o sobre los caminos se descartan una sola vez en la CPU (al cambiar el jardín), y junto a
// las plantas se acortan; así la GPU solo procesa hojas visibles.
import { bindAttribs, buffer } from "./gl.js";

export async function loadGrass(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`pasto: ${res.status}`);
  const buf = await res.arrayBuffer(), dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== "JEG1") throw new Error("pasto: formato");
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true), count = dv.getUint32(12, true);
  const size = dv.getFloat32(16, true), smin = dv.getFloat32(20, true), smax = dv.getFloat32(24, true);
  const ymin = dv.getFloat32(28, true), ymax = dv.getFloat32(32, true);
  let off = 36;
  const verts = new Float32Array(buf.slice(off, off + nv * 32));
  off += nv * 32;
  const indices = new Uint16Array(buf.slice(off, off + ni * 2));
  off += ni * 2;
  off += (4 - (off % 4)) % 4;
  const half = size / 2, inst = new Float32Array(count * 6);
  for (let k = 0; k < count; k++, off += 10) {
    inst[k * 6] = (dv.getInt16(off, true) / 32767) * half;
    inst[k * 6 + 1] = (dv.getInt16(off + 2, true) / 32767) * half;
    inst[k * 6 + 2] = (dv.getUint16(off + 4, true) / 65535) * Math.PI * 2;
    inst[k * 6 + 3] = smin + (dv.getUint8(off + 6) / 255) * (smax - smin);
    inst[k * 6 + 4] = ymin + (dv.getUint8(off + 7) / 255) * (ymax - ymin);
    inst[k * 6 + 5] = (dv.getInt8(off + 8) / 127) * 0.08;
  }
  return { verts, indices, inst, count, size };
}

const MAX_BLADES = 600000;

export class Grass {
  constructor(gl, prog, data) {
    this.gl = gl;
    this.prog = prog;
    this.data = data;
    this.indexCount = data.indices.length;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    bindAttribs(gl, prog, buffer(gl, data.verts), [
      { name: "a_pos", size: 3, offset: 0 },
      { name: "a_nrm", size: 3, offset: 3 },
      { name: "a_uv", size: 2, offset: 6 },
    ], 8);
    this.inst = gl.createBuffer();
    bindAttribs(gl, prog, this.inst, [
      { name: "i_a", size: 4, offset: 0 },
      { name: "i_b", size: 2, offset: 4 },
    ], 6, 1);
    buffer(gl, data.indices, gl.ELEMENT_ARRAY_BUFFER);
    gl.bindVertexArray(null);
    this.tiles = [];
  }

  // Coloca las hojas sobre el arriate. radius(θ) es el contorno, clear(x, z) cuánto despejar
  // junto a las plantas (0–1) y onPath(r, θ) si el punto cae en un camino.
  rebuild({ maxRadius, radius, clear, onPath }) {
    const d = this.data, s = d.size * 0.985, n = Math.ceil(maxRadius / s + 0.5);
    const tiles = [];
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++) {
        const x = i * s, z = j * s;
        const dx = Math.max(Math.abs(x) - s / 2, 0), dz = Math.max(Math.abs(z) - s / 2, 0);
        if (Math.hypot(dx, dz) > maxRadius) continue;
        // Solo giros de 90° para que los mosaicos cuadrados encajen sin huecos.
        const rot = ((((i * 7 + j * 13) % 4) + 4) % 4) * (Math.PI / 2);
        tiles.push({ x, z, rot });
      }
    // En jardines enormes se toma una muestra pareja de hojas (y se dibujan más anchas).
    const stride = Math.max(1, Math.ceil((tiles.length * d.count) / MAX_BLADES));
    this.widthBase = Math.sqrt(stride);
    const out = new Float32Array(Math.ceil(tiles.length * d.count / stride) * 6);
    let w = 0;
    for (const t of tiles) {
      const c = Math.cos(t.rot), sn = Math.sin(t.rot), start = w / 6;
      for (let k = 0; k < d.count; k += stride) {
        const o = k * 6, lx = d.inst[o], lz = d.inst[o + 1];
        const X = lx * c - lz * sn + t.x, Z = lx * sn + lz * c + t.z;
        const r = Math.hypot(X, Z), th = Math.atan2(Z, X), edge = radius(th) - r;
        if (edge <= 1.5 || onPath(r, th)) continue;
        const e = Math.min(1, Math.max(0, (edge - 1.5) / 8.5)), hs = (1 - 0.72 * clear(X, Z)) * (0.45 + 0.55 * e * e * (3 - 2 * e));
        out[w] = X;
        out[w + 1] = Z;
        out[w + 2] = d.inst[o + 2] - t.rot;
        out[w + 3] = d.inst[o + 3];
        out[w + 4] = d.inst[o + 4] * hs;
        out[w + 5] = d.inst[o + 5];
        w += 6;
      }
      t.start = start;
      t.count = w / 6 - start;
    }
    this.tiles = tiles.filter((t) => t.count > 0);
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    gl.bufferData(gl.ARRAY_BUFFER, out.subarray(0, w), gl.STATIC_DRAW);
    this.total = w / 6;
  }

  // Dibuja los mosaicos visibles; de lejos usa menos hojas, más anchas
  // (cualquier prefijo de un mosaico es una muestra pareja).
  draw(camera, H, quality) {
    const gl = this.gl, u = this.prog.uniforms, loc = this.prog.attribs;
    const vr = camera.visibleRect(40), z0 = vr.y0 / H, z1 = vr.y1 / H, s = this.data.size / 2;
    const budget = [30000, 60000, 110000][quality];
    const visible = [];
    for (const t of this.tiles) {
      if (t.x + s < vr.x0 || t.x - s > vr.x1 || t.z + s < z0 || t.z - s > z1) continue;
      const base = camera.project(t.x, 0, t.z), up = camera.project(t.x, 11, t.z);
      if (base.w <= 0) continue;
      const px = Math.hypot(up.x - base.x, up.y - base.y);
      if (px < 1.2) continue;
      visible.push({ t, density: Math.min(1, Math.max(0.1, (px - 1.2) / 8)) });
    }
    if (!visible.length) return 0;
    const want = visible.reduce((sum, v) => sum + v.density * v.t.count, 0);
    const k = Math.min(1, budget / want);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    let drawn = 0;
    for (const { t, density } of visible) {
      const n = Math.floor(t.count * density * k);
      if (n < 1) continue;
      // Sin "baseInstance" en WebGL2: se apunta el atributo al inicio del mosaico.
      gl.vertexAttribPointer(loc.i_a, 4, gl.FLOAT, false, 24, t.start * 24);
      gl.vertexAttribPointer(loc.i_b, 2, gl.FLOAT, false, 24, t.start * 24 + 16);
      gl.uniform1f(u.u_widthMul, Math.min(2.4, this.widthBase / Math.sqrt(density * k)));
      gl.drawElementsInstanced(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0, n);
      drawn += n;
    }
    gl.bindVertexArray(null);
    return drawn;
  }
}
