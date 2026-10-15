/*
 * Jetfall renderer: raw WebGL2, no library.
 *
 *  - land: one mesh from the heightfield (the same triangles the physics uses), a coarse ring of hills around it,
 *    colours by height and slope with noise worked out in the shader, the sun's shadow from the hills baked per vertex
 *  - everything solid (bunkers, armor, turrets, flags, discs) is an instanced box, sphere or cylinder: one draw each
 *  - a sun shadow map around the camera for those
 *  - particles and beams: instanced quads, additive or blended
 *  - sky: one full-screen triangle with sun and clouds
 *  - up to 8 point lights from explosions and bolts
 *
 * Browser only. The scene is described fresh every frame by the page (ui.js) through `frame()`.
 */
(function (root) {
  'use strict';
  const JF = root.JF;
  const { N, CELL, SIZE } = JF;
  const MAX_LIGHTS = 8;

  // ---------- small matrix kit (column major) ----------
  const M4 = {
    ident() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
    mul(a, b, out) {
      out = out || new Float32Array(16);
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
        out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
      return out;
    },
    persp(fovy, asp, n, f) {
      const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
      m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f);
      return m;
    },
    ortho(l, r, b, t, n, f) {
      const m = new Float32Array(16);
      m[0] = 2 / (r - l); m[5] = 2 / (t - b); m[10] = -2 / (f - n);
      m[12] = -(r + l) / (r - l); m[13] = -(t + b) / (t - b); m[14] = -(f + n) / (f - n); m[15] = 1;
      return m;
    },
    // camera at eye looking along forward f with right r and up u
    view(eye, f, r, u) {
      const m = new Float32Array(16);
      m[0] = r[0]; m[4] = r[1]; m[8] = r[2];
      m[1] = u[0]; m[5] = u[1]; m[9] = u[2];
      m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2];
      m[12] = -(r[0] * eye[0] + r[1] * eye[1] + r[2] * eye[2]);
      m[13] = -(u[0] * eye[0] + u[1] * eye[1] + u[2] * eye[2]);
      m[14] = (f[0] * eye[0] + f[1] * eye[1] + f[2] * eye[2]);
      m[15] = 1;
      return m;
    },
    inv(m) {
      const inv = new Float32Array(16);
      const a = m;
      inv[0] = a[5] * a[10] * a[15] - a[5] * a[11] * a[14] - a[9] * a[6] * a[15] + a[9] * a[7] * a[14] + a[13] * a[6] * a[11] - a[13] * a[7] * a[10];
      inv[4] = -a[4] * a[10] * a[15] + a[4] * a[11] * a[14] + a[8] * a[6] * a[15] - a[8] * a[7] * a[14] - a[12] * a[6] * a[11] + a[12] * a[7] * a[10];
      inv[8] = a[4] * a[9] * a[15] - a[4] * a[11] * a[13] - a[8] * a[5] * a[15] + a[8] * a[7] * a[13] + a[12] * a[5] * a[11] - a[12] * a[7] * a[9];
      inv[12] = -a[4] * a[9] * a[14] + a[4] * a[10] * a[13] + a[8] * a[5] * a[14] - a[8] * a[6] * a[13] - a[12] * a[5] * a[10] + a[12] * a[6] * a[9];
      inv[1] = -a[1] * a[10] * a[15] + a[1] * a[11] * a[14] + a[9] * a[2] * a[15] - a[9] * a[3] * a[14] - a[13] * a[2] * a[11] + a[13] * a[3] * a[10];
      inv[5] = a[0] * a[10] * a[15] - a[0] * a[11] * a[14] - a[8] * a[2] * a[15] + a[8] * a[3] * a[14] + a[12] * a[2] * a[11] - a[12] * a[3] * a[10];
      inv[9] = -a[0] * a[9] * a[15] + a[0] * a[11] * a[13] + a[8] * a[1] * a[15] - a[8] * a[3] * a[13] - a[12] * a[1] * a[11] + a[12] * a[3] * a[9];
      inv[13] = a[0] * a[9] * a[14] - a[0] * a[10] * a[13] - a[8] * a[1] * a[14] + a[8] * a[2] * a[13] + a[12] * a[1] * a[10] - a[12] * a[2] * a[9];
      inv[2] = a[1] * a[6] * a[15] - a[1] * a[7] * a[14] - a[5] * a[2] * a[15] + a[5] * a[3] * a[14] + a[13] * a[2] * a[7] - a[13] * a[3] * a[6];
      inv[6] = -a[0] * a[6] * a[15] + a[0] * a[7] * a[14] + a[4] * a[2] * a[15] - a[4] * a[3] * a[14] - a[12] * a[2] * a[7] + a[12] * a[3] * a[6];
      inv[10] = a[0] * a[5] * a[15] - a[0] * a[7] * a[13] - a[4] * a[1] * a[15] + a[4] * a[3] * a[13] + a[12] * a[1] * a[7] - a[12] * a[3] * a[5];
      inv[14] = -a[0] * a[5] * a[14] + a[0] * a[6] * a[13] + a[4] * a[1] * a[14] - a[4] * a[2] * a[13] - a[12] * a[1] * a[6] + a[12] * a[2] * a[5];
      inv[3] = -a[1] * a[6] * a[11] + a[1] * a[7] * a[10] + a[5] * a[2] * a[11] - a[5] * a[3] * a[10] - a[9] * a[2] * a[7] + a[9] * a[3] * a[6];
      inv[7] = a[0] * a[6] * a[11] - a[0] * a[7] * a[10] - a[4] * a[2] * a[11] + a[4] * a[3] * a[10] + a[8] * a[2] * a[7] - a[8] * a[3] * a[6];
      inv[11] = -a[0] * a[5] * a[11] + a[0] * a[7] * a[9] + a[4] * a[1] * a[11] - a[4] * a[3] * a[9] - a[8] * a[1] * a[7] + a[8] * a[3] * a[5];
      inv[15] = a[0] * a[5] * a[10] - a[0] * a[6] * a[9] - a[4] * a[1] * a[10] + a[4] * a[2] * a[9] + a[8] * a[1] * a[6] - a[8] * a[2] * a[5];
      let det = a[0] * inv[0] + a[1] * inv[4] + a[2] * inv[8] + a[3] * inv[12];
      det = det ? 1 / det : 0;
      for (let i = 0; i < 16; i++) inv[i] *= det;
      return inv;
    },
  };

  // Builds a model matrix: translate, rotate about y, then about x (local), then scale. Writes 16 floats at `o` in `arr`.
  function trs(arr, o, x, y, z, yaw, pitch, sx, sy, sz, roll) {
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch || 0), sp = Math.sin(pitch || 0);
    const cr = Math.cos(roll || 0), sr = Math.sin(roll || 0);
    // R = Ry(yaw) * Rx(pitch) * Rz(roll)
    // Ry: [cy 0 sy; 0 1 0; -sy 0 cy], Rx: [1 0 0; 0 cp -sp; 0 sp cp], Rz: [cr -sr 0; sr cr 0; 0 0 1]
    const a00 = cy, a01 = sy_ * sp, a02 = sy_ * cp;
    const a10 = 0, a11 = cp, a12 = -sp;
    const a20 = -sy_, a21 = cy * sp, a22 = cy * cp;
    // times Rz
    const b00 = a00 * cr + a01 * sr, b01 = -a00 * sr + a01 * cr, b02 = a02;
    const b10 = a10 * cr + a11 * sr, b11 = -a10 * sr + a11 * cr, b12 = a12;
    const b20 = a20 * cr + a21 * sr, b21 = -a20 * sr + a21 * cr, b22 = a22;
    arr[o] = b00 * sx; arr[o + 1] = b10 * sx; arr[o + 2] = b20 * sx; arr[o + 3] = 0;
    arr[o + 4] = b01 * sy; arr[o + 5] = b11 * sy; arr[o + 6] = b21 * sy; arr[o + 7] = 0;
    arr[o + 8] = b02 * sz; arr[o + 9] = b12 * sz; arr[o + 10] = b22 * sz; arr[o + 11] = 0;
    arr[o + 12] = x; arr[o + 13] = y; arr[o + 14] = z; arr[o + 15] = 1;
  }

  // ---------- shaders ----------
  const COMMON = `
  uniform vec3 uSunDir, uSunCol, uAmb, uSkyTop, uSkyHor, uFogCol, uCam;
  uniform float uFogDist, uTime;
  uniform vec4 uLightPos[${MAX_LIGHTS}];
  uniform vec3 uLightCol[${MAX_LIGHTS}];
  uniform int uNumLights;
  uniform highp sampler2DShadow uShadow;
  uniform mat4 uShadowMat;
  uniform float uShadowOn;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
  float shadowAt(vec3 wp, vec3 n) {
    if (uShadowOn < 0.5) return 1.0;
    vec4 sp = uShadowMat * vec4(wp + n * 0.15, 1.0);
    vec3 c = sp.xyz * 0.5 + 0.5;
    if (c.x < 0.0 || c.x > 1.0 || c.y < 0.0 || c.y > 1.0 || c.z > 1.0) return 1.0;
    float s = 0.0; float d = 1.0 / 2048.0;
    s += texture(uShadow, vec3(c.xy + vec2(-d, -d), c.z - 0.0015));
    s += texture(uShadow, vec3(c.xy + vec2(d, -d), c.z - 0.0015));
    s += texture(uShadow, vec3(c.xy + vec2(-d, d), c.z - 0.0015));
    s += texture(uShadow, vec3(c.xy + vec2(d, d), c.z - 0.0015));
    float edge = smoothstep(0.85, 1.0, max(abs(c.x - 0.5), abs(c.y - 0.5)) * 2.0);
    return mix(s * 0.25, 1.0, edge);
  }
  vec3 pointLights(vec3 wp, vec3 n) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNumLights) break;
      vec3 d = uLightPos[i].xyz - wp; float l = length(d); float r = uLightPos[i].w;
      if (l < r) { float k = 1.0 - l / r; s += uLightCol[i] * k * k * (0.35 + 0.65 * max(dot(n, d / max(l, 0.001)), 0.0)); }
    }
    return s;
  }
  vec3 fogMix(vec3 c, vec3 wp) {
    vec3 d = wp - uCam; float dist = length(d);
    float f = 1.0 - exp(-pow(dist / uFogDist, 1.6));
    // thicker low down
    f = clamp(f * (1.0 + 0.4 * exp(-max(wp.y, 0.0) / 120.0)), 0.0, 1.0);
    float sun = pow(max(dot(normalize(d), uSunDir), 0.0), 8.0);
    vec3 fc = mix(uFogCol, uSunCol, sun * 0.35);
    return mix(c, fc, f);
  }
  vec3 tone(vec3 c) { c = max(c, 0.0); return c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14); }
  `;

  const TERRAIN_VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in float aShade;
  uniform mat4 uVP; out vec3 vPos; out vec3 vNor; out float vShade;
  void main() { vPos = aPos; vNor = aNor; vShade = aShade; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const TERRAIN_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform vec3 uLow, uMid, uHigh, uRock, uSnow; uniform float uSnowLine, uHmin, uHmax, uLava;
  in vec3 vPos; in vec3 vNor; in float vShade; out vec4 o;
  void main() {
    vec3 n = normalize(vNor);
    float h = clamp((vPos.y - uHmin) / (uHmax - uHmin), 0.0, 1.0);
    float big = fbm(vPos.xz * 0.004);
    float mid = fbm(vPos.xz * 0.05);
    float fine = mix(noise(vPos.xz * 0.9) * 0.5 + noise(vPos.xz * 3.1) * 0.5, 0.5, smoothstep(60.0, 400.0, length(vPos - uCam)));
    float hh = h + (big - 0.5) * 0.25;
    float patchy = fbm(vPos.xz * 0.0016 + 7.3);
    vec3 col = mix(uLow, uMid, smoothstep(0.15, 0.45, hh + (mid - 0.5) * 0.2));
    col = mix(col, col * vec3(1.18, 1.06, 0.78), smoothstep(0.45, 0.7, patchy));
    col = mix(col, col * vec3(0.8, 0.9, 0.85), smoothstep(0.5, 0.3, patchy) * 0.6);
    col = mix(col, uHigh, smoothstep(0.5, 0.8, hh));
    float slope = 1.0 - n.y;
    float rock = smoothstep(0.28, 0.45, slope + (mid - 0.5) * 0.15);
    // rock strata
    float camD = length(vPos - uCam);
    float strata = 1.0 - 0.15 * (1.0 - smoothstep(120.0, 500.0, camD)) * (0.5 + 0.5 * sin(vPos.y * 0.9 + fbm(vPos.xz * 0.02) * 6.0));
    col = mix(col, uRock * strata, rock);
    float snow = smoothstep(uSnowLine - 0.06, uSnowLine + 0.06, hh + (mid - 0.5) * 0.15) * (1.0 - smoothstep(0.35, 0.55, slope));
    col = mix(col, uSnow, snow);
    col *= 0.78 + 0.34 * fine * (1.0 - snow * 0.6) + 0.3 * (mid - 0.5);
    col *= 1.0 - slope * 0.35;
    // lava in the low ground (Ashfall)
    vec3 emit = vec3(0.0);
    if (uLava > 0.5) {
      float lv = smoothstep(0.1, 0.02, h + (big - 0.5) * 0.08) * (1.0 - rock);
      float flow = fbm(vPos.xz * 0.03 + vec2(uTime * 0.02, uTime * 0.013));
      vec3 lc = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.75, 0.2), flow) * (1.2 + 0.8 * flow);
      col = mix(col, vec3(0.05), lv);
      emit = lc * lv * 1.6;
      float crack = smoothstep(0.48, 0.5, fbm(vPos.xz * 0.12)) * smoothstep(0.52, 0.5, fbm(vPos.xz * 0.12));
      emit += vec3(1.0, 0.35, 0.05) * crack * 0.6 * smoothstep(0.35, 0.1, h);
    }
    float sun = max(dot(n, uSunDir), 0.0) * vShade * shadowAt(vPos, n);
    vec3 amb = mix(uAmb * 0.55, uAmb, n.y * 0.5 + 0.5) * (0.7 + 0.3 * vShade);
    vec3 lit = col * (uSunCol * sun * 1.15 + amb + pointLights(vPos, n)) + emit;
    lit = fogMix(lit, vPos);
    o = vec4(tone(lit), 1.0);
  }`;

  // instanced meshes: boxes, spheres, cylinders
  const MESH_VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
  layout(location=2) in vec4 aM0; layout(location=3) in vec4 aM1; layout(location=4) in vec4 aM2; layout(location=5) in vec4 aM3;
  layout(location=6) in vec4 aCol; layout(location=7) in vec4 aMat;
  uniform mat4 uVP;
  out vec3 vPos; out vec3 vNor; out vec3 vLocal; out vec3 vLocalN; out vec4 vCol; out vec4 vMat;
  void main() {
    mat4 m = mat4(aM0, aM1, aM2, aM3);
    vec4 wp = m * vec4(aPos, 1.0);
    vPos = wp.xyz;
    mat3 nm = transpose(inverse(mat3(m)));
    vNor = normalize(nm * aNor);
    vec3 sc = vec3(length(aM0.xyz), length(aM1.xyz), length(aM2.xyz));
    vLocal = aPos * sc; vLocalN = aNor; vCol = aCol; vMat = aMat;
    gl_Position = uVP * wp;
  }`;
  const MESH_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  in vec3 vPos; in vec3 vNor; in vec3 vLocal; in vec3 vLocalN; in vec4 vCol; in vec4 vMat; out vec4 o;
  void main() {
    vec3 n = normalize(vNor);
    vec3 col = vCol.rgb;
    float glow = vMat.x;
    // panels: seams every few metres on the face, picked by the face's own normal
    if (vMat.y > 0.0) {
      vec3 an = abs(vLocalN);
      vec2 uv = an.x > 0.5 ? vLocal.zy : an.y > 0.5 ? vLocal.xz : vLocal.xy;
      vec2 g = abs(fract(uv / vMat.y + 0.5) - 0.5) * vMat.y;
      float seam = 1.0 - smoothstep(0.03, 0.07, min(g.x, g.y));
      col *= 1.0 - 0.35 * seam;
      col *= 0.92 + 0.12 * noise(uv * 1.7) ;
      // a glowing stripe along the top of walls in team colour
      if (vMat.z > 0.0) { float stripe = smoothstep(0.08, 0.0, abs(fract(vLocal.y / 3.0) - 0.82)) * (1.0 - an.y); glow += stripe * vMat.z; }
    }
    float sh = shadowAt(vPos, n);
    float sun = max(dot(n, uSunDir), 0.0) * sh;
    vec3 v = normalize(uCam - vPos);
    vec3 hv = normalize(v + uSunDir);
    float spec = pow(max(dot(n, hv), 0.0), 40.0) * vMat.w * sh;
    vec3 amb = mix(uAmb * 0.5, uAmb, n.y * 0.5 + 0.5);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.25;
    vec3 lit = col * (uSunCol * sun + amb + pointLights(vPos, n)) + uSunCol * spec + amb * rim * col + col * glow;
    lit = fogMix(lit, vPos);
    o = vec4(tone(lit), vCol.a);
  }`;
  const SHADOW_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=2) in vec4 aM0; layout(location=3) in vec4 aM1; layout(location=4) in vec4 aM2; layout(location=5) in vec4 aM3;
  uniform mat4 uVP;
  void main() { gl_Position = uVP * (mat4(aM0, aM1, aM2, aM3) * vec4(aPos, 1.0)); }`;
  const SHADOW_FS = `#version 300 es
  precision mediump float; void main() {}`;

  const SKY_VS = `#version 300 es
  layout(location=0) in vec2 aP; out vec2 vP;
  void main() { vP = aP; gl_Position = vec4(aP, 0.9999, 1.0); }`;
  const SKY_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform mat4 uInvVP; uniform float uClouds;
  in vec2 vP; out vec4 o;
  void main() {
    vec4 a = uInvVP * vec4(vP, 1.0, 1.0);
    vec3 d = normalize(a.xyz / a.w - uCam);
    float up = max(d.y, 0.0);
    vec3 c = mix(uSkyHor, uSkyTop, pow(up, 0.55));
    float s = max(dot(d, uSunDir), 0.0);
    c += uSunCol * (pow(s, 900.0) * 6.0 + pow(s, 30.0) * 0.35 + pow(s, 4.0) * 0.15);
    // clouds on a high plane
    if (d.y > 0.01) {
      vec2 p = d.xz / d.y * 0.6 + vec2(uTime * 0.004, uTime * 0.002);
      float cl = fbm(p * 1.3) * 0.65 + fbm(p * 4.0) * 0.35;
      cl = smoothstep(1.0 - uClouds * 0.75, 1.05 - uClouds * 0.3, cl);
      float fade = smoothstep(0.01, 0.2, d.y);
      vec3 cc = mix(uFogCol * 1.05, vec3(1.0), 0.4) * (0.8 + 0.4 * s);
      c = mix(c, cc, cl * fade * 0.85);
    }
    // the horizon melts into the fog
    c = mix(uFogCol, c, smoothstep(-0.05, 0.12, d.y));
    o = vec4(tone(c), 1.0);
  }`;

  // particles: camera-facing quads; kind 0 = soft glow, 1 = smoke puff, 2 = hard spark
  const PART_VS = `#version 300 es
  layout(location=0) in vec2 aQ;
  layout(location=1) in vec4 aPS; layout(location=2) in vec4 aCol; layout(location=3) in vec4 aK;
  uniform mat4 uVP; uniform vec3 uRight, uUp;
  out vec2 vQ; out vec4 vCol; out vec4 vK; out vec3 vPos;
  void main() {
    float r = aK.y; vec2 q = vec2(aQ.x * cos(r) - aQ.y * sin(r), aQ.x * sin(r) + aQ.y * cos(r));
    vec3 wp = aPS.xyz + (uRight * q.x + uUp * q.y) * aPS.w;
    vQ = aQ; vCol = aCol; vK = aK; vPos = wp;
    gl_Position = uVP * vec4(wp, 1.0);
  }`;
  const PART_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  in vec2 vQ; in vec4 vCol; in vec4 vK; in vec3 vPos; out vec4 o;
  void main() {
    float d = length(vQ);
    if (d > 1.0) discard;
    float a;
    vec3 c = vCol.rgb;
    if (vK.x < 0.5) { a = pow(1.0 - d, 2.2); }
    else if (vK.x < 1.5) {
      float n = noise(vQ * 2.5 + vK.z * 7.0) * 0.6 + noise(vQ * 5.0 - vK.z * 3.0) * 0.4;
      a = smoothstep(1.0, 0.3, d + (n - 0.5) * 0.6);
      float lit = 0.6 + 0.4 * clamp(dot(normalize(vec3(vQ, 0.6)), normalize(vec3(0.3, 0.8, 0.5))), 0.0, 1.0);
      c *= lit * (uAmb + uSunCol * 0.6);
      c = fogMix(c, vPos);
    } else { a = smoothstep(1.0, 0.0, d); }
    o = vec4(tone(c) * a * vCol.a, a * vCol.a * vK.w);
  }`;
  // beams: a segment drawn as a quad that faces the camera
  const BEAM_VS = `#version 300 es
  layout(location=0) in vec2 aQ;
  layout(location=1) in vec4 aA; layout(location=2) in vec4 aB; layout(location=3) in vec4 aCol;
  uniform mat4 uVP; uniform vec3 uCam;
  out vec2 vQ; out vec4 vCol;
  void main() {
    vec3 p = mix(aA.xyz, aB.xyz, aQ.x);
    vec3 dir = normalize(aB.xyz - aA.xyz + vec3(1e-5));
    vec3 side = normalize(cross(dir, uCam - p));
    float w = mix(aA.w, aB.w, aQ.x);
    p += side * aQ.y * w;
    vQ = aQ; vCol = aCol;
    gl_Position = uVP * vec4(p, 1.0);
  }`;
  const BEAM_FS = `#version 300 es
  precision highp float;
  in vec2 vQ; in vec4 vCol; out vec4 o;
  void main() { float a = pow(1.0 - abs(vQ.y), 1.6) * vCol.a; o = vec4(vCol.rgb * a, 0.0); }`;

  function compile(gl, vs, fs) {
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }

  // ---------- geometry ----------
  function boxGeo() {
    const P = [], Nn = [], I = [];
    const faces = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];
    for (const [a, b, c, s] of faces) {
      const base = P.length / 3;
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0]; p[a] = s * 0.5; p[b] = u * 0.5; p[c] = v * 0.5;
        const n = [0, 0, 0]; n[a] = s;
        P.push(...p); Nn.push(...n);
      }
      if (s > 0) I.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else I.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
    return { P, N: Nn, I };
  }
  function sphereGeo(seg) {
    const P = [], Nn = [], I = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg * Math.PI;
      for (let j = 0; j <= seg * 2; j++) {
        const f = j / (seg * 2) * Math.PI * 2;
        const x = Math.sin(t) * Math.cos(f), y = Math.cos(t), z = Math.sin(t) * Math.sin(f);
        P.push(x * 0.5, y * 0.5, z * 0.5); Nn.push(x, y, z);
      }
    }
    const row = seg * 2 + 1;
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg * 2; j++) {
      const a = i * row + j, b = a + row;
      I.push(a, a + 1, b, a + 1, b + 1, b);
    }
    return { P, N: Nn, I };
  }
  function cylGeo(seg) {
    const P = [], Nn = [], I = [];
    for (let j = 0; j <= seg; j++) {
      const f = j / seg * Math.PI * 2, x = Math.cos(f), z = Math.sin(f);
      P.push(x * 0.5, -0.5, z * 0.5, x * 0.5, 0.5, z * 0.5); Nn.push(x, 0, z, x, 0, z);
    }
    for (let j = 0; j < seg; j++) { const a = j * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    for (const s of [1, -1]) {
      const c = P.length / 3; P.push(0, s * 0.5, 0); Nn.push(0, s, 0);
      for (let j = 0; j <= seg; j++) { const f = j / seg * Math.PI * 2; P.push(Math.cos(f) * 0.5, s * 0.5, Math.sin(f) * 0.5); Nn.push(0, s, 0); }
      for (let j = 0; j < seg; j++) { if (s > 0) I.push(c, c + 2 + j, c + 1 + j); else I.push(c, c + 1 + j, c + 2 + j); }
    }
    return { P, N: Nn, I };
  }

  const INST_FLOATS = 24; // mat4 + colour + material

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', alpha: false });
      if (!gl) throw new Error('This browser has no WebGL2.');
      this.gl = gl;
      this.scale = 1;
      this.shadowsOn = true;
      this.lost = false;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.init(); if (this.mapKey) this.setMap(this.world); });
      this.init();
    }
    init() {
      const gl = this.gl;
      this.progT = compile(gl, TERRAIN_VS, TERRAIN_FS);
      this.progM = compile(gl, MESH_VS, MESH_FS);
      this.progS = compile(gl, SHADOW_VS, SHADOW_FS);
      this.progSky = compile(gl, SKY_VS, SKY_FS);
      this.progP = compile(gl, PART_VS, PART_FS);
      this.progB = compile(gl, BEAM_VS, BEAM_FS);
      // meshes
      this.meshes = {};
      for (const [k, g] of Object.entries({ box: boxGeo(), sphere: sphereGeo(8), cyl: cylGeo(14) })) this.meshes[k] = this.makeMesh(g);
      // full-screen triangle
      this.triVao = gl.createVertexArray(); gl.bindVertexArray(this.triVao);
      const tb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      // particle quad
      this.quadBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
      this.partVao = gl.createVertexArray(); gl.bindVertexArray(this.partVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.partBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
      this.beamVao = gl.createVertexArray(); gl.bindVertexArray(this.beamVao);
      const bq = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bq); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.beamBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
      for (let i = 0; i < 3; i++) { gl.enableVertexAttribArray(1 + i); gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, 48, i * 16); gl.vertexAttribDivisor(1 + i, 1); }
      gl.bindVertexArray(null);
      // shadow map
      this.shadowSize = 2048;
      this.shadowTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, this.shadowSize, this.shadowSize);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.shadowFb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.terrain = null;
    }
    makeMesh(g) {
      const gl = this.gl;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
      const data = new Float32Array(g.P.length * 2);
      for (let i = 0; i < g.P.length / 3; i++) { data.set(g.P.slice(i * 3, i * 3 + 3), i * 6); data.set(g.N.slice(i * 3, i * 3 + 3), i * 6 + 3); }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.I), gl.STATIC_DRAW);
      const inst = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      for (let i = 0; i < 6; i++) { gl.enableVertexAttribArray(2 + i); gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16); gl.vertexAttribDivisor(2 + i, 1); }
      gl.bindVertexArray(null);
      return { vao, count: g.I.length, inst, data: new Float32Array(INST_FLOATS * 256), n: 0, static: null };
    }

    // ---------- the map ----------
    setMap(world) {
      this.world = world;
      this.mapKey = world.mapKey;
      this.look = world.def.look;
      const gl = this.gl, t = world.terrain;
      const look = this.look;
      const sun = norm(look.sun);
      this.sun = sun;
      const V = N + 1;
      // vertices: position, normal, baked sun visibility (hills shading each other) and a bit of hollow darkening
      const data = new Float32Array(V * V * 7);
      let hmin = Infinity, hmax = -Infinity;
      for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) {
        const x = ix * CELL, z = iz * CELL, h = t.at(ix, iz);
        hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
        // smooth normal from neighbours
        const hl = t.at(ix - 1, iz), hr = t.at(ix + 1, iz), hd = t.at(ix, iz - 1), hu = t.at(ix, iz + 1);
        const n = norm([(hl - hr) / (2 * CELL), 1, (hd - hu) / (2 * CELL)]);
        // march toward the sun over the heightfield
        let vis = 1;
        for (let s = 1; s <= 48; s++) {
          const d = s * s * 1.5 + s * 4;
          const px = x + sun[0] * d, pz = z + sun[2] * d, py = h + sun[1] * d + 1;
          if (px < 0 || px > SIZE || pz < 0 || pz > SIZE) break;
          const th = t.height(px, pz);
          if (th > py) { vis = Math.max(0, vis - (th - py) / 6); if (vis <= 0) break; }
        }
        const around = (hl + hr + hd + hu) / 4;
        const ao = clamp01(0.85 + (h - around) * 0.04);
        const o = (iz * V + ix) * 7;
        data[o] = x; data[o + 1] = h; data[o + 2] = z;
        data[o + 3] = n[0]; data[o + 4] = n[1]; data[o + 5] = n[2];
        data[o + 6] = vis * ao;
      }
      const idx = new Uint32Array(N * N * 6);
      let k = 0;
      for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
        const a = iz * V + ix, b = a + 1, c = a + V, d = c + 1;
        // same split as the physics: (00,10,01) and (11,01,10)
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = d; idx[k++] = b; idx[k++] = c;
      }
      if (this.terrain) { gl.deleteVertexArray(this.terrain.vao); }
      this.terrain = this.makeTerrainVao(data, idx);
      this.hmin = hmin; this.hmax = hmax;
      // the ring of hills around the map, coarse, out to the fog
      this.ring = this.makeRing(world, hmin, hmax);
      // buildings: static boxes
      this.buildStatic(world);
    }
    makeTerrainVao(data, idx) {
      const gl = this.gl;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 28, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return { vao, count: idx.length };
    }
    makeRing(world, hmin, hmax) {
      const t = world.terrain;
      const C = 128, R = 40, lo = -R * C / 2 + SIZE / 2;
      const V = R + 1;
      const data = new Float32Array(V * V * 7);
      const H = (x, z) => {
        const cx = Math.min(SIZE, Math.max(0, x)), cz = Math.min(SIZE, Math.max(0, z));
        const out = Math.max(Math.abs(x - cx), Math.abs(z - cz));
        const edge = t.height(cx, cz);
        const m = JF.fbm(x / 900, z / 900, 991, 4, 0.5) * 0.5 + 0.5;
        return edge + Math.min(1, out / 900) * (30 + m * (hmax - hmin) * 0.8) - (out > 4000 ? (out - 4000) * 0.3 : 0);
      };
      for (let iz = 0; iz < V; iz++) for (let ix = 0; ix < V; ix++) {
        const x = lo + ix * C, z = lo + iz * C;
        const inside = x > 0 && x < SIZE && z > 0 && z < SIZE;
        const h = inside ? t.height(x, z) - 30 : H(x, z);
        const hl = H(x - C, z), hr = H(x + C, z), hd = H(x, z - C), hu = H(x, z + C);
        const n = norm([(hl - hr) / (2 * C), 1, (hd - hu) / (2 * C)]);
        const o = (iz * V + ix) * 7;
        data[o] = x; data[o + 1] = h; data[o + 2] = z; data[o + 3] = n[0]; data[o + 4] = n[1]; data[o + 5] = n[2]; data[o + 6] = 0.9;
      }
      const idx = [];
      for (let iz = 0; iz < R; iz++) for (let ix = 0; ix < R; ix++) {
        const x0 = lo + ix * C, z0 = lo + iz * C;
        if (x0 >= 0 && x0 + C <= SIZE && z0 >= 0 && z0 + C <= SIZE) continue; // the real land is drawn there
        const a = iz * V + ix, b = a + 1, c = a + V, d = c + 1;
        idx.push(a, c, b, d, b, c);
      }
      return this.makeTerrainVao(data, new Uint32Array(idx));
    }

    buildStatic(world) {
      const list = [];
      const look = this.look;
      for (const s of world.solids) {
        if (s.obj) continue;
        const b = s.b;
        const team = JF.TEAMS[s.team].rgb;
        let col = [0.5, 0.52, 0.55], panel = 2, stripe = 0, spec = 0.4;
        if (s.mat === 'roof') { col = [0.36, 0.38, 0.42]; }
        else if (s.mat === 'floor') { col = [0.3, 0.31, 0.33]; panel = 1.5; }
        else if (s.mat === 'trim') { col = mixc([0.45, 0.45, 0.48], team, 0.35); stripe = 0; }
        else if (s.mat === 'stand') { col = mixc([0.3, 0.3, 0.32], team, 0.5); }
        else if (s.mat === 'mast') { col = [0.42, 0.43, 0.45]; panel = 3; }
        else if (s.mat === 'cover') { col = [0.46, 0.45, 0.43]; panel = 1.5; }
        else { col = [0.55, 0.56, 0.58]; stripe = 1; }
        // blend a touch of the ground colour in so buildings sit in the land
        col = mixc(col, look.mid, 0.08);
        list.push({ b, col, mat: [0, panel, 0, spec], team });
        // team stripes glow in the team colour: an extra thin band on the walls
        if (stripe) {
          const h = b[4] - b[1];
          if (h > 4) list.push({ b: [b[0] - 0.02, b[4] - 1.0, b[2] - 0.02, b[3] + 0.02, b[4] - 0.75, b[5] + 0.02], col: team, mat: [1.6, 0, 0, 0.2] });
        }
      }
      // door frames light
      for (const base of world.bases) {
        const o = base.o, team = JF.TEAMS[base.team].rgb;
        for (const sx of [-1, 1]) {
          const x = o.x + sx * 12.05 * o.face;
          list.push({ b: [x - 0.08, o.y, o.z - 2.4, x + 0.08, o.y + 4.8, o.z - 2.2], col: team, mat: [2, 0, 0, 0] });
          list.push({ b: [x - 0.08, o.y, o.z + 2.2, x + 0.08, o.y + 4.8, o.z + 2.4], col: team, mat: [2, 0, 0, 0] });
          list.push({ b: [x - 0.08, o.y + 4.6, o.z - 2.4, x + 0.08, o.y + 4.8, o.z + 2.4], col: team, mat: [2, 0, 0, 0] });
        }
        // team banners on the outside of the side walls
        for (const sz of [-1, 1]) {
          const z = o.z + sz * 9.06;
          for (const bx of [-6, 6]) list.push({ b: [o.x + bx - 1.6, o.y + 2.2, z - 0.05, o.x + bx + 1.6, o.y + 7.2, z + 0.05], col: team, mat: [0.35, 0, 0, 0.2] });
        }
        // a beacon on the mast
        const mx = o.x - 33 * o.face;
        list.push({ b: [mx - 0.4, o.y + 25, o.z - 0.4, mx + 0.4, o.y + 25.8, o.z + 0.4], col: team, mat: [4, 0, 0, 0] });
        // interior lights on the ceiling
        for (const lx of [-6, 0, 6]) list.push({ b: [o.x + lx - 1.2, o.y + 7.85, o.z - 0.3, o.x + lx + 1.2, o.y + 7.95, o.z + 0.3], col: [1, 0.95, 0.85], mat: [3, 0, 0, 0] });
      }
      const m = this.meshes.box;
      const data = new Float32Array(list.length * INST_FLOATS);
      list.forEach((it, i) => {
        const b = it.b, o = i * INST_FLOATS;
        trs(data, o, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, 0, 0, b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        data.set([it.col[0], it.col[1], it.col[2], 1], o + 16);
        data.set(it.mat, o + 20);
      });
      this.setStatic('box', data, list.length);
      this.scatterRocks(world);
    }
    setStatic(kind, data, n) {
      const m = this.meshes[kind], gl = this.gl;
      if (!m.staticBuf) m.staticBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, m.staticBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      m.staticN = n;
    }
    // boulders, for scale and detail. Only to look at: they are low and the physics ignores them.
    scatterRocks(world) {
      const t = world.terrain, look = this.look;
      const rng = JF.mulberry(world.def.seed * 7 + 1);
      const n = look.rocks == null ? 900 : look.rocks;
      const data = new Float32Array(n * INST_FLOATS);
      let k = 0;
      for (let i = 0; i < n * 3 && k < n; i++) {
        const x = JF.AREA_MIN - 150 + rng() * (JF.AREA_MAX - JF.AREA_MIN + 300), z = JF.AREA_MIN - 150 + rng() * (JF.AREA_MAX - JF.AREA_MIN + 300);
        // keep clear of the bases
        if (world.bases.some(b => Math.hypot(b.o.x - x, b.o.z - z) < 70)) continue;
        const nr = t.normal(x, z);
        const steep = 1 - nr[1];
        if (rng() > 0.25 + steep * 3) continue; // more on slopes
        const s = (1.0 + rng() * rng() * 4.5) * (steep > 0.2 ? 1.5 : 1);
        const y = t.height(x, z) - s * 0.4;
        trs(data, k * INST_FLOATS, x, y, z, rng() * 6.28, (rng() - 0.5) * 0.6, s * (1 + rng()), s * (0.6 + rng() * 0.5), s * (1 + rng()), (rng() - 0.5) * 0.4);
        const shade = 0.8 + rng() * 0.35;
        const c = look.rockCol || look.rock;
        data.set([c[0] * shade, c[1] * shade, c[2] * shade, 1], k * INST_FLOATS + 16);
        data.set([0, 0, 0, 0.15], k * INST_FLOATS + 20);
        k++;
      }
      this.setStatic('sphere', data, k);
    }

    // ---------- per frame ----------
    // scene: { cam: {pos, yaw, pitch, fov}, boxes/spheres/cyls: instance arrays (built with put*), parts, beams, lights, time }
    resize() {
      const c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
      const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    beginInstances() { for (const m of Object.values(this.meshes)) m.n = 0; }
    // add one instance: kind 'box' | 'sphere' | 'cyl'
    put(kind, x, y, z, yaw, pitch, sx, sy, sz, col, mat, roll) {
      const m = this.meshes[kind];
      if ((m.n + 1) * INST_FLOATS > m.data.length) { const nd = new Float32Array(m.data.length * 2); nd.set(m.data); m.data = nd; }
      const o = m.n * INST_FLOATS;
      trs(m.data, o, x, y, z, yaw, pitch, sx, sy, sz, roll);
      m.data[o + 16] = col[0]; m.data[o + 17] = col[1]; m.data[o + 18] = col[2]; m.data[o + 19] = col.length > 3 ? col[3] : 1;
      m.data[o + 20] = mat ? mat[0] : 0; m.data[o + 21] = mat ? mat[1] : 0; m.data[o + 22] = mat ? mat[2] : 0; m.data[o + 23] = mat ? mat[3] : 0.3;
      m.n++;
    }
    // a raw matrix (already built)
    putM(kind, mat16, col, mat) {
      const m = this.meshes[kind];
      if ((m.n + 1) * INST_FLOATS > m.data.length) { const nd = new Float32Array(m.data.length * 2); nd.set(m.data); m.data = nd; }
      const o = m.n * INST_FLOATS;
      m.data.set(mat16, o);
      m.data[o + 16] = col[0]; m.data[o + 17] = col[1]; m.data[o + 18] = col[2]; m.data[o + 19] = col.length > 3 ? col[3] : 1;
      m.data[o + 20] = mat ? mat[0] : 0; m.data[o + 21] = mat ? mat[1] : 0; m.data[o + 22] = mat ? mat[2] : 0; m.data[o + 23] = mat ? mat[3] : 0.3;
      m.n++;
    }

    frame(scene) {
      if (this.lost || !this.terrain) return;
      const gl = this.gl;
      this.resize();
      const W = this.canvas.width, H = this.canvas.height;
      const cam = scene.cam;
      const f = JF.aimDir(cam.yaw, cam.pitch), r = JF.rightDir(cam.yaw);
      const u = cross(r, f);
      const view = M4.view(cam.pos, f, r, u);
      const proj = M4.persp(cam.fov, W / H, 0.12, 6000);
      const vp = M4.mul(proj, view);
      this.vp = vp; this.camF = f; this.camR = r; this.camU = u; this.camPos = cam.pos; this.W = W; this.H = H;
      const look = this.look, sun = this.sun;

      // upload instance data
      for (const m of Object.values(this.meshes)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.inst);
        gl.bufferData(gl.ARRAY_BUFFER, m.data.subarray(0, m.n * INST_FLOATS), gl.STREAM_DRAW);
      }

      // ----- shadow pass -----
      let shadowMat = null;
      if (this.shadowsOn) {
        const ext = 90;
        const c = [cam.pos[0] + f[0] * ext * 0.6, cam.pos[1], cam.pos[2] + f[2] * ext * 0.6];
        // light basis
        const ld = [-sun[0], -sun[1], -sun[2]];
        let lr = norm(cross(ld, [0, 1, 0])); if (!isFinite(lr[0])) lr = [1, 0, 0];
        const lu = cross(lr, ld);
        // snap to texels so the shadow edges do not crawl
        const texel = ext * 2 / this.shadowSize;
        const cr = dot(c, lr), cu = dot(c, lu);
        const sc = [c[0] + lr[0] * (Math.round(cr / texel) * texel - cr) + lu[0] * (Math.round(cu / texel) * texel - cu), c[1] + lr[1] * (Math.round(cr / texel) * texel - cr) + lu[1] * (Math.round(cu / texel) * texel - cu), c[2] + lr[2] * (Math.round(cr / texel) * texel - cr) + lu[2] * (Math.round(cu / texel) * texel - cu)];
        const eye = [sc[0] - ld[0] * 400, sc[1] - ld[1] * 400, sc[2] - ld[2] * 400];
        const lv = M4.view(eye, ld, lr, lu);
        const lp = M4.ortho(-ext, ext, -ext, ext, 1, 900);
        shadowMat = M4.mul(lp, lv);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFb);
        gl.viewport(0, 0, this.shadowSize, this.shadowSize);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
        gl.useProgram(this.progS.p);
        gl.uniformMatrix4fv(this.progS.u.uVP, false, shadowMat);
        this.drawMeshes(true);
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }

      gl.viewport(0, 0, W, H);
      gl.clearColor(look.fog[0], look.fog[1], look.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);

      const lights = scene.lights || [];
      const setCommon = prog => {
        const U = prog.u;
        gl.uniform3fv(U.uSunDir, sun); gl.uniform3fv(U.uSunCol, look.sunColor); gl.uniform3fv(U.uAmb, look.ambient);
        if (U.uSkyTop) gl.uniform3fv(U.uSkyTop, look.skyTop);
        if (U.uSkyHor) gl.uniform3fv(U.uSkyHor, look.skyHorizon);
        gl.uniform3fv(U.uFogCol, look.fog); gl.uniform1f(U.uFogDist, look.fogDist * (scene.fogScale || 1));
        gl.uniform3fv(U.uCam, cam.pos); gl.uniform1f(U.uTime, scene.time || 0);
        const n = Math.min(MAX_LIGHTS, lights.length);
        if (U.uNumLights) {
          gl.uniform1i(U.uNumLights, n);
          if (n) {
            const lp = new Float32Array(MAX_LIGHTS * 4), lc = new Float32Array(MAX_LIGHTS * 3);
            for (let i = 0; i < n; i++) { lp.set([lights[i].x, lights[i].y, lights[i].z, lights[i].r], i * 4); lc.set(lights[i].c, i * 3); }
            gl.uniform4fv(U.uLightPos, lp); gl.uniform3fv(U.uLightCol, lc);
          }
        }
        if (U.uShadow) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
          gl.uniform1i(U.uShadow, 0);
          gl.uniform1f(U.uShadowOn, shadowMat ? 1 : 0);
          if (shadowMat) gl.uniformMatrix4fv(U.uShadowMat, false, shadowMat);
        }
      };

      // ----- land -----
      const T = this.progT;
      gl.useProgram(T.p); setCommon(T);
      gl.uniformMatrix4fv(T.u.uVP, false, vp);
      gl.uniform3fv(T.u.uLow, look.low); gl.uniform3fv(T.u.uMid, look.mid); gl.uniform3fv(T.u.uHigh, look.high);
      gl.uniform3fv(T.u.uRock, look.rock); gl.uniform3fv(T.u.uSnow, look.snow);
      gl.uniform1f(T.u.uSnowLine, look.snowLine); gl.uniform1f(T.u.uHmin, this.hmin); gl.uniform1f(T.u.uHmax, this.hmax);
      gl.uniform1f(T.u.uLava, look.lava ? 1 : 0);
      gl.bindVertexArray(this.terrain.vao); gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(this.ring.vao); gl.drawElements(gl.TRIANGLES, this.ring.count, gl.UNSIGNED_INT, 0);

      // ----- solid things -----
      const Mp = this.progM;
      gl.useProgram(Mp.p); setCommon(Mp);
      gl.uniformMatrix4fv(Mp.u.uVP, false, vp);
      this.drawMeshes(false);

      // ----- sky (behind everything, drawn last to save fill) -----
      const S = this.progSky;
      gl.useProgram(S.p); setCommon(S);
      gl.uniformMatrix4fv(S.u.uInvVP, false, M4.inv(vp));
      gl.uniform1f(S.u.uClouds, look.clouds);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.triVao); gl.drawArrays(gl.TRIANGLES, 0, 3);

      // ----- see-through things (shields) -----
      if (scene.glass && scene.glass.length) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.depthMask(false);
        gl.useProgram(Mp.p);
        const m = this.meshes.sphere, d = new Float32Array(scene.glass.length * INST_FLOATS);
        scene.glass.forEach((g, i) => { trs(d, i * INST_FLOATS, g.x, g.y, g.z, 0, 0, g.s, g.s * 1.2, g.s); d.set([g.c[0], g.c[1], g.c[2], g.a], i * INST_FLOATS + 16); d.set([0.6, 0, 0, 1], i * INST_FLOATS + 20); });
        gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STREAM_DRAW);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, scene.glass.length);
      }

      // ----- particles -----
      gl.enable(gl.BLEND); gl.depthMask(false);
      if (scene.parts && scene.parts.n) {
        const P = this.progP;
        gl.useProgram(P.p); setCommon(P);
        gl.uniformMatrix4fv(P.u.uVP, false, vp);
        gl.uniform3fv(P.u.uRight, r); gl.uniform3fv(P.u.uUp, u);
        gl.bindVertexArray(this.partVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.partBuf);
        gl.bufferData(gl.ARRAY_BUFFER, scene.parts.data.subarray(0, scene.parts.n * 12), gl.STREAM_DRAW);
        // premultiplied: smoke uses alpha (blend), glows add (alpha ~0 in the w channel of aK)
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.parts.n);
      }
      if (scene.beams && scene.beams.n) {
        const Bp = this.progB;
        gl.useProgram(Bp.p);
        gl.uniformMatrix4fv(Bp.u.uVP, false, vp); gl.uniform3fv(Bp.u.uCam, cam.pos);
        gl.bindVertexArray(this.beamVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
        gl.bufferData(gl.ARRAY_BUFFER, scene.beams.data.subarray(0, scene.beams.n * 12), gl.STREAM_DRAW);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.beams.n);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);

      // ----- first-person weapon: its own near camera, drawn over everything -----
      if (scene.viewModel && scene.viewModel.length) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const vproj = M4.persp(1.1, W / H, 0.02, 10);
        const vvp = M4.mul(vproj, view);
        gl.useProgram(Mp.p); setCommon(Mp);
        gl.uniform1f(Mp.u.uShadowOn, 0);
        gl.uniformMatrix4fv(Mp.u.uVP, false, vvp);
        gl.enable(gl.CULL_FACE);
        const byKind = {};
        for (const it of scene.viewModel) (byKind[it.kind] = byKind[it.kind] || []).push(it);
        for (const [kind, list] of Object.entries(byKind)) {
          const m = this.meshes[kind], d = new Float32Array(list.length * INST_FLOATS);
          list.forEach((it, i) => { d.set(it.m, i * INST_FLOATS); d.set([it.col[0], it.col[1], it.col[2], 1], i * INST_FLOATS + 16); d.set(it.mat || [0, 0, 0, 0.6], i * INST_FLOATS + 20); });
          gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STREAM_DRAW);
          gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, list.length);
        }
      }
      gl.bindVertexArray(null);
    }

    drawMeshes(shadow) {
      const gl = this.gl;
      for (const [k, m] of Object.entries(this.meshes)) {
        if (m.staticN) {
          // static instances: bind the static buffer as instances
          gl.bindVertexArray(m.vao);
          gl.bindBuffer(gl.ARRAY_BUFFER, m.staticBuf);
          for (let i = 0; i < 6; i++) gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
          gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.staticN);
          gl.bindBuffer(gl.ARRAY_BUFFER, m.inst);
          for (let i = 0; i < 6; i++) gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
        }
        if (!m.n) continue;
        gl.bindVertexArray(m.vao);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.n);
      }
      void shadow;
    }

    // world point to screen pixels (CSS), or null when behind
    project(p) {
      const m = this.vp;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
      const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= 0.1) return null;
      const c = this.canvas;
      return { x: (x / w * 0.5 + 0.5) * c.clientWidth, y: (1 - (y / w * 0.5 + 0.5)) * c.clientHeight, d: w };
    }
  }

  // particle and beam buffers the page fills each frame
  class Batch {
    constructor(n) { this.data = new Float32Array(n * 12); this.n = 0; }
    reset() { this.n = 0; }
    grow() { if ((this.n + 1) * 12 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; } }
    // particle: position, size, colour (rgb, alpha), kind (0 glow, 1 smoke, 2 spark), rotation, seed, blend (0 add, 1 alpha)
    part(x, y, z, s, r, g, b, a, kind, rot, seed, blend) {
      this.grow(); const d = this.data, o = this.n * 12;
      d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = s;
      d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = a;
      d[o + 8] = kind; d[o + 9] = rot || 0; d[o + 10] = seed || 0; d[o + 11] = blend || 0;
      this.n++;
    }
    beam(ax, ay, az, aw, bx, by, bz, bw, r, g, b, a) {
      this.grow(); const d = this.data, o = this.n * 12;
      d[o] = ax; d[o + 1] = ay; d[o + 2] = az; d[o + 3] = aw; d[o + 4] = bx; d[o + 5] = by; d[o + 6] = bz; d[o + 7] = bw;
      d[o + 8] = r; d[o + 9] = g; d[o + 10] = b; d[o + 11] = a;
      this.n++;
    }
  }

  function norm(v) { const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  root.JFRender = { Renderer, Batch, M4, trs, norm, cross, mixc };
})(window);
