// Punto de entrada del jardín 3D. La app llama a Jardin3D.create(...) si el navegador
// tiene WebGL2; si no, o si algo falla, sigue usando el jardín 2D.
import { Scene3D } from "./scene.js";

function supported() {
  try {
    if (new URLSearchParams(location.search).has("2d")) return false;
    return !!window.WebGL2RenderingContext && !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function assets() {
  const el = document.getElementById("jardin-assets");
  return el ? JSON.parse(el.textContent) : {};
}

window.Jardin3D = {
  supported,
  create(host, events, deps) {
    try {
      const scene = new Scene3D(host, events, { ...deps, assets: assets() });
      // Equipos modestos empiezan con menos resolución y menos pasto.
      if ((navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)) {
        scene.setQualityCap(1);
        scene.qualityCap = 2;
      }
      return scene;
    } catch (err) {
      for (const c of host.querySelectorAll("canvas")) c.remove();
      throw err;
    }
  },
};
