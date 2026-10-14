"""Convierte el modelo "Patch of Grass" (Sketchfab, GLB) a los archivos que usa el jardín 3D.

El GLB original guarda 9,436 copias de la misma hoja de pasto como mallas separadas (17 MB).
Aquí se guarda una sola hoja y, por cada copia, su posición, giro y escala (8 bytes),
y las texturas se reducen a WebP.

Uso: python3 tools/convert-grass.py patch_of_grass.glb assets/
Genera assets/grass.bin, assets/blade.webp y assets/soil.webp (después se les pone hash).

Formato de grass.bin (little-endian):
  'JEG1' | u32 vértices | u32 índices | u32 instancias | f32 tamaño del parche
  f32 escala horizontal mín, máx | f32 escala vertical mín, máx
  vértices de la hoja: (x, y, z, nx, ny, nz, u, v) f32
  índices u16 (rellenados a 4 bytes)
  instancias (10 bytes): x i16, z i16 (en ±tamaño/2), giro u16, escala horizontal u8,
  escala vertical u8, inclinación i8 (±0.08 rad), relleno u8
"""
import io
import json
import math
import pathlib
import random
import struct
import sys

import numpy as np
from PIL import Image

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
data = src.read_bytes()
offset, chunks = 12, []
while offset < len(data):
    length, kind = struct.unpack_from("<I4s", data, offset)
    chunks.append((kind, offset + 8, length))
    offset += 8 + length
gltf = json.loads(data[chunks[0][1]:chunks[0][1] + chunks[0][2]])
bin_start = chunks[1][1]
nodes, meshes, accessors, views = gltf["nodes"], gltf["meshes"], gltf["accessors"], gltf["bufferViews"]


def local_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"], float).reshape(4, 4).T
    m = np.eye(4)
    if "scale" in node:
        m = m @ np.diag(list(node["scale"]) + [1])
    return m


parent = {c: i for i, n in enumerate(nodes) for c in n.get("children", [])}


def world_matrix(i):
    m = local_matrix(nodes[i])
    while i in parent:
        i = parent[i]
        m = local_matrix(nodes[i]) @ m
    return m


def read(index):
    a = accessors[index]
    v = views[a["bufferView"]]
    width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3}[a["type"]]
    dtype = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[a["componentType"]]
    start = bin_start + v.get("byteOffset", 0) + a.get("byteOffset", 0)
    arr = np.frombuffer(data, dtype, a["count"] * width, start)
    return arr.reshape(a["count"], width) if width > 1 else arr


blades, blade_mesh, soil_material = [], None, None
for i, node in enumerate(nodes):
    if "mesh" not in node:
        continue
    prim = meshes[node["mesh"]]["primitives"][0]
    if gltf["materials"][prim["material"]]["name"] == "Soil":
        soil_material = prim["material"]
        continue
    blade_mesh = blade_mesh if blade_mesh is not None else prim
    blades.append(world_matrix(i))
blades = np.array(blades)

prim = blade_mesh
P = read(prim["attributes"]["POSITION"]).astype(np.float64)
Nn = read(prim["attributes"]["NORMAL"]).astype(np.float64)
UV = read(prim["attributes"]["TEXCOORD_0"])
I = read(prim["indices"]).astype(np.uint16)

# Cada copia es traslación + giro vertical + una leve inclinación + escala (horizontal igual en x y z).
T = blades[:, :3, 3]
c0, c1, c2 = blades[:, :3, 0], blades[:, :3, 1], blades[:, :3, 2]
sxz = np.linalg.norm(c0, axis=1)
sy = np.linalg.norm(c1, axis=1)
yaw = np.arctan2(-c0[:, 2], c0[:, 0])
tilt = -np.arcsin(np.clip(c2[:, 1] / sxz, -1, 1))


def rebuild(k):
    c, s = math.cos(yaw[k]), math.sin(yaw[k])
    ct, st = math.cos(tilt[k]), math.sin(tilt[k])
    ry = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])
    rx = np.array([[1, 0, 0], [0, ct, -st], [0, st, ct]])
    return ry @ rx @ np.diag([sxz[k], sy[k], sxz[k]])


err = max(np.abs(rebuild(k) - blades[k, :3, :3]).max() for k in range(0, len(blades), 37))
print(f"hojas: {len(blades)}, error máximo al reconstruir la rotación: {err:.4f}")

half = math.ceil(max(np.abs(T[:, 0]).max(), np.abs(T[:, 2]).max()))
order = list(range(len(blades)))
random.Random(1917).shuffle(order)  # cualquier prefijo es una muestra pareja (para menos densidad de lejos)

smin, smax = float(sxz.min()), float(sxz.max())
ymin, ymax = float(sy.min()), float(sy.max())
buf = io.BytesIO()
buf.write(b"JEG1")
buf.write(struct.pack("<IIIf4f", len(P), len(I), len(blades), half * 2, smin, smax, ymin, ymax))
for p, n, uv in zip(P, Nn, UV):
    buf.write(struct.pack("<8f", *p, *n, *uv))
buf.write(I.tobytes())
if buf.tell() % 4:
    buf.write(b"\0" * (4 - buf.tell() % 4))
q = lambda v, lo, hi: int(round((v - lo) / (hi - lo) * 255)) if hi > lo else 0
for k in order:
    buf.write(struct.pack("<hhHBBbB",
                          int(round(T[k, 0] / half * 32767)), int(round(T[k, 2] / half * 32767)),
                          int(round((yaw[k] % (2 * math.pi)) / (2 * math.pi) * 65535)) % 65536,
                          q(sxz[k], smin, smax), q(sy[k], ymin, ymax),
                          int(round(np.clip(tilt[k] / 0.08, -1, 1) * 127)), 0))
(out / "grass.bin").write_bytes(buf.getvalue())


def image(index):
    im = gltf["images"][index]
    v = views[im["bufferView"]]
    start = bin_start + v.get("byteOffset", 0)
    return Image.open(io.BytesIO(data[start:start + v["byteLength"]])).convert("RGB")


tex = {t_i: t["source"] for t_i, t in enumerate(gltf["textures"])}
mats = gltf["materials"]
blade_tex = tex[mats[blade_mesh["material"]]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
soil_tex = tex[mats[soil_material]["pbrMetallicRoughness"]["baseColorTexture"]["index"]]
image(blade_tex).resize((128, 64), Image.LANCZOS).save(out / "blade.webp", quality=82, method=6)
image(soil_tex).resize((512, 512), Image.LANCZOS).save(out / "soil.webp", quality=72, method=6)
for name in ("grass.bin", "blade.webp", "soil.webp"):
    print(name, (out / name).stat().st_size, "bytes")
print(f"parche: ±{half}, escala horizontal {smin:.3f}–{smax:.3f}, vertical {ymin:.3f}–{ymax:.3f}")
