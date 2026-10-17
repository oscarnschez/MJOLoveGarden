// Shaders GLSL ES 3.0 del jardín 3D.

const HEAD = `#version 300 es
precision highp float;
`;

// Iluminación, niebla y el mismo "revelado" del jardín 2D: tinte (multiplicar),
// resplandor (trama) y viñeta.
const LOOK = `
uniform vec3 u_tint; uniform float u_tintA;
uniform vec3 u_glow; uniform float u_glowA; uniform vec2 u_glowPos;
uniform float u_vig; uniform vec2 u_res;
uniform vec3 u_fogColor; uniform vec2 u_fog; uniform vec3 u_eye;
uniform vec3 u_sunDir; uniform vec3 u_sunCol; uniform vec3 u_sky; uniform vec3 u_gnd;

vec3 grade(vec3 c) {
  c *= mix(vec3(1.0), u_tint, u_tintA);
  vec2 p = gl_FragCoord.xy;
  vec2 gp = vec2(u_glowPos.x, 1.0 - u_glowPos.y) * u_res;
  float g = u_glowA * clamp(1.0 - length(p - gp) / (max(u_res.x, u_res.y) * 0.8), 0.0, 1.0);
  c = 1.0 - (1.0 - c) * (1.0 - u_glow * g);
  vec2 m = u_res * 0.5;
  float r0 = min(m.x, m.y) * 0.6, r1 = length(m);
  float v = clamp((length(p - m) - r0) / (r1 - r0), 0.0, 1.0) * u_vig * 0.55;
  return mix(c, vec3(0.078, 0.11, 0.118), v);
}

vec3 shade(vec3 albedo, vec3 n, float wrap, float trans) {
  float ndl = dot(n, u_sunDir);
  float diff = max((ndl + wrap) / (1.0 + wrap), 0.0);
  float back = max(-ndl, 0.0) * trans;
  vec3 amb = mix(u_gnd, u_sky, n.y * 0.5 + 0.5);
  return albedo * (amb + u_sunCol * (diff + back * 0.55));
}

vec3 fog(vec3 c, vec3 world) {
  return mix(c, u_fogColor, smoothstep(u_fog.x, u_fog.y, distance(world, u_eye)));
}

float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
`;

// Radio del arriate en cada ángulo, guardado en 16 bits (rojo + verde/255).
const BLOB = `
uniform sampler2D u_blob; uniform float u_blobMax;
float blobRadius(vec2 xz) {
  vec2 t = texture(u_blob, vec2(atan(xz.y, xz.x) / 6.2831853, 0.5)).rg;
  return (t.r + t.g / 255.0) * u_blobMax;
}
`;

export const SKY = {
  vs: `${HEAD}
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }`,
  fs: `${HEAD}${LOOK}
uniform vec3 u_paper;
out vec4 o;
void main() {
  float y = gl_FragCoord.y / u_res.y;
  vec3 c = u_paper * mix(0.97, 1.02, y);
  c *= 1.0 + (hash12(floor(gl_FragCoord.xy * 0.5)) - 0.5) * 0.035;
  o = vec4(grade(c), 1.0);
}`,
};

export const GROUND = {
  vs: `${HEAD}
in vec3 a_pos; in vec3 a_nrm; in float a_kind;
uniform mat4 u_viewProj;
out vec3 v_world; out vec3 v_nrm; flat out float v_kind;
void main() {
  v_world = a_pos; v_nrm = a_nrm; v_kind = a_kind;
  gl_Position = u_viewProj * vec4(a_pos, 1.0);
}`,
  fs: `${HEAD}${LOOK}${BLOB}
in vec3 v_world; in vec3 v_nrm; flat in float v_kind;
uniform sampler2D u_soil; uniform sampler2D u_clear; uniform vec4 u_clearRect;
uniform vec3 u_paper; uniform vec3 u_meadow; uniform vec3 u_grassColor; uniform float u_grassFar;
uniform sampler2D u_lawn; uniform float u_lawnMax;
out vec4 o;
void main() {
  vec3 c;
  vec3 n = normalize(v_nrm);
  if (v_kind < 0.5) {
    // Alrededor del arriate: papel con un poco de pasto, y sombra suave junto al borde.
    float d = length(v_world.xz) - blobRadius(v_world.xz);
    float grain = hash12(floor(v_world.xz * 0.6));
    c = mix(u_paper, u_meadow, 0.32 + grain * 0.06);
    // Césped que llega hasta los árboles: tierra con pasto, que se funde con el prado en la orilla.
    if (u_lawnMax > 0.0) {
      vec2 lt = texture(u_lawn, vec2(atan(v_world.z, v_world.x) / 6.2831853, 0.5)).rg;
      float lr = (lt.r + lt.g / 255.0) * u_lawnMax;
      float inLawn = smoothstep(lr + 8.0, lr - 12.0, length(v_world.xz) + (grain - 0.5) * 6.0);
      vec3 turf = texture(u_soil, v_world.xz / 96.0).rgb * vec3(0.86, 0.96, 0.74);
      turf = mix(turf, u_grassColor, max(u_grassFar, 0.3));
      c = mix(c, turf, inLawn);
    }
    c *= 1.0 - smoothstep(26.0, 0.0, d) * 0.22;
  } else {
    vec3 soil = texture(u_soil, v_world.xz / 96.0).rgb;
    soil = mix(soil, soil * vec3(0.92, 0.95, 0.8), 0.4);
    if (v_kind < 1.5) {
      float clr = texture(u_clear, (v_world.xz - u_clearRect.xy) * u_clearRect.zw).r;
      c = soil * mix(1.0, 0.82, clr);
      c = mix(c, u_grassColor, u_grassFar * (1.0 - clr * 0.6));
    } else {
      c = soil * 0.78;
    }
  }
  c = shade(c, n, 0.3, 0.0);
  o = vec4(grade(fog(c, v_world)), 1.0);
}`,
};

