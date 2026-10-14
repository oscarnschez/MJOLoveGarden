// Sonido ambiental del jardín, sintetizado (sin archivos de audio):
// pájaros por la mañana, la tarde y el atardecer, y un coro de grillos por la noche.
// Tiene la misma interfaz que el sonido original de la app (enable, disable, suspend,
// resume, setWater, night) más setAmbiance(nombre).

// Cantos: cada uno es una lista de notas { t, d, f0, f1, vib, vibRate, h, att }.
// t inicio y d duración en segundos; f0→f1 barrido de frecuencia; vib profundidad del vibrato;
// h cantidad de segundo armónico; att ataque relativo.
const r = (a, b) => a + Math.random() * (b - a);
const ri = (a, b) => Math.floor(r(a, b + 1));

const SONGS = {
  // Gorrión: serie de píos que suben.
  chirps() {
    const notes = [];
    let t = 0;
    for (let k = ri(3, 6); k > 0; k--) {
      const f = r(3000, 3800);
      notes.push({ t, d: r(0.06, 0.09), f0: f, f1: f * r(1.25, 1.45), h: 0.12, att: 0.2 });
      t += r(0.11, 0.2);
    }
    return notes;
  },
  // Trino: notas rapidísimas que van bajando.
  trill() {
    const notes = [], n = ri(14, 24), f0 = r(4800, 5600), f1 = r(3300, 3900);
    for (let k = 0; k < n; k++) {
      const f = f0 + (f1 - f0) * (k / n);
      notes.push({ t: k * 0.05, d: 0.034, f0: f * 1.06, f1: f * 0.94, h: 0.08, att: 0.25 });
    }
    return notes;
  },
  // Silbido de dos notas ("fi-fiu").
  whistle() {
    const a = r(3700, 4100), b = a * r(0.78, 0.85);
    return [
      { t: 0, d: r(0.28, 0.36), f0: a, f1: a * 1.01, vib: 0.006, vibRate: 30, h: 0.05, att: 0.15 },
      { t: r(0.36, 0.46), d: r(0.34, 0.44), f0: b, f1: b * 0.97, vib: 0.006, vibRate: 30, h: 0.05, att: 0.15 },
    ];
  },
  // Petirrojo: frase líquida de notas variadas.
  robin() {
    const notes = [];
    let t = 0;
    for (let k = ri(5, 7); k > 0; k--) {
      const f = r(2200, 3400), d = r(0.12, 0.22);
      notes.push({ t, d, f0: f, f1: f * r(0.8, 1.2), vib: 0.02, vibRate: 32, h: 0.2, att: 0.12 });
      t += d + r(0.04, 0.09);
    }
    return notes;
  },
  // Jilguero: gorjeo de destellos rápidos.
  twitter() {
    const notes = [];
    let t = 0;
    for (let k = ri(10, 16); k > 0; k--) {
      const f = r(3500, 6000);
      notes.push({ t, d: r(0.025, 0.05), f0: f, f1: f * r(0.7, 1.4), h: 0.1, att: 0.2 });
      t += r(0.04, 0.09);
    }
    return notes;
  },
  // Mirlo (atardecer): notas aflautadas, graves y lentas.
  blackbird() {
    const notes = [];
    let t = 0;
    for (let k = ri(4, 6); k > 0; k--) {
      const f = r(1600, 2600), d = r(0.18, 0.34);
      notes.push({ t, d, f0: f, f1: f * r(0.88, 1.12), vib: 0.015, vibRate: 6, h: 0.25, att: 0.2 });
      t += d + r(0.05, 0.12);
    }
    for (let k = 0; k < 4; k++) notes.push({ t: t + k * 0.05, d: 0.03, f0: r(3500, 4500), f1: r(3000, 4000), h: 0.1, att: 0.2 });
    return notes;
  },
  // Tórtola (atardecer): "cu-CUU-cu-cu" grave y suave.
  dove() {
    const f = r(500, 560);
    return [
      { t: 0, d: 0.32, f0: f, f1: f * 1.05, h: 0.35, att: 0.4 },
      { t: 0.42, d: 0.56, f0: f * 1.12, f1: f * 1.0, h: 0.35, att: 0.35 },
      { t: 1.06, d: 0.3, f0: f * 0.98, f1: f * 0.95, h: 0.35, att: 0.4 },
      { t: 1.44, d: 0.3, f0: f * 0.98, f1: f * 0.94, h: 0.35, att: 0.4 },
    ];
  },
};

