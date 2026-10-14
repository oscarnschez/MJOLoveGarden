"""Pone a cada archivo de assets/ un hash de su contenido y actualiza index.html y sw.js.

Así el service worker (que sirve primero lo que tiene guardado) siempre recibe los archivos
nuevos: cambia el nombre del archivo y la versión de la caché.
Uso (desde la raíz del repo): python3 tools/rehash.py
"""
import hashlib
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
assets = root / "assets"
index, sw = root / "index.html", root / "sw.js"
html, worker = index.read_text(encoding="utf-8"), sw.read_text(encoding="utf-8")
pattern = re.compile(r"^(app|login|logo|garden3d|ambient|grass|blade|soil)(?:\.[0-9a-f]{10})?\.(js|css|bin|webp)$")

names, blob = [], b""
for f in sorted(assets.iterdir()):
    m = pattern.match(f.name)
    if not m:
        continue
    data = f.read_bytes()
    blob += data
    new = f"{m[1]}.{hashlib.sha256(data).hexdigest()[:10]}.{m[2]}"
    names.append(new)
    ref = rf"assets/{m[1]}(?:\.[0-9a-f]{{10}})?\.{m[2]}"
    html = re.sub(ref + r'(?=")', f"assets/{new}", html)
    if re.search(rf'"{ref}"', worker):
        worker = re.sub(rf'"{ref}"', f'"assets/{new}"', worker)
    else:
        worker = re.sub(r'(var i=\["\./","index\.html","manifest\.webmanifest",)', rf'\1"assets/{new}",', worker, count=1)
    if new != f.name:
        f.rename(assets / new)

blob += (root / "manifest.webmanifest").read_bytes()
for f in sorted((root / "icons").iterdir()):
    blob += f.read_bytes()
worker = re.sub(r'c="jardin-[0-9a-f]{10}"', f'c="jardin-{hashlib.sha256(blob).hexdigest()[:10]}"', worker)
index.write_text(html, encoding="utf-8")
sw.write_text(worker, encoding="utf-8")
print("\n".join(sorted(names)))
