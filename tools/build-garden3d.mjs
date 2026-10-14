// Empaqueta src/garden3d en assets/garden3d.js y src/ambient en assets/ambient.js
// (después tools/rehash.py les pone hash).
// Uso: npm install && npm run build
import { build } from "esbuild";
import { readdirSync, rmSync } from "node:fs";

for (const f of readdirSync("assets")) if (/^(garden3d|ambient)\.[0-9a-f]{10}\.js$/.test(f)) rmSync(`assets/${f}`);

for (const name of ["garden3d", "ambient"]) {
  await build({
    entryPoints: [`src/${name}/index.js`],
    outfile: `assets/${name}.js`,
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020", "safari15"],
    legalComments: "none",
  });
  console.log(`assets/${name}.js listo`);
}
