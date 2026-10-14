// Empaqueta src/garden3d en assets/garden3d.js (después tools/rehash.py le pone hash).
// Uso: npm install && npm run build
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";

for (const f of readdirSync("assets")) if (/^garden3d\.[0-9a-f]{10}\.js$/.test(f)) rmSync(`assets/${f}`);

await build({
  entryPoints: ["src/garden3d/index.js"],
  outfile: "assets/garden3d.js",
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020", "safari15"],
  legalComments: "none",
});
console.log("assets/garden3d.js listo");