// Qué tanto canta cada pájaro según la hora, y cada cuánto (segundos).
const MIX = {
  manana: { gap: [0.7, 2.6], songs: { chirps: 3, trill: 2, whistle: 2, robin: 3, twitter: 2, dove: 0.4 } },
  tarde: { gap: [1.8, 5.5], songs: { chirps: 2, trill: 1, whistle: 1, robin: 1.5, twitter: 1 } },
  atardecer: { gap: [2.4, 7], songs: { blackbird: 3, robin: 1.5, dove: 1.2, chirps: 0.6 } },
};

function render(ctx, notes) {
  const sr = ctx.sampleRate, end = Math.max(...notes.map((n) => n.t + n.d)) + 0.05;
  const buf = ctx.createBuffer(1, Math.ceil(end * sr), sr), out = buf.getChannelData(0);
  for (const n of notes) {
    const start = Math.floor(n.t * sr), len = Math.floor(n.d * sr), att = Math.max(1, len * (n.att ?? 0.2));
    let ph = 0;
    for (let i = 0; i < len; i++) {
      const u = i / len;
      const f = n.f0 * Math.pow(n.f1 / n.f0, u) * (1 + (n.vib ?? 0) * Math.sin((2 * Math.PI * (n.vibRate ?? 0) * i) / sr));
      ph += (2 * Math.PI * f) / sr;
      const env = Math.min(1, i / att) * Math.pow(1 - u, 1.6);
      out[start + i] += env * (Math.sin(ph) + (n.h ?? 0) * Math.sin(2 * ph));
    }
  }
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return buf;
}

// Un grillo: dos segundos con cuatro cantos de tres pulsos, para repetir en bucle.
function cricketBuffer(ctx) {
  const sr = ctx.sampleRate, buf = ctx.createBuffer(1, sr * 2, sr), out = buf.getChannelData(0);
  const f = 4600;
  for (let c = 0; c < 4; c++)
    for (let p = 0; p < 3; p++) {
      const start = Math.floor((c * 0.5 + p * 0.038) * sr), len = Math.floor(0.018 * sr);
      for (let i = 0; i < len; i++) {
        const u = i / len, env = Math.sin(Math.PI * u);
        out[start + i] += env * Math.sin((2 * Math.PI * f * i) / sr) * (0.75 + 0.25 * Math.sin((2 * Math.PI * 240 * i) / sr));
      }
    }
  return buf;
}

function impulse(ctx, seconds = 2.2) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp((-i / sr) / 0.45);
  }
  return buf;
}