export const PATH = {
  vs: `${HEAD}
in vec3 a_pos; in vec2 a_uv;
uniform mat4 u_viewProj;
out vec3 v_world; out vec2 v_uv;
void main() { v_world = a_pos; v_uv = a_uv; gl_Position = u_viewProj * vec4(a_pos, 1.0); }`,
  fs: `${HEAD}${LOOK}
in vec3 v_world; in vec2 v_uv;
uniform vec3 u_sand; uniform vec3 u_sandEdge;
out vec4 o;
void main() {
  float e = abs(v_uv.y);
  float pebble = hash12(floor(v_world.xz * 0.9));
  vec3 c = mix(u_sand, u_sandEdge, smoothstep(0.62, 1.0, e));
  c *= 0.94 + pebble * 0.1;
  c = shade(c, vec3(0.0, 1.0, 0.0), 0.3, 0.0);
  o = vec4(grade(fog(c, v_world)), 1.0);
}`,
};

export const GRASS = {
  vs: `${HEAD}
in vec3 a_pos; in vec3 a_nrm; in vec2 a_uv;
in vec4 i_a; in vec2 i_b;
uniform mat4 u_viewProj;
uniform float u_time; uniform float u_wind; uniform float u_bedH; uniform float u_widthMul;
out vec2 v_uv; out vec3 v_nrm; out vec3 v_world; out float v_h; out float v_var;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // i_a: posición x/z en el mundo, giro y escala horizontal; i_b: alto (ya acortado) e inclinación.
  vec2 wp = i_a.xy;
  vec3 p = a_pos;
  p.x *= i_a.w * u_widthMul;
  p.z *= i_a.w;
  p.y *= i_b.x;
  float ct = cos(i_b.y), st = sin(i_b.y);
  p = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);
  vec3 n = vec3(a_nrm.x, a_nrm.y * ct - a_nrm.z * st, a_nrm.y * st + a_nrm.z * ct);
  float cy = cos(i_a.z), sy = sin(i_a.z);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  n = vec3(n.x * cy + n.z * sy, n.y, -n.x * sy + n.z * cy);
  float h = clamp(a_pos.y / 16.0, 0.0, 1.0);
  float gust = sin(u_time * 1.3 + wp.x * 0.045 + wp.y * 0.03) * 0.6 + sin(u_time * 2.3 + wp.y * 0.09) * 0.25;
  p.x += u_wind * gust * h * h * 2.4;
  p.z += u_wind * gust * h * h * 0.9;
  v_world = vec3(p.x + wp.x, p.y + u_bedH, p.z + wp.y);
  v_uv = a_uv; v_nrm = n; v_h = h; v_var = hash(floor(wp * 0.37));
  gl_Position = u_viewProj * vec4(v_world, 1.0);
}`,
  fs: `${HEAD}${LOOK}
in vec2 v_uv; in vec3 v_nrm; in vec3 v_world; in float v_h; in float v_var;
uniform sampler2D u_blade;
out vec4 o;
void main() {
  vec3 c = texture(u_blade, v_uv).rgb;
  c *= mix(0.84, 1.08, v_var);
  c = mix(c, c * vec3(1.08, 1.04, 0.8), smoothstep(0.7, 1.0, v_var) * 0.6);
  vec3 bn = normalize(v_nrm) * (gl_FrontFacing ? 1.0 : -1.0);
  vec3 n = normalize(mix(vec3(0.0, 1.0, 0.0), bn, 0.45));
  c = shade(c, n, 0.6, 0.35) * mix(0.5, 1.0, v_h);
  o = vec4(grade(fog(c, v_world)), 1.0);
}`,
};