export class AmbientSound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.ambiance = "tarde";
    this.timer = 0;
    this.songs = {};
  }

  get night() {
    return this.ambiance === "noche";
  }

  // La app avisa con night = true/false; setAmbiance da el detalle de mañana, tarde o atardecer.
  set night(v) {
    if (v) this.setAmbiance("noche");
    else if (this.ambiance === "noche") this.setAmbiance("tarde");
  }

  setAmbiance(name) {
    if (!["manana", "tarde", "atardecer", "noche"].includes(name) || name === this.ambiance) return;
    this.ambiance = name;
    if (this.ctx && this.enabled) {
      this.applyAmbiance();
      this.schedule(true);
    }
  }

  async enable() {
    try {
      if (!this.ctx) {
        const AC = window.AudioContext ?? window.webkitAudioContext;
        if (!AC) return false;
        this.ctx = new AC();
        this.build();
      }
      await this.ctx.resume();
      this.enabled = true;
      this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.8);
      this.applyAmbiance();
      this.schedule(true);
      return true;
    } catch {
      return false;
    }
  }

  disable() {
    this.enabled = false;
    clearTimeout(this.timer);
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
    setTimeout(() => this.ctx?.state === "running" && !this.enabled && this.ctx.suspend(), 700);
  }

  suspend() {
    clearTimeout(this.timer);
    this.ctx?.suspend().catch(() => {});
  }

  resume() {
    if (!this.enabled || !this.ctx) return;
    this.ctx.resume().catch(() => {});
    this.schedule(true);
  }

  build() {
    const c = this.ctx;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);
    // Reverberación suave para dar distancia.
    this.reverb = c.createConvolver();
    this.reverb.buffer = impulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);
    // Ruido para el viento y el agua.
    const n = c.sampleRate * 3, noise = c.createBuffer(1, n, c.sampleRate), d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04;
      d[i] = last * 3.2;
    }
    const wind = c.createBufferSource();
    wind.buffer = noise;
    wind.loop = true;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 420;
    band.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.04;
    wind.connect(band).connect(this.windGain).connect(this.master);
    wind.start();
    const water = c.createBufferSource();
    water.buffer = noise;
    water.loop = true;
    water.playbackRate.value = 2.4;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1400;
    const peak = c.createBiquadFilter();
    peak.type = "peaking";
    peak.frequency.value = 3200;
    peak.gain.value = 6;
    this.waterGain = c.createGain();
    this.waterGain.gain.value = 0;
    water.connect(hp).connect(peak).connect(this.waterGain).connect(this.master);
    water.start();
    // Coro de grillos: el mismo canto en bucle con distinto tono, ritmo, lado y distancia.
    this.nightGain = c.createGain();
    this.nightGain.gain.value = 0;
    this.nightGain.connect(this.master);
    const chirp = cricketBuffer(c);
    this.crickets = [];
    for (let k = 0; k < 5; k++) {
      const src = c.createBufferSource();
      src.buffer = chirp;
      src.loop = true;
      src.playbackRate.value = r(0.86, 1.14);
      const g = c.createGain(), far = k >= 3;
      g.gain.value = far ? 0.05 : r(0.07, 0.11);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = far ? 3800 : 9000;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      if (pan) pan.pan.value = r(-0.9, 0.9);
      src.connect(lp).connect(g);
      (pan ? g.connect(pan) : g).connect(this.nightGain);
      if (far) g.connect(this.reverb);
      src.start(c.currentTime + Math.random() * 2, Math.random() * 2);
      this.crickets.push(g);
    }
  }

  applyAmbiance() {
    const c = this.ctx, t = c.currentTime, night = this.ambiance === "noche";
    this.nightGain.gain.setTargetAtTime(night ? 1 : 0, t, 1.2);
    this.windGain.gain.setTargetAtTime(night ? 0.025 : this.ambiance === "atardecer" ? 0.035 : 0.045, t, 2);
  }

  setWater(on) {
    if (!this.ctx || !this.enabled) return;
    this.waterGain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, on ? 0.08 : 0.25);
  }

  // Programa el siguiente canto (de noche cantan los grillos, sin pájaros).
  schedule(soon = false) {
    clearTimeout(this.timer);
    if (!this.enabled || this.ambiance === "noche") return;
    const mix = MIX[this.ambiance] ?? MIX.tarde;
    const wait = soon ? r(0.3, 1.2) : r(mix.gap[0], mix.gap[1]);
    this.timer = setTimeout(() => {
      if (!this.enabled || !this.ctx || this.ctx.state !== "running") return;
      const kind = this.pick(mix.songs), pan = r(-0.85, 0.85), dist = Math.random();
      this.sing(kind, pan, dist);
      // A veces otro pájaro de la misma especie contesta desde el otro lado.
      if (kind !== "dove" && Math.random() < 0.3) setTimeout(() => this.enabled && this.sing(kind, -pan * r(0.6, 1), Math.random()), r(600, 1500));
      this.windGain.gain.setTargetAtTime(r(0.03, 0.06), this.ctx.currentTime, 2.5);
      this.schedule();
    }, wait * 1000);
  }

  pick(weights) {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (const [k, w] of Object.entries(weights)) if ((x -= w) <= 0) return k;
    return Object.keys(weights)[0];
  }

  // Cada especie tiene unas cuantas variantes que se generan la primera vez que cantan.
  song(kind) {
    const list = (this.songs[kind] ??= []);
    if (list.length < 3) list.push(render(this.ctx, SONGS[kind]()));
    return list[Math.floor(Math.random() * list.length)];
  }

  sing(kind, pan, dist) {
    const c = this.ctx, t = c.currentTime + 0.03;
    const src = c.createBufferSource();
    src.buffer = this.song(kind);
    src.playbackRate.value = r(0.93, 1.07);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 12000 - dist * 7500;
    const g = c.createGain();
    g.gain.value = (kind === "dove" ? 0.16 : 0.12) * (1 - dist * 0.65);
    const send = c.createGain();
    send.gain.value = 0.12 + dist * 0.4;
    src.connect(lp).connect(g);
    const pn = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pn) {
      pn.pan.value = pan;
      g.connect(pn).connect(this.master);
    } else g.connect(this.master);
    g.connect(send).connect(this.reverb);
    src.start(t);
  }
}

window.JardinSound = AmbientSound;