export const PLANT = {
  vs: `${HEAD}
in vec3 a_pos; in vec3 a_nrm; in vec3 a_col; in vec2 a_mat;
in vec4 i_a; in vec4 i_b; in vec4 i_c;
in vec3 i_light; in vec3 i_base; in vec3 i_deep; in vec3 i_center;
uniform mat4 u_viewProj;
uniform float u_time; uniform float u_motion; uniform float u_height; uniform float u_bedH;
out vec3 v_col; out vec3 v_nrm; out vec3 v_world; out float v_soft;
void main() {
  float s = i_a.w;
  // Aparición: crece desde cero con un pequeño rebote (como en el jardín 2D).
  if (i_c.x > 0.0) {
    float t = (u_time - i_b.w) / i_c.x;
    if (t < 1.0) {
      float e = t <= 0.0 ? 0.0 : 1.0 + 2.4 * pow(t - 1.0, 3.0) + 1.4 * pow(t - 1.0, 2.0);
      s *= max(0.001, e);
    }
  }
  vec3 p = a_pos * s;
  float yaw = i_a.z, cy = cos(yaw), sy = sin(yaw);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  vec3 n = vec3(a_nrm.x * cy + a_nrm.z * sy, a_nrm.y, -a_nrm.x * sy + a_nrm.z * cy);
  float hn = clamp(a_pos.y / u_height, 0.0, 1.4);
  float sway = u_motion * (sin(u_time * 1.4 + i_b.y) * 0.5 + sin(u_time * 0.31 - i_a.x * 0.0028) * 0.9) * 0.034;
  float rt = u_time - i_b.z;
  float wig = (rt >= 0.0 && rt < 2.4) ? 0.13 * exp(-rt / 0.52) * sin(rt / 0.085) : 0.0;
  float ang = (i_b.x + sway + wig) * hn;
  p.x += sin(ang) * p.y;
  p.y -= (1.0 - cos(ang)) * p.y;
  v_world = vec3(p.x + i_a.x, p.y + u_bedH, p.z + i_a.y);
  v_nrm = n;
  // Modo de color: 0 fijo, 1 pétalo (degradado de la paleta), 2 centro, 3 hoja (fijo y translúcido).
  float mode = a_mat.x, t = a_mat.y;
  if (mode < 0.5 || mode > 2.5) v_col = a_col;
  else if (mode < 1.5) v_col = t < 0.5 ? mix(i_deep, i_base, t * 2.0) : mix(i_base, i_light, (t - 0.5) * 2.0);
  else v_col = i_center * t;
  v_soft = (mode > 0.5 && mode < 1.5) ? 1.0 : (mode > 2.5 ? 0.6 : 0.0);
  gl_Position = u_viewProj * vec4(v_world, 1.0);
}`,
  fs: `${HEAD}${LOOK}
in vec3 v_col; in vec3 v_nrm; in vec3 v_world; in float v_soft;
uniform float u_noFlip;
out vec4 o;
void main() {
  // Las hojas de los árboles usan la normal de la copa por ambos lados.
  vec3 n = normalize(v_nrm) * (gl_FrontFacing || (u_noFlip > 0.5 && v_soft > 0.55) ? 1.0 : -1.0);
  vec3 c = shade(v_col, n, 0.45 + v_soft * 0.35, 0.2 + v_soft * 0.45);
  o = vec4(grade(fog(c, v_world)), 1.0);
}`,
};

// Sombras de contacto y anillos de selección: cuadros sobre el suelo.
export const DECAL = {
  vs: `${HEAD}
in vec2 a_corner;
in vec4 i_pos; in vec4 i_col;
uniform mat4 u_viewProj; uniform float u_bedH;
out vec2 v_uv; out vec4 v_col; flat out float v_kind;
void main() {
  v_uv = a_corner; v_col = i_col; v_kind = i_pos.w;
  vec3 w = vec3(i_pos.x + a_corner.x * i_pos.z, u_bedH + 0.25 + v_kind * 0.05, i_pos.y + a_corner.y * i_pos.z);
  gl_Position = u_viewProj * vec4(w, 1.0);
}`,
  fs: `${HEAD}
in vec2 v_uv; in vec4 v_col; flat in float v_kind;
out vec4 o;
void main() {
  float r = length(v_uv);
  float a;
  if (v_kind < 0.5) a = 1.0 - smoothstep(0.15, 1.0, r);
  else if (v_kind < 1.5) a = smoothstep(0.66, 0.74, r) * (1.0 - smoothstep(0.86, 0.94, r)) + (1.0 - smoothstep(0.0, 0.74, r)) * 0.28;
  else a = smoothstep(0.55, 0.72, r) * (1.0 - smoothstep(0.82, 1.0, r)) + (1.0 - smoothstep(0.0, 0.8, r)) * 0.3;
  if (a <= 0.003) discard;
  o = vec4(v_col.rgb, v_col.a * a);
}`,
};
