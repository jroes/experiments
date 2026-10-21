/*
 * Jetfall renderer: raw WebGL2, no library.
 *
 *  - land: one mesh from the heightfield (the same triangles the physics uses), a coarse ring of hills around it,
 *    colours by height and slope with noise worked out in the shader, the sun's shadow from the hills baked per vertex
 *    and in a small texture (so people and smoke standing in a hill's shadow are in it too)
 *  - everything solid (bunkers, armor, turrets, flags, discs) is an instanced box, sphere or cylinder: one draw each,
 *    lit with a GGX specular, sky reflections, worn edges and grime worked out from the box's own shape
 *  - two sun shadow maps around the camera (a sharp one close by, a wide one further out), filtered with rotated taps
 *  - particles and beams: instanced quads, additive or blended
 *  - sky: one full-screen triangle with the sun, two cloud layers lit from the sun's side, stars when it is dark
 *  - water: a sheet that knows how deep it is (from the heightfield texture), so there is foam and a clear shallow edge
 *  - up to 12 point lights from explosions, bolts, flags and the lights inside the bunkers
 *  - on mid and high quality the scene is drawn in HDR to a texture and finished in a post pass: bloom, light shafts
 *    from the sun, heat haze over lava, chromatic fringe, filmic tone mapping with a colour grade per map, vignette
 *    and grain. High adds 4x MSAA; mid uses FXAA instead. Low draws straight to the canvas like the first version.
 *
 * Browser only. The scene is described fresh every frame by the page (ui.js) through `frame()`.
 */
(function (root) {
  'use strict';
  const JF = root.JF;
  const { N, CELL, SIZE } = JF;
  const MAX_LIGHTS = 12;

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
  // Shared by everything that is lit. Colours stay linear and unclipped (HDR) until the post pass; on the low
  // path (no post) `outc` tone-maps in place. The alpha written to the HDR target is a mask for the post pass:
  // 1 = sky (light shafts come from there), 0 < a < 0.6 = heat haze over lava, 0 = everything else.
  const COMMON = `
  uniform vec3 uSunDir, uSunCol, uAmb, uSkyTop, uSkyHor, uFogCol, uCam, uGround;
  uniform float uFogDist, uTime, uHDR, uWet;
  uniform vec4 uLightPos[${MAX_LIGHTS}];
  uniform vec3 uLightCol[${MAX_LIGHTS}];
  uniform int uNumLights;
  uniform highp sampler2DShadow uShadowN, uShadowF;
  uniform mat4 uShadowMatN, uShadowMatF;
  uniform float uShadowOn, uNearOn, uClouds;
  uniform sampler2D uHF;
  // surface textures (render-tex): albedo + height, and normal xy + roughness; one layer per material
  uniform mediump sampler2DArray uTexA, uTexN;
  uniform float uTexOn;
  uniform vec4 uMat[16];   // per material: x = repeats per metre, yzw = 1 / its mean albedo
  const float PI = 3.14159265;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.07; a *= 0.5; } return s; }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 p) { vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z); }
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  vec3 triW(vec3 n) { vec3 w = abs(n); w = w * w; w = w * w; return w / (w.x + w.y + w.z); }
  // Material m on a surface at p (metres) with normal n, mapped from the three axes and blended by w (triW).
  // A.rgb = albedo over the material's mean (so 1 on average: it is a detail, the caller's colour is the tint),
  // A.a = height; Nr.xyz = the surface normal with the texture's bumps (whiteout blend), Nr.w = roughness.
  void matTri(int m, vec3 p, vec3 n, vec3 w, float scale, out vec4 A, out vec4 Nr) {
    float s = uMat[m].x * scale, L = float(m);
    A = vec4(0.0); vec3 nn = vec3(0.0); float r = 0.0, ws = 0.0;
    if (w.y > 0.03) {
      vec2 uv = p.xz * s;
      vec4 a = texture(uTexA, vec3(uv, L)); vec3 t = texture(uTexN, vec3(uv, L)).xyz;
      vec2 tn = t.xy * 2.0 - 1.0; float tz = sqrt(max(0.0, 1.0 - dot(tn, tn)));
      vec3 b = vec3(tn + n.xz, tz * n.y);
      A += a * w.y; nn += b.xzy * w.y; r += t.z * w.y; ws += w.y;
    }
    if (w.x > 0.03) {
      vec2 uv = p.zy * s;
      vec4 a = texture(uTexA, vec3(uv, L)); vec3 t = texture(uTexN, vec3(uv, L)).xyz;
      vec2 tn = t.xy * 2.0 - 1.0; float tz = sqrt(max(0.0, 1.0 - dot(tn, tn)));
      vec3 b = vec3(tn + n.zy, tz * n.x);
      A += a * w.x; nn += b.zyx * w.x; r += t.z * w.x; ws += w.x;
    }
    if (w.z > 0.03) {
      vec2 uv = p.xy * s;
      vec4 a = texture(uTexA, vec3(uv, L)); vec3 t = texture(uTexN, vec3(uv, L)).xyz;
      vec2 tn = t.xy * 2.0 - 1.0; float tz = sqrt(max(0.0, 1.0 - dot(tn, tn)));
      vec3 b = vec3(tn + n.xy, tz * n.z);
      A += a * w.z; nn += b.xyz * w.z; r += t.z * w.z; ws += w.z;
    }
    ws = max(ws, 1e-4);
    A /= ws; r /= ws;
    A.rgb *= uMat[m].yzw;
    Nr = vec4(normalize(nn + n * 1e-3), r);
  }
  // the heightfield texture: x = ground height, y = how much sun reaches the ground there, z = 1 where something is built on it
  vec2 hfAt(vec2 xz) { return texture(uHF, (xz / ${CELL}.0 + 0.5) / ${N + 1}.0).xy; }
  // things near the ground share the hills' shade; 30 m up they are in full sun
  float groundShade(vec3 wp) { vec2 h = hfAt(wp.xz); return mix(h.y, 1.0, smoothstep(0.0, 30.0, wp.y - h.x)); }
  const vec2 POIS[8] = vec2[8](vec2(-0.707, 0.707), vec2(0.0, -0.875), vec2(0.53, 0.53), vec2(-0.625, 0.0), vec2(0.354, -0.354), vec2(0.0, 0.375), vec2(-0.177, -0.177), vec2(0.125, 0.0));
  float pcf(highp sampler2DShadow sm, vec3 c, float rad, float bias, float ang) {
    float ca = cos(ang), sa = sin(ang), s = 0.0;
    for (int i = 0; i < 8; i++) { vec2 o = POIS[i]; o = vec2(o.x * ca - o.y * sa, o.x * sa + o.y * ca) * rad; s += texture(sm, vec3(c.xy + o, c.z - bias)); }
    return s * 0.125;
  }
  float shadowAt(vec3 wp, vec3 n) {
    if (uShadowOn < 0.5) return 1.0;
    vec3 wpo = wp + n * 0.1;
    float ang = hash(gl_FragCoord.xy) * 6.2832;
    float far = 1.0;
    vec4 sf = uShadowMatF * vec4(wpo, 1.0); vec3 cf = sf.xyz * 0.5 + 0.5;
    float mf = max(abs(cf.x - 0.5), abs(cf.y - 0.5)) * 2.0;
    if (mf < 1.0 && cf.z < 1.0) far = mix(pcf(uShadowF, cf, 1.3 / 2048.0, 0.001, ang), 1.0, smoothstep(0.86, 1.0, mf));
    if (uNearOn > 0.5) {
      vec4 sn = uShadowMatN * vec4(wpo, 1.0); vec3 cn = sn.xyz * 0.5 + 0.5;
      float mn = max(abs(cn.x - 0.5), abs(cn.y - 0.5)) * 2.0;
      if (mn < 1.0 && cn.z < 1.0 && cn.z > 0.0) return mix(pcf(uShadowN, cn, 2.0 / 2048.0, 0.0005, ang), far, smoothstep(0.8, 1.0, mn));
    }
    return far;
  }
  vec3 pointLights(vec3 wp, vec3 n) {
    vec3 s = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= uNumLights) break;
      vec3 d = uLightPos[i].xyz - wp; float l = length(d); float r = uLightPos[i].w;
      if (l < r) { float k = 1.0 - l / r; s += uLightCol[i] * k * k * (0.35 + 0.65 * max(dot(n, d / max(l, 0.001)), 0.0)); }
    }
    // a blast right next to you is bright, not a wall of colour
    return s / (1.0 + 0.35 * lum(s));
  }
  // the clouds' shadows drift over the land
  float cloudAt(vec2 xz) { return 1.0 - 0.4 * uClouds * smoothstep(0.52, 0.72, fbm(xz * 0.0022 + vec2(uTime * 0.012, uTime * 0.006))); }
  // light from the sky above and the ground below
  vec3 hemi(vec3 n) {
    vec3 up = mix(uAmb, uSkyTop * 1.15, 0.3);
    vec3 dn = uAmb * 0.45 * mix(vec3(1.0), uGround * 2.0, 0.18);
    return mix(dn, up, n.y * 0.5 + 0.5);
  }
  vec3 fogMix(vec3 c, vec3 wp) {
    vec3 d = wp - uCam; float dist = length(d);
    float f = 1.0 - exp(-pow(dist / uFogDist, 1.6));
    // thicker low down
    f = clamp(f * (1.0 + 0.4 * exp(-max(wp.y, 0.0) / 120.0)), 0.0, 1.0);
    // far things lose their colour before they lose their shape
    c = mix(c, vec3(lum(c)), f * 0.35);
    float sun = pow(max(dot(normalize(d), uSunDir), 0.0), 8.0);
    vec3 fc = mix(uFogCol, uSunCol, sun * 0.35);
    return mix(c, fc, f);
  }
  vec3 tone(vec3 c) { c = max(c, 0.0); return c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14); }
  vec3 outc(vec3 c) { return uHDR > 0.5 ? c : tone(c); }
  `;

  const TERRAIN_VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in float aShade;
  uniform mat4 uVP; out vec3 vPos; out vec3 vNor; out float vShade;
  void main() { vPos = aPos; vNor = aNor; vShade = aShade; gl_Position = uVP * vec4(aPos, 1.0); }`;
  const TERRAIN_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform vec3 uLow, uMid, uHigh, uRock, uSnow; uniform float uSnowLine, uHmin, uHmax, uLava, uLavaH;
  uniform ivec4 uLayers;   // materials for low ground, high and worn ground, cliffs, snow
  uniform float uWorn;     // how much worn, earthy ground shows on slopes and in patches (look.worn)
  in vec3 vPos; in vec3 vNor; in float vShade; out vec4 o;
  void main() {
    vec3 gn = normalize(vNor);
    float camD = length(vPos - uCam);
    float near = 1.0 - smoothstep(12.0, 90.0, camD);
    float h = clamp((vPos.y - uHmin) / (uHmax - uHmin), 0.0, 1.0);
    float big = fbm(vPos.xz * 0.004);
    float mid = fbm(vPos.xz * 0.05);
    float fine = uTexOn > 0.5 ? 0.5 : mix(noise(vPos.xz * 0.9) * 0.5 + noise(vPos.xz * 3.1) * 0.5, 0.5, smoothstep(60.0, 400.0, camD));
    float hh = h + (big - 0.5) * 0.25;
    float patchy = fbm(vPos.xz * 0.0016 + 7.3);
    float slope = 1.0 - gn.y;
    float rock = smoothstep(0.28, 0.45, slope + (mid - 0.5) * 0.15);
    // small bumps close up: rock is craggy, soil is soft. Only the lighting sees them.
    vec3 n = gn;
    if (near > 0.001 && uTexOn < 0.5) {
      vec2 p = vPos.xz * (1.6 + rock * 1.2); float e = 0.12;
      float b0 = noise(p) * 0.5 + noise(p * 3.1) * 0.5;
      float bx = noise(p + vec2(e, 0.0)) * 0.5 + noise(p * 3.1 + vec2(e * 3.1, 0.0)) * 0.5;
      float bz = noise(p + vec2(0.0, e)) * 0.5 + noise(p * 3.1 + vec2(0.0, e * 3.1)) * 0.5;
      n = normalize(gn + vec3(b0 - bx, 0.0, b0 - bz) * (0.45 + rock * 2.5) * near);
    }
    vec3 col = mix(uLow, uMid, smoothstep(0.15, 0.45, hh + (mid - 0.5) * 0.2));
    col = mix(col, col * vec3(1.18, 1.06, 0.78), smoothstep(0.45, 0.7, patchy));
    col = mix(col, col * vec3(0.8, 0.9, 0.85), (1.0 - smoothstep(0.3, 0.5, patchy)) * 0.6);
    col = mix(col, uHigh, smoothstep(0.5, 0.8, hh));
    // worn ground and bare soil in the hollows
    float hollow = 1.0 - smoothstep(0.78, 0.95, vShade);
    col = mix(col, mix(col, uRock, 0.4) * 0.92, hollow * 0.25);
    // rock strata, and moss in the cracks of the lower rock
    float strata = 1.0 - 0.18 * (1.0 - smoothstep(120.0, 500.0, camD)) * (0.5 + 0.5 * sin(vPos.y * 0.9 + fbm(vPos.xz * 0.02) * 6.0));
    vec3 rc = uRock * strata;
    rc = mix(rc, rc * vec3(0.8, 1.0, 0.75), smoothstep(0.55, 0.75, mid) * (1.0 - smoothstep(0.3, 0.6, hh)) * 0.5);
    col = mix(col, rc, rock);
    float snow = smoothstep(uSnowLine - 0.06, uSnowLine + 0.06, hh + (mid - 0.5) * 0.15) * (1.0 - smoothstep(0.35, 0.55, slope));
    float ao = 1.0, texRough = 1.0;
    if (uTexOn > 0.5) {
      // the same split by height and slope, but each part gets its own material, and where they meet the higher
      // texture wins (stones poke through grass, snow sits in the hollows of the rock)
      vec3 cLow = mix(uLow, uMid, smoothstep(0.15, 0.45, hh + (mid - 0.5) * 0.2));
      cLow = mix(cLow, cLow * vec3(1.18, 1.06, 0.78), smoothstep(0.45, 0.7, patchy));
      cLow = mix(cLow, cLow * vec3(0.8, 0.9, 0.85), (1.0 - smoothstep(0.3, 0.5, patchy)) * 0.6);
      float worn = (smoothstep(0.22, 0.3, slope) * 0.8 + smoothstep(0.7, 0.86, fbm(vPos.xz * 0.021 + 3.0) + (noise(vPos.xz * 0.35) - 0.5) * 0.12) * 0.55 + hollow * 0.15) * uWorn;
      float hiF = clamp(smoothstep(0.5, 0.8, hh) + worn, 0.0, 1.0);
      // worn ground: earthy, a bit of the grass's colour in it, darker than bare high ground
      vec3 cHigh = mix(uHigh, mix(uLow, uRock, 0.45) * 0.8, 0.5 * uWorn * (1.0 - smoothstep(0.5, 0.8, hh)));
      float wSnow = snow * (1.0 - rock);
      float rest = (1.0 - rock) * (1.0 - wSnow);
      vec4 w = vec4(rest * (1.0 - hiF), rest * hiF, rock, wSnow);
      vec3 tw = triW(gn);
      vec4 A0 = vec4(1.0, 1.0, 1.0, 0.0), A1 = A0, A2 = A0, A3 = A0;
      vec4 N0 = vec4(gn, 1.0), N1 = N0, N2 = N0, N3 = N0;
      if (w.x > 0.01) {
        matTri(uLayers.x, vPos, gn, tw, 1.0, A0, N0);
        // a second, larger copy of the same texture further off hides the repeat
        float far = smoothstep(12.0, 60.0, camD);
        if (far > 0.0) { vec4 Af, Nf; matTri(uLayers.x, vPos, gn, tw, 0.21, Af, Nf); A0.rgb = mix(A0.rgb, Af.rgb, far * 0.55); }
      }
      if (w.y > 0.01) matTri(uLayers.y, vPos, gn, tw, 1.0, A1, N1);
      if (w.z > 0.01) {
        matTri(uLayers.z, vPos, gn, tw, 1.0, A2, N2);
        // cliffs: a much larger copy for the big shapes, and broad light and dark bands, so a mountainside is not one tile
        float far = smoothstep(8.0, 50.0, camD);
        vec4 Af, Nf; matTri(uLayers.z, vPos, gn, tw, 0.11, Af, Nf);
        A2.rgb = mix(A2.rgb, A2.rgb * Af.rgb, 0.5 + 0.3 * far);
        N2.xyz = normalize(mix(N2.xyz, Nf.xyz, 0.35 + 0.4 * far));
        A2.rgb *= mix(0.68, 1.18, noise(vPos.xz * 0.025 + vPos.y * 0.04)) * mix(0.85, 1.1, fbm(vec2(vPos.x + vPos.z, vPos.y * 3.0) * 0.05));
      }
      if (w.w > 0.01) matTri(uLayers.w, vPos, gn, tw, 1.0, A3, N3);
      vec4 has = step(vec4(0.01), w);
      vec4 hgt = vec4(A0.a, A1.a, A2.a, A3.a);
      vec4 v4 = (w + hgt * 0.55) * has;
      float mx = max(max(v4.x, v4.y), max(v4.z, v4.w)) - 0.22;
      vec4 b = max(v4 - mx, 0.0) * has;
      b /= max(b.x + b.y + b.z + b.w, 1e-4);
      // broad patches of lighter and darker ground, so the land does not read as one lawn from a distance
      float macro = fbm(vPos.xz * 0.006 + 11.0), macro2 = fbm(vPos.xz * 0.022 - 4.0);
      cLow *= mix(vec3(0.78, 0.84, 0.9), vec3(1.15, 1.08, 0.92), macro) * (0.9 + 0.2 * macro2);
      cHigh *= 0.85 + 0.3 * macro2;
      col = cLow * A0.rgb * b.x + cHigh * A1.rgb * b.y + rc * A2.rgb * b.z + uSnow * A3.rgb * b.w;
      n = normalize(N0.xyz * b.x + N1.xyz * b.y + N2.xyz * b.z + N3.xyz * b.w);
      texRough = dot(vec4(N0.w, N1.w, N2.w, N3.w), b);
      float th = dot(hgt, b);
      ao = mix(0.6, 1.0, smoothstep(0.05, 0.55, th));
      rock = b.z; snow = b.w;
    } else col = mix(col, uSnow, snow);
    col *= 0.78 + 0.34 * fine * (1.0 - snow * 0.6) + 0.3 * (mid - 0.5);
    col *= 1.0 - slope * (uTexOn > 0.5 ? 0.15 : 0.35);
    // lava in the low ground (Ashfall)
    vec3 emit = vec3(0.0);
    float heat = 0.0;
    if (uLava > 0.5) {
      // exactly where it burns: below the map's lava level (sim.js works out the same number)
      float lv = 1.0 - smoothstep(uLavaH - 0.3, uLavaH + 0.6, vPos.y);
      float flow = fbm(vPos.xz * 0.03 + vec2(uTime * 0.02, uTime * 0.013));
      vec3 lc = mix(vec3(0.85, 0.12, 0.02), vec3(1.0, 0.55, 0.1), flow) * (0.35 + 0.9 * flow * flow);
      // a dark crust drifts over it
      float crust = smoothstep(0.5, 0.68, fbm(vPos.xz * 0.045 + vec2(uTime * 0.008, -uTime * 0.006)));
      col = mix(col, vec3(0.04, 0.03, 0.03), lv);
      emit = lc * lv * (1.0 - 0.9 * crust) * 1.3;
      float crack = smoothstep(0.48, 0.5, fbm(vPos.xz * 0.12)) * (1.0 - smoothstep(0.5, 0.52, fbm(vPos.xz * 0.12)));
      emit += vec3(1.0, 0.35, 0.05) * crack * 0.22 * (1.0 - smoothstep(uLavaH + 2.0, uLavaH + 25.0, vPos.y));
      heat = lv * 0.5 * (1.0 - smoothstep(20.0, 160.0, camD));
    }
    float sh = shadowAt(vPos, gn) * cloudAt(vPos.xz);
    float sun = max(dot(n, uSunDir), 0.0) * vShade * sh * mix(1.0, ao, 0.4);
    vec3 v = normalize(uCam - vPos);
    vec3 hv = normalize(v + uSunDir);
    // wet ground and snow catch the sun
    float gloss = uWet * (1.0 - rock * 0.5) + snow * 0.25 + rock * 0.08 + (1.0 - texRough) * 0.5;
    float spec = pow(max(dot(n, hv), 0.0), mix(12.0, 60.0, gloss)) * gloss * 0.6 * sun;
    float glint = pow(noise(vPos.xz * 23.0 + v.xz * 2.0), 14.0) * 6.0 * snow * near * sun;
    vec3 amb = hemi(n) * (0.7 + 0.3 * vShade) * ao;
    vec3 lit = col * (uSunCol * sun * 1.15 + amb + pointLights(vPos, n)) + uSunCol * (spec + glint) + emit;
    lit = fogMix(lit, vPos);
    o = vec4(outc(lit), heat);
  }`;

  // instanced meshes: boxes, spheres, cylinders
  const MESH_VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
  layout(location=2) in vec4 aM0; layout(location=3) in vec4 aM1; layout(location=4) in vec4 aM2; layout(location=5) in vec4 aM3;
  layout(location=6) in vec4 aCol; layout(location=7) in vec4 aMat;
  uniform mat4 uVP;
  out vec3 vPos; out vec3 vNor; out vec3 vLocal; out vec3 vLocalN; out vec3 vHalf; out vec4 vCol; out vec4 vMat; out vec3 vT; out vec3 vB; out mat3 vNM;
  void main() {
    mat4 m = mat4(aM0, aM1, aM2, aM3);
    vec4 wp = m * vec4(aPos, 1.0);
    vPos = wp.xyz;
    mat3 nm = transpose(inverse(mat3(m)));
    vNM = nm;
    vNor = normalize(nm * aNor);
    vec3 sc = vec3(length(aM0.xyz), length(aM1.xyz), length(aM2.xyz));
    vLocal = aPos * sc; vLocalN = aNor; vHalf = sc * 0.5; vCol = aCol; vMat = aMat;
    // the face's own axes in the world, for the bumps (same pick as the fragment shader's uv)
    vec3 an = abs(aNor);
    vec3 lt = an.x > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 lb = an.y > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);
    vT = normalize(mat3(m) * lt); vB = normalize(mat3(m) * lb);
    gl_Position = uVP * wp;
  }`;
  // material: x = glow, y = kind, z = extra, w = gloss (0 dull .. 1 polished metal)
  //   y > 0   metal panels that many metres across (z: 1 = team stripe along the top, 2 = hazard stripes)
  //   y = 0   plain
  //   y = -1  stone blocks (field ruins, towers, cover)
  //   y = -2  rock (the boulders; bumps from 3D noise in the world, so they stay put)
  //   y = -3  cloth (flags)
  //   y = -4  fine armour plating (seams, no bolts)
  //   y = -5  bark (tree trunks and branches)
  // With textures loaded each kind also gets a material from the arrays (uMeshMats: metal, concrete, rock, bark),
  // mapped in the mesh's own space so it stays on things that move.
  const MESH_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform float uBox, uGlass, uMaskA;
  uniform ivec4 uMeshMats;
  in vec3 vPos; in vec3 vNor; in vec3 vLocal; in vec3 vLocalN; in vec3 vHalf; in vec4 vCol; in vec4 vMat; in vec3 vT; in vec3 vB; in mat3 vNM; out vec4 o;
  void main() {
    vec3 n = normalize(vNor);
    vec3 col = vCol.rgb;
    float glow = vMat.x;
    float gloss = clamp(vMat.w, 0.0, 1.0);
    float kind = vMat.y;
    vec3 an = abs(vLocalN);
    vec2 uv = an.x > 0.5 ? vLocal.zy : an.y > 0.5 ? vLocal.xz : vLocal.xy;
    float camD = length(vPos - uCam);
    float near = 1.0 - smoothstep(15.0, 110.0, camD);
    vec2 bump = vec2(0.0);
    float wall = 1.0 - an.y;
    if (kind > 0.0 || kind < -3.5) {
      // metal panels: seams every few metres on the face, picked by the face's own normal
      float ps = kind > 0.0 ? kind : 0.3;
      vec2 cell = floor(uv / ps + 0.5);
      col *= 0.94 + 0.12 * hash(cell + 0.37);
      vec2 fr = fract(uv / ps + 0.5) - 0.5;
      vec2 g = abs(fr) * ps;
      float gm = min(g.x, g.y);
      float sw = clamp(ps * 0.03, 0.008, 0.06);
      float seam = 1.0 - smoothstep(sw * 0.6, sw * 1.6, gm);
      col *= 1.0 - 0.35 * seam;
      // the plate's edge rounds down into the seam
      float bev = 1.0 - smoothstep(sw, clamp(ps * 0.06, 0.012, 0.1), gm);
      bump += (g.x < g.y ? vec2(-sign(fr.x), 0.0) : vec2(0.0, -sign(fr.y))) * bev * (kind > 0.0 ? 0.5 * min(1.0, ps) : 0.12);
      col *= 0.92 + 0.12 * noise(uv * 1.7);
      if (kind >= 0.5) {
        // bolts at the panel corners, standing proud
        vec2 bq = g - vec2(0.12);
        float bl = length(bq);
        float bolt = 1.0 - smoothstep(0.025, 0.05, bl);
        col *= 1.0 - 0.25 * bolt; gloss = max(gloss, bolt * 0.7);
        bump += (bq / max(bl, 0.001)) * bolt * (1.0 - smoothstep(0.0, 0.04, bl)) * 0.6 * sign(fr.x) * sign(fr.y) * vec2(sign(fr.x), sign(fr.y));
        // scratches
        float scr = smoothstep(0.76, 0.81, noise(vec2(uv.x * 5.0 + uv.y * 0.4, uv.y * 40.0))) * smoothstep(0.5, 0.7, noise(uv * 0.9 + 4.0)) * near;
        col = mix(col, col * 1.25 + 0.05, scr * 0.5); gloss = min(1.0, gloss + scr * 0.2);
      }
      // grime at the foot of walls, and streaks running down them
      if (an.y < 0.5) {
        float foot = 1.0 - smoothstep(0.0, 1.8, vLocal.y + vHalf.y);
        col *= 1.0 - 0.3 * foot * (0.6 + 0.4 * noise(uv * 3.0));
        float st = noise(vec2(uv.x * 5.0, uv.y * 0.25));
        col *= 1.0 - 0.14 * smoothstep(0.55, 0.8, st);
      }
      // a glowing stripe along the top of walls in team colour, or black and yellow hazard stripes
      if (vMat.z > 1.5) { float hz = fract((uv.x + uv.y) * 1.5); col = mix(col, mix(vec3(0.9, 0.7, 0.1), vec3(0.07, 0.07, 0.08), step(0.5, hz)) * (0.85 + 0.3 * noise(uv * 4.0)), 0.9 * wall); gloss = min(gloss, 0.35); }
      else if (vMat.z > 0.0) { float stripe = (1.0 - smoothstep(0.0, 0.08, abs(fract(vLocal.y / 3.0) - 0.82))) * wall; glow += stripe * vMat.z; }
    } else if (kind < -0.5 && kind > -1.5) {
      // stone blocks in courses, mortar between, chipped and cracked, the ground's colour creeping up the low parts
      vec2 bs = vec2(1.3, 0.62);
      vec2 bu = vec2(uv.x + mod(floor(uv.y / bs.y), 2.0) * 0.65, uv.y);
      vec2 bc = floor(bu / bs + 0.5);
      vec2 fr = fract(bu / bs + 0.5) - 0.5;
      vec2 g = abs(fr) * bs;
      float gm = min(g.x, g.y);
      float mortar = 1.0 - smoothstep(0.025, 0.06, gm + noise(uv * 9.0) * 0.03);
      col *= 0.86 + 0.28 * hash(bc + 3.1);
      col *= 1.0 - 0.32 * mortar;
      float bev = 1.0 - smoothstep(0.02, 0.09, gm);
      bump += (g.x < g.y ? vec2(-sign(fr.x), 0.0) : vec2(0.0, -sign(fr.y))) * bev * 0.6;
      // grain and cracks
      float grain = noise(uv * 7.0) * 0.6 + noise(uv * 23.0) * 0.4;
      col *= 0.88 + 0.24 * grain;
      bump += (vec2(noise(uv * 7.0 + vec2(0.07, 0.0)), noise(uv * 7.0 + vec2(0.0, 0.07))) - noise(uv * 7.0)) * 3.0 * near;
      // moss and dirt in the mortar, on the tops and low down
      float foot = 1.0 - smoothstep(0.0, 2.5, vLocal.y + vHalf.y);
      float moss = smoothstep(0.45, 0.7, noise(uv * 0.9 + 5.0)) * (0.5 * an.y + 0.5 * foot + 0.5 * mortar);
      col = mix(col, uGround * 0.85, clamp(moss, 0.0, 1.0) * 0.55);
      gloss = min(gloss, 0.15);
    } else if (kind < -1.5 && kind > -2.5) {
      // a boulder: craggy from 3D noise, banded, lichen on top
      vec3 p = vPos * 1.3;
      float e = 0.08;
      float n0 = noise3(p) * 0.6 + noise3(p * 2.9) * 0.4;
      vec3 gr = vec3(noise3(p + vec3(e, 0.0, 0.0)) * 0.6 + noise3((p + vec3(e, 0.0, 0.0)) * 2.9) * 0.4 - n0,
                     noise3(p + vec3(0.0, e, 0.0)) * 0.6 + noise3((p + vec3(0.0, e, 0.0)) * 2.9) * 0.4 - n0,
                     noise3(p + vec3(0.0, 0.0, e)) * 0.6 + noise3((p + vec3(0.0, 0.0, e)) * 2.9) * 0.4 - n0);
      n = normalize(n - gr * 9.0 * (0.4 + 0.6 * near));
      col *= 0.8 + 0.4 * n0;
      col *= 0.85 + 0.3 * noise(vec2(vPos.y * 2.2, vPos.x * 0.3 + vPos.z * 0.3));
      float lich = smoothstep(0.55, 0.72, noise3(vPos * 0.9 + 9.0)) * max(n.y, 0.0);
      col = mix(col, uGround * 0.9, lich * 0.6);
      gloss = min(gloss, 0.2);
    } else if (kind < -2.5 && kind > -3.5) {
      // cloth: a weave, folds that move, no shine
      vec2 cu = vec2(vPos.x + vPos.z, vPos.y);
      col *= 0.9 + 0.14 * noise(cu * 60.0);
      col *= 0.82 + 0.3 * noise(cu * vec2(2.5, 1.2) + vec2(uTime * 1.5, 0.0));
      gloss = 0.04;
    }
    if (dot(bump, bump) > 0.0) n = normalize(n + (vT * bump.x + vB * bump.y) * (0.3 + 0.7 * near));
    if (uTexOn > 0.5) {
      int tm = -1; float tsc = 1.0, tk = 0.85;
      if (kind > 0.5) tm = uMeshMats.x;
      else if (kind < -0.5 && kind > -1.5) tm = uMeshMats.y;
      else if (kind < -1.5 && kind > -2.5) { tm = uMeshMats.z; tsc = 0.6; }
      else if (kind < -3.5 && kind > -4.5) { tm = uMeshMats.x; tsc = 3.0; tk = 0.5; }
      else if (kind < -4.5 && kind > -5.5) { tm = uMeshMats.w; tsc = 1.5; tk = 1.0; }
      if (tm >= 0) {
        vec3 ln = normalize(vLocalN);
        vec4 A, Nr;
        matTri(tm, vLocal, ln, triW(ln), tsc, A, Nr);
        col *= mix(vec3(1.0), A.rgb, tk);
        // the texture's tilt, carried from the mesh's space into the world and added to what is already there
        vec3 tilt = normalize(vNM * Nr.xyz) - normalize(vNM * ln);
        n = normalize(n + tilt * (0.4 + 0.6 * near));
        gloss *= mix(1.0, 1.25 - Nr.w, tk);
      }
    }
    // worn edges on boxes: a thin bright chamfer where the paint has gone
    if (uBox > 0.5 && !(kind < -2.5 && kind > -3.5)) {
      vec3 ed = vHalf - abs(vLocal);
      float ew = clamp(min(vHalf.x, min(vHalf.y, vHalf.z)) * 0.12, 0.012, 0.05);
      float e = an.x > 0.5 ? min(ed.y, ed.z) : an.y > 0.5 ? min(ed.x, ed.z) : min(ed.x, ed.y);
      float edge = 1.0 - smoothstep(0.0, ew, e);
      if (kind < -0.5 && kind > -1.5) { edge *= smoothstep(0.3, 0.6, noise(uv * 5.0)); col = mix(col, col * 1.15, edge); }
      else { col = mix(col, col * 1.3 + 0.05, edge * 0.7); gloss = max(gloss, edge * 0.65); }
    }
    float sh = shadowAt(vPos, n) * groundShade(vPos) * cloudAt(vPos.xz);
    vec3 v = normalize(uCam - vPos);
    float ndl = max(dot(n, uSunDir), 0.0), ndv = max(dot(n, v), 0.001);
    vec3 hv = normalize(v + uSunDir);
    float ndh = max(dot(n, hv), 0.0), vdh = max(dot(v, hv), 0.0);
    float metal = smoothstep(0.7, 0.95, gloss);
    float rough = clamp(1.0 - gloss * 0.9, 0.08, 1.0);
    float a2 = rough * rough; a2 *= a2;
    vec3 F0 = mix(vec3(0.04), col, metal);
    float dd = ndh * ndh * (a2 - 1.0) + 1.0;
    float D = a2 / (PI * dd * dd);
    float k = (rough + 1.0) * (rough + 1.0) / 8.0;
    float G = (ndl / (ndl * (1.0 - k) + k)) * (ndv / (ndv * (1.0 - k) + k));
    // pow of a negative number is NaN on real graphics cards (dot products can land a hair over 1): clamp every base
    vec3 F = F0 + (1.0 - F0) * pow(clamp(1.0 - vdh, 0.0, 1.0), 5.0);
    vec3 spec = D * G * F / max(4.0 * ndl * ndv, 0.001) * ndl * sh * uSunCol;
    spec = min(spec, vec3(4.0));
    vec3 diff = col * (1.0 - metal * 0.7);
    vec3 amb = hemi(n);
    vec3 r = reflect(-v, n);
    vec3 skyR = mix(uSkyHor, uSkyTop, clamp(r.y, 0.0, 1.0)) * mix(0.5, 1.0, groundShade(vPos));
    vec3 Fa = F0 + (1.0 - F0) * pow(clamp(1.0 - ndv, 0.0, 1.0), 5.0) * (1.0 - rough);
    vec3 ambSpec = skyR * Fa * (0.3 + 0.7 * metal) * (0.6 + 0.4 * n.y);
    float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 3.0) * 0.3;
    vec3 lit = diff * (uSunCol * ndl * sh + amb + pointLights(vPos, n)) + spec + ambSpec + amb * rim + col * glow;
    lit = fogMix(lit, vPos);
    o = vec4(outc(lit), uMaskA > 0.0 ? uMaskA : vCol.a * uGlass);
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
  uniform mat4 uInvVP; uniform float uStars;
  in vec2 vP; out vec4 o;
  float cloud(vec2 p) { return fbm(p * 1.3) * 0.65 + fbm(p * 4.0) * 0.35; }
  void main() {
    vec4 a = uInvVP * vec4(vP, 1.0, 1.0);
    vec3 d = normalize(a.xyz / a.w - uCam);
    float up = max(d.y, 0.0);
    float s = dot(d, uSunDir), sp = max(s, 0.0);
    // the sky: deep overhead, pale at the horizon, warmer around the sun
    vec3 c = mix(uSkyHor, uSkyTop, pow(up, 0.5));
    c = mix(c, mix(uSkyHor, uSunCol, 0.5), pow(sp, 3.0) * 0.25 * (1.0 - up));
    // stars, for dark skies
    if (uStars > 0.0 && d.y > 0.0) {
      vec2 sq = d.xz / (d.y + 0.35) * 90.0;
      float st = hash(floor(sq));
      vec2 fq = fract(sq) - 0.5;
      float tw = 0.7 + 0.3 * sin(uTime * 3.0 + st * 40.0);
      c += vec3(0.9, 0.95, 1.0) * smoothstep(0.985, 1.0, st) * (1.0 - smoothstep(0.0, 0.3, length(fq))) * tw * uStars * smoothstep(0.0, 0.3, d.y);
    }
    // the sun: a disc with a halo and a long soft glow
    c += uSunCol * (smoothstep(0.99935, 0.99975, s) * 30.0 + pow(sp, 900.0) * 6.0 + pow(sp, 40.0) * 0.5 + pow(sp, 6.0) * 0.18);
    // clouds on a high plane, lit from the sun's side, and thin cirrus above them
    if (d.y > 0.01) {
      vec2 p = d.xz / d.y * 0.6 + vec2(uTime * 0.004, uTime * 0.002);
      float cl = cloud(p);
      float lo = 1.0 - uClouds * 0.75, hi = 1.05 - uClouds * 0.3;
      float cov = smoothstep(lo, hi, cl);
      // density a little toward the sun: thinner there means a lit edge
      vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.05;
      float cl2 = smoothstep(lo, hi, cloud(p + toSun));
      float edge = clamp((cov - cl2) * 2.5, -1.0, 1.0);
      float fade = smoothstep(0.01, 0.2, d.y);
      vec3 shade = mix(uFogCol * 0.85, uSkyTop, 0.3) * 0.9;
      vec3 lit = mix(vec3(1.0), uSunCol, 0.5) * (0.95 + 0.5 * pow(sp, 4.0));
      vec3 cc = mix(shade, lit, 0.45 + 0.55 * edge);
      // thick parts darker underneath
      cc *= 1.0 - 0.35 * smoothstep(0.3, 1.0, cov) * (1.0 - 0.5 * edge);
      c = mix(c, cc, cov * fade * 0.92);
      vec2 q = d.xz / d.y * 0.25 + vec2(uTime * 0.0015, 0.0);
      float cirrus = smoothstep(0.55, 0.8, fbm(vec2(q.x * 0.8, q.y * 3.0) + 3.1)) * 0.35 * (1.0 - cov);
      c = mix(c, lit * 0.95, cirrus * fade * (0.3 + 0.7 * uClouds));
    }
    // the horizon melts into the fog
    c = mix(uFogCol, c, smoothstep(-0.05, 0.12, d.y));
    o = vec4(outc(c), 1.0);
  }`;

  // water: one big flat sheet at the water level, rippled with noise, reflecting the sky; it reads the ground height
  // under it from the heightfield so the shallows go clear and the shore gets foam
  const WATER_VS = `#version 300 es
  layout(location=0) in vec2 aP; uniform mat4 uVP; uniform float uH; out vec3 vPos;
  void main() { vPos = vec3(aP.x, uH, aP.y); gl_Position = uVP * vec4(vPos, 1.0); }`;
  const WATER_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform vec3 uWater; in vec3 vPos; out vec4 o;
  void main() {
    float camD = length(vPos - uCam);
    vec2 p = vPos.xz * 0.08;
    float e = 0.15;
    vec2 t1 = vec2(uTime * 0.15, uTime * 0.1), t2 = vec2(-uTime * 0.07, uTime * 0.12);
    float h0 = fbm(p + t1) + 0.5 * fbm(p * 2.3 + t2);
    float hx = fbm(p + vec2(e, 0.0) + t1) + 0.5 * fbm((p + vec2(e, 0.0)) * 2.3 + t2);
    float hz = fbm(p + vec2(0.0, e) + t1) + 0.5 * fbm((p + vec2(0.0, e)) * 2.3 + t2);
    float ripple = mix(1.4, 0.3, smoothstep(40.0, 400.0, camD));
    vec3 n = normalize(vec3((h0 - hx) * ripple, 1.0, (h0 - hz) * ripple));
    vec3 v = normalize(uCam - vPos);
    vec3 r = reflect(-v, n);
    float depth = max(vPos.y - hfAt(vPos.xz).x, 0.0);
    vec3 sky = mix(uSkyHor, uSkyTop, pow(max(r.y, 0.0), 0.6));
    float fres = 0.04 + 0.96 * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 5.0);
    vec3 shallow = mix(uWater, uGround, 0.35) * 1.4, deep = uWater * 0.7;
    vec3 body = mix(shallow, deep, smoothstep(0.0, 9.0, depth)) * (hemi(vec3(0.0, 1.0, 0.0)) + uSunCol * 0.5 * groundShade(vPos));
    vec3 c = mix(body, sky, fres);
    // the sun on the ripples
    vec3 hv = normalize(v + uSunDir);
    c += uSunCol * pow(max(dot(n, hv), 0.0), 180.0) * 3.0 * groundShade(vPos);
    c += uSunCol * pow(max(dot(r, uSunDir), 0.0), 24.0) * 0.15;
    // foam at the shore, drifting
    float foamN = noise(vPos.xz * 1.4 + vec2(uTime * 0.3, 0.0)) * 0.6 + noise(vPos.xz * 4.0 - vec2(0.0, uTime * 0.5)) * 0.4;
    float foam = (1.0 - smoothstep(0.0, 1.4, depth)) * smoothstep(0.35, 0.7, foamN + 0.25 * sin(uTime * 1.5 + depth * 4.0));
    c = mix(c, vec3(0.95) * (uAmb + uSunCol * 0.6), foam * 0.8);
    c = fogMix(c, vPos);
    float alpha = clamp(0.25 + depth * 0.35, 0.0, 0.93);
    alpha = mix(alpha, 0.95, foam * 0.8);
    o = vec4(outc(c), max(alpha, fres * 0.9));
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
    if (vK.x < 0.5) { a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2); }
    else if (vK.x < 1.5) {
      float n = noise(vQ * 2.5 + vK.z * 7.0) * 0.6 + noise(vQ * 5.0 - vK.z * 3.0) * 0.4;
      a = 1.0 - smoothstep(0.3, 1.0, d + (n - 0.5) * 0.6);
      // a puffy sphere lit from the sun's side
      vec3 pn = normalize(vec3(vQ, sqrt(max(0.0, 1.0 - d * d)) + 0.4));
      vec3 ls = normalize(vec3(0.4, 0.8, 0.6));
      float lit = 0.55 + 0.45 * clamp(dot(pn, ls), 0.0, 1.0);
      float sh = groundShade(vPos);
      c *= lit * (hemi(vec3(0.0, 1.0, 0.0)) + uSunCol * 0.75 * sh) + c * 0.1 * pointLights(vPos, vec3(0.0, 1.0, 0.0));
      c = fogMix(c, vPos);
    } else { a = 1.0 - smoothstep(0.0, 1.0, d); }
    // glows add up: in HDR a soft knee keeps a burst next to the camera from washing the whole screen out
    if (uHDR > 0.5 && vK.w < 0.5) c = c / (1.0 + 0.3 * lum(c));
    o = vec4(outc(c) * a * vCol.a, a * vCol.a * vK.w);
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
    vec3 cr = cross(dir, uCam - p);
    vec3 side = dot(cr, cr) > 1e-10 ? normalize(cr) : normalize(cross(dir, abs(dir.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    float w = mix(aA.w, aB.w, aQ.x);
    p += side * aQ.y * w;
    vQ = aQ; vCol = aCol;
    gl_Position = uVP * vec4(p, 1.0);
  }`;
  const BEAM_FS = `#version 300 es
  precision highp float;
  in vec2 vQ; in vec4 vCol; out vec4 o;
  void main() { float a = pow(clamp(1.0 - abs(vQ.y), 0.0, 1.0), 1.6) * vCol.a; o = vec4(vCol.rgb * a, 0.0); }`;

  // grass: tufts on a grid that follows the camera. Each instance is one grid cell; the vertex shader decides where the
  // tuft stands (jittered by a hash of the cell), reads the ground from the heightfield, and hides it on rock, snow,
  // water or lava. Two crossed quads per tuft, swaying; the blades are cut out in the fragment shader.
  const GRASS_VS = `#version 300 es
  layout(location=0) in vec2 aCell;
  uniform mat4 uVP; uniform vec3 uCam; uniform float uTime, uCell, uRadius, uDensity, uSnowLine, uHmin, uHmax, uLowH;
  uniform sampler2D uHF;
  out vec2 vUv; out vec3 vPos; out vec3 vN; out float vSeed;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  void main() {
    vec2 origin = floor(uCam.xz / uCell) * uCell;
    vec2 cxz = origin + aCell * uCell;
    float h1 = hash(cxz * 0.37), h2 = hash(cxz * 0.37 + 7.1), h3 = hash(cxz * 0.37 + 3.3);
    vec2 xz = cxz + (vec2(h1, h2) - 0.5) * uCell;
    vec2 uv = (xz / ${CELL}.0 + 0.5) / ${N + 1}.0;
    float tx = 0.5 / ${N + 1}.0;
    vec3 hf = texture(uHF, uv).xyz;
    float h = hf.x;
    float hx = texture(uHF, uv + vec2(tx, 0.0)).x, hz = texture(uHF, uv + vec2(0.0, tx)).x;
    vec3 n = normalize(vec3((h - hx) / 4.0, 1.0, (h - hz) / 4.0));
    float hh = clamp((h - uHmin) / (uHmax - uHmin), 0.0, 1.0);
    float d = length(xz - uCam.xz);
    float fade = 1.0 - smoothstep(uRadius * 0.6, uRadius, d);
    float show = step(h3, uDensity) * step(1.0 - n.y, 0.32) * step(hh, uSnowLine - 0.08) * step(uLowH + 0.6, h) * step(0.001, fade) * step(hf.z, 0.25);
    int vid = gl_VertexID;
    int q = vid / 6, c = vid - q * 6;
    float cx = (c == 1 || c == 2 || c == 4) ? 1.0 : 0.0;
    float cy = (c == 2 || c == 4 || c == 5) ? 1.0 : 0.0;
    float ang = h1 * 6.283 + float(q) * 1.5708;
    vec2 dir = vec2(cos(ang), sin(ang));
    float w = 0.6 + h2 * 0.5;
    float ht = (0.4 + h3 * 0.5) * mix(0.5, 1.0, fade);
    vec3 p = vec3(xz.x, h - 0.12, xz.y) + vec3(dir.x, 0.0, dir.y) * (cx - 0.5) * w;
    float sway = sin(uTime * 1.7 + xz.x * 0.35 + xz.y * 0.2) * 0.12 + sin(uTime * 3.1 + xz.y * 0.9 + h1 * 3.0) * 0.05;
    p += vec3(sway * cy, ht * cy, sway * 0.5 * cy);
    vUv = vec2(cx * 2.0 - 1.0, cy); vPos = p; vN = n; vSeed = h1;
    gl_Position = show > 0.5 ? uVP * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  }`;
  const GRASS_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform vec3 uGrassCol, uGrassCol2;
  in vec2 vUv; in vec3 vPos; in vec3 vN; in float vSeed; out vec4 o;
  void main() {
    // three blades across the quad, each leaning its own way, tapering to the tip
    float lean = (fract(vSeed * 17.0) - 0.5) * vUv.y * vUv.y * 0.9;
    float bx = fract(vUv.x * 1.5 + vSeed * 3.0 + lean) * 2.0 - 1.0;
    float taper = (1.0 - vUv.y * 0.88) * 0.42;
    if (abs(bx) > taper) discard;
    vec3 col = mix(uGrassCol, uGrassCol2, fract(vSeed * 5.3)) * (0.5 + 0.55 * vUv.y);
    col *= 0.85 + 0.3 * noise(vPos.xz * 0.3);
    float sh = shadowAt(vPos, vN) * groundShade(vPos) * cloudAt(vPos.xz);
    float sun = (0.5 + 0.5 * max(dot(vN, uSunDir), 0.0)) * sh;
    vec3 lit = col * (uSunCol * sun * 1.1 + hemi(vN) * (0.6 + 0.4 * vUv.y) + pointLights(vPos, vN));
    lit = fogMix(lit, vPos);
    o = vec4(outc(lit), 0.0);
  }`;

  // ---------- post passes (mid and high quality) ----------
  const POST_VS = `#version 300 es
  layout(location=0) in vec2 aP; out vec2 vUv;
  void main() { vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;
  const POST_COMMON = `
  precision highp float;
  uniform sampler2D uTex; uniform vec2 uTexel;
  in vec2 vUv; out vec4 o;
  float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y); }
  // one bad pixel (NaN or infinity) must stay one pixel: the bloom's blurs would grow it into a black square
  vec3 clean(vec3 c) { return any(isnan(c)) || any(isinf(c)) ? vec3(0.0) : c; }
  vec3 box4(sampler2D t, vec2 uv, vec2 px) {
    return (clean(texture(t, uv + px * vec2(-1.0, -1.0)).rgb) + clean(texture(t, uv + px * vec2(1.0, -1.0)).rgb) + clean(texture(t, uv + px * vec2(-1.0, 1.0)).rgb) + clean(texture(t, uv + px * vec2(1.0, 1.0)).rgb)) * 0.25;
  }`;
  // what is bright enough to bloom, taken down to half size
  const BRIGHT_FS = `#version 300 es
  ${POST_COMMON}
  uniform float uThresh;
  void main() {
    vec3 c = box4(uTex, vUv, uTexel * 0.5);
    float l = lum(c);
    float w = smoothstep(uThresh - 0.25, uThresh + 0.6, l);
    o = vec4(c * w, 1.0);
  }`;
  const DOWN_FS = `#version 300 es
  ${POST_COMMON}
  void main() { o = vec4(box4(uTex, vUv, uTexel * 0.5), 1.0); }`;
  const BLUR_FS = `#version 300 es
  ${POST_COMMON}
  uniform vec2 uDir;
  void main() {
    vec3 c = texture(uTex, vUv).rgb * 0.227;
    vec2 d = uDir * uTexel;
    c += (texture(uTex, vUv + d * 1.385).rgb + texture(uTex, vUv - d * 1.385).rgb) * 0.316;
    c += (texture(uTex, vUv + d * 3.231).rgb + texture(uTex, vUv - d * 3.231).rgb) * 0.070;
    o = vec4(c, 1.0);
  }`;
  // light shafts: what is sky near the sun, then smeared away from it
  const RAYMASK_FS = `#version 300 es
  ${POST_COMMON}
  uniform vec2 uSun; uniform float uAspect; uniform vec3 uSunCol;
  void main() {
    vec4 s = texture(uTex, vUv);
    s.rgb = clean(s.rgb);
    float sky = smoothstep(0.6, 0.95, s.a);
    float d = length((vUv - uSun) * vec2(uAspect, 1.0));
    float w = exp(-d * d * 5.0);
    float l = min(lum(s.rgb), 8.0);
    o = vec4(uSunCol * sky * w * (0.1 + l * 0.12), 1.0);
  }`;
  const RAYS_FS = `#version 300 es
  ${POST_COMMON}
  uniform vec2 uSun;
  void main() {
    vec2 uv = vUv;
    vec2 step = (uSun - uv) * (1.0 / 28.0) * 0.95;
    float j = hash(gl_FragCoord.xy) * 0.9;
    uv += step * j;
    vec3 c = vec3(0.0); float w = 1.0, tw = 0.0;
    for (int i = 0; i < 28; i++) { c += texture(uTex, uv).rgb * w; tw += w; uv += step; w *= 0.93; }
    o = vec4(c / tw, 1.0);
  }`;
  // the finish: haze, chromatic fringe, bloom, shafts, exposure, filmic curve, grade, hurt, vignette, grain
  const FINAL_FS = `#version 300 es
  ${POST_COMMON}
  uniform sampler2D uBloom0, uBloom1, uBloom2, uRays, uAO, uFog;
  uniform float uAOK, uFogK;
  uniform float uBloomK, uRayK, uExposure, uSat, uContrast, uGamma, uVig, uGrain, uTime, uHurt, uHeat, uCA, uHDR, uFlash;
  uniform vec3 uLift, uGain;
  vec3 tone(vec3 c) { c = max(c, 0.0); return c * (2.51 * c + 0.03) / (c * (2.43 * c + 0.59) + 0.14); }
  float heat(vec2 uv) { float a = texture(uTex, uv).a; return a < 0.6 ? a : 0.0; }
  void main() {
    vec2 uv = vUv;
    vec2 cv = uv - 0.5;
    // heat haze rises off the lava: the mask is on the lava, so look a little below each pixel
    if (uHeat > 0.0) {
      float m = max(max(heat(uv), heat(uv + vec2(0.0, -0.03)) * 0.9), max(heat(uv + vec2(0.0, -0.07)) * 0.7, heat(uv + vec2(0.0, -0.12)) * 0.45));
      if (m > 0.0) {
        vec2 q = uv * vec2(40.0, 24.0) + vec2(0.0, -uTime * 2.5);
        uv += (vec2(noise(q), noise(q + 17.0)) - 0.5) * m * uHeat * 0.02;
      }
    }
    // colour fringe toward the edges, like a lens
    float rd = dot(cv, cv) * uCA;
    vec3 c;
    c.r = texture(uTex, uv + cv * rd).r;
    c.g = texture(uTex, uv).g;
    c.b = texture(uTex, uv - cv * rd).b;
    c = clean(c);
    // occlusion on everything solid, fog over everything but the weapon (alpha marks the sky and the weapon)
    float mask = texture(uTex, uv).a;
    if (!(mask > 0.7 && mask < 0.8)) {
      float ao = texture(uAO, uv).r;
      if (mask < 0.9 && !isnan(ao)) c *= mix(1.0, ao, uAOK);
      vec4 fg = texture(uFog, uv);
      if (any(isnan(fg)) || any(isinf(fg))) fg = vec4(0.0, 0.0, 0.0, 1.0);
      c = c * mix(1.0, fg.a, uFogK) + fg.rgb * uFogK;
    }
    vec3 bl = texture(uBloom0, uv).rgb * 0.45 + texture(uBloom1, uv).rgb * 0.35 + texture(uBloom2, uv).rgb * 0.3;
    c += bl * uBloomK;
    c += texture(uRays, uv).rgb * uRayK;
    c *= uExposure;
    if (uHDR > 0.5) c = tone(c);
    // grade
    float l = lum(c);
    c = mix(vec3(l), c, uSat);
    c = (c - 0.5) * uContrast + 0.5;
    c = pow(max(c, 0.0), vec3(uGamma)) * uGain + uLift;
    // taking damage: red at the edges, colour drains
    if (uHurt > 0.0) {
      float ring = smoothstep(0.55, 1.35, length(cv) * 2.0);
      c = mix(c, vec3(l), uHurt * 0.25);
      c = mix(c, vec3(0.75, 0.05, 0.02) + c * 0.3, uHurt * ring);
    }
    c = mix(c, vec3(1.0), uFlash);
    c *= 1.0 - uVig * smoothstep(0.35, 1.45, length(cv) * 2.0);
    c += (hash(gl_FragCoord.xy + fract(uTime * 7.0) * 100.0) - 0.5) * uGrain * (1.0 - l * 0.6);
    o = vec4(c, 1.0);
  }`;
  // FXAA, the compact version: softens edges by their luma contrast
  const FXAA_FS = `#version 300 es
  ${POST_COMMON}
  void main() {
    vec2 px = uTexel;
    vec3 rgbNW = texture(uTex, vUv + vec2(-1.0, -1.0) * px).rgb;
    vec3 rgbNE = texture(uTex, vUv + vec2(1.0, -1.0) * px).rgb;
    vec3 rgbSW = texture(uTex, vUv + vec2(-1.0, 1.0) * px).rgb;
    vec3 rgbSE = texture(uTex, vUv + vec2(1.0, 1.0) * px).rgb;
    vec3 rgbM = texture(uTex, vUv).rgb;
    float lNW = lum(rgbNW), lNE = lum(rgbNE), lSW = lum(rgbSW), lSE = lum(rgbSE), lM = lum(rgbM);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2(8.0), max(vec2(-8.0), dir * rcp)) * px;
    vec3 rgbA = 0.5 * (texture(uTex, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture(uTex, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture(uTex, vUv + dir * -0.5).rgb + texture(uTex, vUv + dir * 0.5).rgb);
    float lB = lum(rgbB);
    o = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
  }`;

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

  // a float as the 16 bits of a half float (no rounding; plenty for heights and shade)
  const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
  function half(v) {
    f32[0] = v; const x = u32[0];
    const s = (x >> 16) & 0x8000, e = ((x >> 23) & 0xff) - 112; let m = x & 0x7fffff;
    if (e <= 0) { if (e < -10) return s; m |= 0x800000; return s | (m >> (14 - e)); }
    if (e >= 31) return s | 0x7c00;
    return s | (e << 10) | (m >> 13);
  }

  const INST_FLOATS = 24; // mat4 + colour + material
  const SHADOW_SIZE = 2048;
  // what each quality level turns on
  const QUALITY = {
    low:  { scale: 0.6,  post: false, msaa: 0, shadows: false, near: false, rays: false, grain: 0,     ca: 0,   heat: 0, grass: 0,  tex: false, veg: 0.3, ao: false, fog: false },
    mid:  { scale: 0.85, post: true,  msaa: 0, shadows: true,  near: false, rays: true,  grain: 0.02,  ca: 0.6, heat: 1, grass: 30, tex: true,  veg: 0.7, ao: true,  fog: true },
    high: { scale: 1,    post: true,  msaa: 4, shadows: true,  near: true,  rays: true,  grain: 0.028, ca: 1.0, heat: 1, grass: 48, tex: true,  veg: 1,   ao: true,  fog: true },
  };
  // the grade every map starts from; a map's look can override any of these
  const GRADE = { exposure: 1.0, sat: 1.08, contrast: 1.06, gamma: 1.0, lift: [0, 0, 0], gain: [1, 1, 1], vignette: 0.32, bloom: 1.0, rays: 1.0, stars: 0, wet: 0 };
  const GRASS_CELL = 1.1, GRASS_MAX = 48;
  // which baked material each map layer uses when a map's look does not say (see tools/jetfall-textures.py)
  const DEFAULT_LAYERS = ['grass', 'dirt', 'rock', 'snow'];
  const MESH_MATS = ['metal', 'concrete', 'rock', 'bark'];
  const ROCK_SHAPES = 4;

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = canvas.getContext('webgl2', { antialias: true, powerPreference: 'high-performance', alpha: false });
      if (!gl) throw new Error('This browser has no WebGL2.');
      this.gl = gl;
      // rendering to half-float targets needs this; without it the post pass runs in 8 bits (still fine, less glow)
      this.floatOk = !!gl.getExtension('EXT_color_buffer_float');
      this.q = QUALITY.mid;
      this.scale = this.q.scale;
      this.shadowsOn = this.q.shadows;
      this.lost = false;
      this.fbW = 0; this.fbH = 0;
      canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
      canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this.fbW = this.fbH = 0; this.texLoading = null; this.init(); if (this.mapKey) this.setMap(this.world); this.loadTextures(); });
      this.texBase = 'tex/';
      this.init();
    }

    // ---------- surface textures ----------
    // tex/manifest.json lists the baked materials; each is an albedo, a normal (+ roughness) and a height JPEG. They go
    // into two texture arrays: albedo with the height in alpha, and normal + roughness. Until they arrive (or if they
    // never do) the shaders draw the untextured look.
    // Fast only fetches the foliage cards (small); the ground and building materials come when a setting uses them.
    loadTextures() {
      if (typeof Image === 'undefined' || typeof fetch === 'undefined') return;
      const wantMats = !!this.q.tex;
      const have = this.tex ? (this.tex.A ? 2 : 1) : 0, want = wantMats ? 2 : 1;
      if (have >= want || (this.texLoading && this.texLoading >= want)) return;
      this.texLoading = want;
      const gl = this.gl, base = this.texBase, gen = (this.texGen = (this.texGen || 0) + 1);
      const load = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('could not load ' + src)); im.src = src; });
      fetch(base + 'manifest.json').then(r => r.json()).then(async man => {
        const list = wantMats ? man.materials : [], S = man.size;
        const imgs = await Promise.all(list.map(m => Promise.all(['_a', '_n', '_h'].map(k => load(base + m.name + k + '.jpg')))));
        const cards = await Promise.all((man.cards || []).map(c => load(base + c + '.png')));
        if (this.lost || gen !== this.texGen) return;
        this.texLoading = null;
        const cv = document.createElement('canvas'); cv.width = cv.height = S;
        const cx = cv.getContext('2d', { willReadFrequently: true });
        const px = im => { cx.clearRect(0, 0, S, S); cx.drawImage(im, 0, 0, S, S); return cx.getImageData(0, 0, S, S).data; };
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        const texA = list.length ? this.makeArray(S, list.length) : null, texN = list.length ? this.makeArray(S, list.length) : null;
        const buf = new Uint8Array(S * S * 4);
        list.forEach((m, i) => {
          const a = px(imgs[i][0]), h = px(imgs[i][2]);
          for (let k = 0; k < S * S; k++) { buf[k * 4] = a[k * 4]; buf[k * 4 + 1] = a[k * 4 + 1]; buf[k * 4 + 2] = a[k * 4 + 2]; buf[k * 4 + 3] = h[k * 4]; }
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, texA);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, texN);
          gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, imgs[i][1]);
        });
        for (const t of [texA, texN]) if (t) { gl.bindTexture(gl.TEXTURE_2D_ARRAY, t); gl.generateMipmap(gl.TEXTURE_2D_ARRAY); }
        let texC = null;
        if (cards.length) {
          const CS = cards[0].width;
          texC = this.makeArray(CS, cards.length);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, texC);
          cards.forEach((im, i) => gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, CS, CS, 1, gl.RGBA, gl.UNSIGNED_BYTE, im));
          gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
        }
        const info = new Float32Array(16 * 4), index = {};
        list.forEach((m, i) => { index[m.name] = i; info.set([1 / m.scale, 1 / m.mean[0], 1 / m.mean[1], 1 / m.mean[2]], i * 4); });
        const cardIndex = {}; (man.cards || []).forEach((c, i) => { cardIndex[c] = i; });
        if (this.tex) for (const t of [this.tex.A, this.tex.N, this.tex.C]) if (t) gl.deleteTexture(t);
        this.tex = { A: texA, N: texN, C: texC, info, index, cardIndex };
      }).catch(e => { this.texLoading = null; console.warn('Jetfall textures:', e.message || e); });
    }
    makeArray(S, layers) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(S)) + 1, gl.RGBA8, S, S, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
      const an = gl.getExtension('EXT_texture_filter_anisotropic');
      if (an) gl.texParameterf(gl.TEXTURE_2D_ARRAY, an.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(an.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      return t;
    }
    // material indices for a list of names (an unknown name falls back to the first material)
    matIdx(names) { const ix = this.tex.index; return names.map(n => (ix[n] != null ? ix[n] : 0)); }
    // 'low' | 'mid' | 'high'
    setQuality(name) {
      this.q = QUALITY[name] || QUALITY.mid;
      this.scale = this.q.scale;
      this.shadowsOn = this.q.shadows;
      this.fbW = this.fbH = 0; // targets are remade on the next frame
      this.loadTextures();
      if (this.world && this.buildVeg && (!this.vegFor || this.vegFor.q !== this.q.veg)) this.buildVeg(this.world);
    }
    get post() { return this.q.post; }
    init() {
      const gl = this.gl;
      this.progT = compile(gl, TERRAIN_VS, TERRAIN_FS);
      this.progM = compile(gl, MESH_VS, MESH_FS);
      this.progS = compile(gl, SHADOW_VS, SHADOW_FS);
      this.progSky = compile(gl, SKY_VS, SKY_FS);
      this.progP = compile(gl, PART_VS, PART_FS);
      this.progB = compile(gl, BEAM_VS, BEAM_FS);
      this.progW = compile(gl, WATER_VS, WATER_FS);
      this.progG = compile(gl, GRASS_VS, GRASS_FS);
      this.progBright = compile(gl, POST_VS, BRIGHT_FS);
      this.progDown = compile(gl, POST_VS, DOWN_FS);
      this.progBlur = compile(gl, POST_VS, BLUR_FS);
      this.progRayMask = compile(gl, POST_VS, RAYMASK_FS);
      this.progRays = compile(gl, POST_VS, RAYS_FS);
      this.progFinal = compile(gl, POST_VS, FINAL_FS);
      this.progFxaa = compile(gl, POST_VS, FXAA_FS);
      this.waterVao = gl.createVertexArray(); gl.bindVertexArray(this.waterVao);
      const wb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, wb);
      const L = -3000, Hh = SIZE + 3000;
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([L, L, L, Hh, Hh, Hh, L, L, Hh, Hh, Hh, L]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      // meshes
      this.meshes = {};
      for (const [k, g] of Object.entries({ box: boxGeo(), sphere: sphereGeo(10), cyl: cylGeo(18) })) this.meshes[k] = this.makeMesh(g);
      // boulders: four shapes made in code (vegetation.js)
      if (root.JFVeg) for (let i = 0; i < ROCK_SHAPES; i++) this.meshes['rock' + i] = this.makeMesh(root.JFVeg.rock(11 + i * 7));
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
      // grass cells around the camera, nearest first, so a smaller radius is just a shorter draw
      const R = Math.ceil(GRASS_MAX / GRASS_CELL), cells = [];
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const d = Math.sqrt(i * i + j * j) * GRASS_CELL; if (d <= GRASS_MAX) cells.push({ i, j, d }); }
      cells.sort((a, b) => a.d - b.d);
      this.grassCells = cells.map(c => c.d);
      const cd = new Float32Array(cells.length * 2);
      cells.forEach((c, k) => { cd[k * 2] = c.i; cd[k * 2 + 1] = c.j; });
      this.grassVao = gl.createVertexArray(); gl.bindVertexArray(this.grassVao);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, cd, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 1);
      gl.bindVertexArray(null);
      // two shadow maps: near (sharp, around the player) and far (the bunkers and the land around)
      this.shadow = [this.makeShadowMap(), this.makeShadowMap()];
      // the heightfield texture (filled by setMap)
      this.hfTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.hfTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, new Uint16Array([0, half(1), 0, 0]));
      this.dummyArr = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.dummyArr);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([128, 128, 255, 255]));
      this.tex = null;
      this.terrain = null;
      this.targets = null;
      if (this.vegInit && root.JFVeg) this.vegInit();
      if (this.atmosInit) this.atmosInit();
      // 1 x 1 stand-ins for the final pass when occlusion or fog are off
      const one = (r, g, b, a) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([r, g, b, a])); return t; };
      this.whiteTex = one(255, 255, 255, 255); this.noFogTex = one(0, 0, 0, 255);
    }
    makeShadowMap() {
      const gl = this.gl;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, mat: null };
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

    // ---------- render targets for the post pass ----------
    tex2d(w, h, fmt) {
      const gl = this.gl, t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    }
    target(w, h, fmt, depth) {
      const gl = this.gl;
      const tex = this.tex2d(w, h, fmt);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      let rb = null;
      if (depth) {
        rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
      }
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, rb, w, h, ok };
    }
    dropTargets() {
      const gl = this.gl, T = this.targets;
      if (!T) return;
      for (const t of T.all) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); }
      if (T.ms) { gl.deleteFramebuffer(T.ms.fb); gl.deleteRenderbuffer(T.ms.color); gl.deleteRenderbuffer(T.ms.depth); }
      this.targets = null;
    }
    makeTargets(W, H) {
      const gl = this.gl;
      this.dropTargets();
      this.hdr = this.floatOk;
      let T = this.buildTargets(W, H);
      if (!T) { this.hdr = false; T = this.buildTargets(W, H); }
      this.targets = T;
      this.fbW = W; this.fbH = H;
    }
    buildTargets(W, H) {
      const gl = this.gl;
      const fmt = this.hdr ? gl.RGBA16F : gl.RGBA8;
      const all = [];
      const scene = this.target(W, H, fmt, this.q.msaa === 0); all.push(scene);
      if (!scene.ok) { this.dropList(all); return null; }
      let ms = null;
      if (this.q.msaa > 0) {
        const can = gl.getInternalformatParameter(gl.RENDERBUFFER, fmt, gl.SAMPLES);
        const samples = can && can.length ? Math.min(this.q.msaa, can[0]) : 0;
        if (samples > 0) {
          const color = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, color);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, fmt, W, H);
          const depth = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
          gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, W, H);
          const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
          const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          if (ok) ms = { fb, color, depth, samples };
          else { gl.deleteFramebuffer(fb); gl.deleteRenderbuffer(color); gl.deleteRenderbuffer(depth); }
        }
        if (!ms) {
          // no multisampling here: draw straight into the texture, with a depth buffer of its own
          const rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
          gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
          gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
          gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          scene.rb = rb;
        }
      }
      // bloom: three sizes, each with a pair for the blur
      const bloom = [];
      for (let i = 0; i < 3; i++) {
        const w = Math.max(1, W >> (i + 1)), h = Math.max(1, H >> (i + 1));
        const a = this.target(w, h, fmt, false), b = this.target(w, h, fmt, false);
        all.push(a, b);
        if (!a.ok || !b.ok) { this.dropList(all); return null; }
        bloom.push({ a, b, w, h });
      }
      const rw = Math.max(1, W >> 2), rh = Math.max(1, H >> 2);
      const rayMask = this.target(rw, rh, fmt, false), rays = this.target(rw, rh, fmt, false);
      all.push(rayMask, rays);
      // the finished picture before FXAA (mid quality only)
      let ldr = null;
      if (!ms) { ldr = this.target(W, H, gl.RGBA8, false); all.push(ldr); }
      if (!rayMask.ok || !rays.ok || (ldr && !ldr.ok)) { this.dropList(all); return null; }
      const T = { scene, ms, bloom, rayMask, rays, ldr, all, W, H, atm: null };
      if (this.atmosTargets) this.atmosTargets(T, W, H);
      return T;
    }
    dropList(list) { const gl = this.gl; for (const t of list) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); if (t.rb) gl.deleteRenderbuffer(t.rb); } }

    // ---------- the map ----------
    setMap(world) {
      this.world = world;
      this.mapKey = world.mapKey;
      this.look = world.def.look;
      this.grade = Object.assign({}, GRADE, this.look.grade || {});
      const gl = this.gl, t = world.terrain;
      const look = this.look;
      const sun = norm(look.sun);
      this.sun = sun;
      const V = N + 1;
      // vertices: position, normal, baked sun visibility (hills shading each other) and a bit of hollow darkening
      const data = new Float32Array(V * V * 7);
      const hf = new Uint16Array(V * V * 4);
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
        const ho = (iz * V + ix) * 4;
        hf[ho] = half(h); hf[ho + 1] = half(vis);
      }
      // ground with something built on it (bunker floors, decks, ruins) grows no grass
      const one = half(1);
      for (const sld of world.solids) {
        const b = sld.b;
        for (let iz = Math.max(0, Math.floor(b[2] / CELL)); iz <= Math.min(N, Math.ceil(b[5] / CELL)); iz++) {
          for (let ix = Math.max(0, Math.floor(b[0] / CELL)); ix <= Math.min(N, Math.ceil(b[3] / CELL)); ix++) {
            const h = t.at(ix, iz);
            if (b[1] < h + 2.5 && b[4] > h - 1) hf[(iz * V + ix) * 4 + 2] = one;
          }
        }
      }
      gl.bindTexture(gl.TEXTURE_2D, this.hfTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, V, V, 0, gl.RGBA, gl.HALF_FLOAT, hf);
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
      const hs = new Float32Array(V * V);
      for (let i = 0; i < V * V; i++) hs[i] = data[i * 7 + 1];
      this.ringGrid = { lo, C, V, hs };
      const idx = [];
      for (let iz = 0; iz < R; iz++) for (let ix = 0; ix < R; ix++) {
        const x0 = lo + ix * C, z0 = lo + iz * C;
        if (x0 >= 0 && x0 + C <= SIZE && z0 >= 0 && z0 + C <= SIZE) continue; // the real land is drawn there
        const a = iz * V + ix, b = a + 1, c = a + V, d = c + 1;
        idx.push(a, c, b, d, b, c);
      }
      return this.makeTerrainVao(data, new Uint32Array(idx));
    }

    // the height of the land as drawn: the map itself, or the ring of hills around it (on the ring's own triangles)
    landHeight(x, z) {
      if (x >= 0 && x <= SIZE && z >= 0 && z <= SIZE) return this.world.terrain.height(x, z);
      const g = this.ringGrid;
      const u = (x - g.lo) / g.C, v = (z - g.lo) / g.C;
      const ix = Math.max(0, Math.min(g.V - 2, Math.floor(u))), iz = Math.max(0, Math.min(g.V - 2, Math.floor(v)));
      const fx = Math.min(1, Math.max(0, u - ix)), fz = Math.min(1, Math.max(0, v - iz));
      const a = g.hs[iz * g.V + ix], b = g.hs[iz * g.V + ix + 1], c = g.hs[(iz + 1) * g.V + ix], d = g.hs[(iz + 1) * g.V + ix + 1];
      return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
    }
    buildStatic(world) {
      const boxes = [], cyls = [];
      const look = this.look;
      this.staticLights = [];
      const rock = mixc(look.rockCol || look.rock, [0.5, 0.5, 0.5], 0.35);
      const stone = mixc(rock, look.mid, 0.15);
      const rubble = [];
      for (const s of world.solids) {
        if (s.obj) continue;
        const b = s.b;
        if (s.team < 0) {
          // out in the field: weathered stone blocks in the map's rock colour, metal decks
          if (s.mat === 'deck') boxes.push({ b, col: [0.4, 0.41, 0.44], mat: [0, 1.5, 0, 0.5] });
          else { boxes.push({ b, col: stone, mat: [0, -1, 0, 0.12] }); if (b[4] - b[1] < 8) rubble.push(b); }
          continue;
        }
        const team = JF.TEAMS[s.team].rgb;
        let col = [0.5, 0.52, 0.55], panel = 2, stripe = 0, spec = 0.45;
        if (s.mat === 'roof') { col = [0.36, 0.38, 0.42]; spec = 0.35; }
        else if (s.mat === 'floor') { col = [0.3, 0.31, 0.33]; panel = 1.5; spec = 0.5; }
        else if (s.mat === 'trim') { col = mixc([0.45, 0.45, 0.48], team, 0.35); stripe = 2; spec = 0.5; }
        else if (s.mat === 'stand') { col = mixc([0.3, 0.3, 0.32], team, 0.5); spec = 0.5; }
        else if (s.mat === 'mast') { col = [0.42, 0.43, 0.45]; panel = 3; spec = 0.6; }
        else if (s.mat === 'cover') { col = mixc([0.46, 0.45, 0.43], stone, 0.5); panel = -1; spec = 0.15; }
        else { col = [0.55, 0.56, 0.58]; stripe = 1; }
        // blend a touch of the ground colour in so buildings sit in the land
        col = mixc(col, look.mid, 0.08);
        boxes.push({ b, col, mat: [0, panel, stripe, spec] });
        // team stripes glow in the team colour: an extra thin band on the walls
        if (stripe === 1) {
          const h = b[4] - b[1];
          if (h > 4) boxes.push({ b: [b[0] - 0.02, b[4] - 1.0, b[2] - 0.02, b[3] + 0.02, b[4] - 0.75, b[5] + 0.02], col: team, mat: [1.8, 0, 0, 0.2] });
        }
      }
      // the bunkers' dressing: nothing here collides, it is all to look at. Local coordinates like baseLayout in sim.js, x toward the front door.
      const DK = [0.22, 0.23, 0.26], MT = [0.5, 0.52, 0.55], PIPE = [0.33, 0.34, 0.38], WARM = [1, 0.95, 0.85];
      for (const base of world.bases) {
        const o = base.o, team = JF.TEAMS[base.team].rgb, tg = mixc(team, [1, 1, 1], 0.25);
        const P = b => (o.face > 0 ? [o.x + b[0], o.y + b[1], o.z + b[2], o.x + b[3], o.y + b[4], o.z + b[5]] : [o.x - b[3], o.y + b[1], o.z - b[5], o.x - b[0], o.y + b[4], o.z - b[2]]);
        const bx = (b, col, mat) => boxes.push({ b: P(b), col, mat: mat || [0, 0, 0, 0.5] });
        const cy = (b, col, mat, axis) => cyls.push({ b: P(b), col, mat: mat || [0, 0, 0, 0.6], axis: axis || 'y' });
        const lt = (x, y, z, r, c) => this.staticLights.push({ x: o.x + x * o.face, y: o.y + y, z: o.z + z * o.face, r, c });
        // corner pillars with caps and a light on top
        for (const px of [-12, 12]) for (const pz of [-9, 9]) {
          bx([px - 0.75, 0, pz - 0.75, px + 0.75, 10.6, pz + 0.75], DK, [0, 1.2, 0, 0.5]);
          bx([px - 0.9, 10.6, pz - 0.9, px + 0.9, 11.0, pz + 0.9], MT, [0, 0, 0, 0.6]);
          bx([px - 0.22, 11.0, pz - 0.22, px + 0.22, 11.5, pz + 0.22], team, [2.0, 0, 0, 0.2]);
        }
        // a girder band around the walls, ribs between the panels
        for (const sz of [-1, 1]) {
          const z0 = sz > 0 ? 9 : -9.3, z1 = sz > 0 ? 9.3 : -9;
          bx([-12, 5.0, z0, 12, 5.5, z1], MT, [0, 0, 0, 0.6]);
          for (const x of [-8, -4, 0, 4, 8]) bx([x - 0.18, 0, sz > 0 ? 9 : -9.25, x + 0.18, 8, sz > 0 ? 9.25 : -9], DK, [0, 0, 0, 0.5]);
          // pipes along the foot of the wall, with risers and clamps
          const p0 = sz > 0 ? 9.3 : -9.7, p1 = sz > 0 ? 9.7 : -9.3;
          cy([-11, 0.45, p0, 11, 0.85, p1], PIPE, [0, 0, 0, 0.7], 'x');
          cy([-11, 1.0, p0 + 0.02 * sz, 11, 1.36, p1 + 0.02 * sz], PIPE, [0, 0, 0, 0.7], 'x');
          for (const x of [-11, 11]) cy([x - 0.2, 0.45, p0, x + 0.2, 3.4, p1], PIPE, [0, 0, 0, 0.7]);
          for (const x of [-6, 0, 6]) bx([x - 0.12, 0.3, sz > 0 ? 9.2 : -9.8, x + 0.12, 1.5, sz > 0 ? 9.8 : -9.2], DK, [0, 0, 0, 0.5]);
        }
        for (const sx of [-1, 1]) {
          const x0 = sx > 0 ? 12 : -12.3, x1 = sx > 0 ? 12.3 : -12;
          bx([x0, 5.0, -9, x1, 5.5, 9], MT, [0, 0, 0, 0.6]);
          for (const z of [-6, 6]) bx([sx > 0 ? 12 : -12.25, 0, z - 0.18, sx > 0 ? 12.25 : -12, 8, z + 0.18], DK, [0, 0, 0, 0.5]);
          // the door: posts, a lintel, a lit sign over it, lamps either side
          const d0 = sx > 0 ? 11.9 : -12.35, d1 = sx > 0 ? 12.35 : -11.9;
          bx([d0, 4.6, -2.75, d1, 5.0, 2.75], DK, [0, 0, 0, 0.5]);
          bx([d0, 0, -2.75, d1, 4.6, -2.2], MT, [0, 0, 0, 0.6]);
          bx([d0, 0, 2.2, d1, 4.6, 2.75], MT, [0, 0, 0, 0.6]);
          bx([sx > 0 ? 12.3 : -12.42, 5.55, -1.6, sx > 0 ? 12.42 : -12.3, 5.85, 1.6], team, [2.5, 0, 0, 0.2]);
          for (const z of [-3.6, 3.1]) bx([sx > 0 ? 12.25 : -12.45, 3.4, z, sx > 0 ? 12.45 : -12.25, 3.7, z + 0.5], WARM, [3, 0, 0, 0]);
          lt(sx * 12.9, 3.6, 0, 7, [0.45, 0.4, 0.32]);
        }
        // vents on the back wall
        bx([-12.3, 2.0, -5.2, -11.9, 3.4, -2.8], DK, [0, 0.25, 0, 0.4]);
        for (const z of [3.6, 5.4]) cy([-12.35, 6.0, z, -11.9, 7.0, z + 1.0], DK, [0, 0, 0, 0.5], 'x');
        // on the roof: a hatch, vent boxes, an antenna with a dish and a red light
        bx([-3, 9, 4, -1, 9.45, 6], DK, [0, 0.6, 0, 0.5]);
        for (const z of [-6.5, 4.5]) bx([6, 9, z, 8, 10.1, z + 2], MT, [0, 0.3, 0, 0.5]);
        cy([-10.65, 10.2, -7.65, -10.35, 15.5, -7.35], MT, [0, 0, 0, 0.7]);
        bx([-11.4, 14.2, -7.56, -9.6, 14.32, -7.44], MT, [0, 0, 0, 0.7]);
        bx([-10.56, 13.2, -8.4, -10.44, 13.32, -6.6], MT, [0, 0, 0, 0.7]);
        cy([-10.95, 14.4, -8.2, -10.8, 15.8, -6.8], [0.8, 0.82, 0.85], [0, 0, 0, 0.8], 'x');
        cy([-10.62, 15.5, -7.62, -10.38, 15.8, -7.38], [1, 0.2, 0.15], [3, 0, 0, 0]);
        lt(-10.5, 15.6, -7.5, 4, [0.5, 0.08, 0.04]);
        // the flag stand sits on a lit disc
        cy([-1.9, 9.0, -1.9, 1.9, 9.07, 1.9], tg, [0.6, 0, 0, 0.3]);
        // inside: a lit ring around the generator, grating by the doors, pipes along the ceiling, screens, lockers, crates
        cy([-2.7, 0.08, -2.7, 2.7, 0.13, 2.7], team, [0.9, 0, 0, 0.3]);
        bx([8.5, 0.08, -2.2, 11, 0.12, 2.2], DK, [0, 0.35, 0, 0.45]);
        bx([-11, 0.08, -2.2, -8.5, 0.12, 2.2], DK, [0, 0.35, 0, 0.45]);
        for (const z of [-6.2, 5.8]) cy([-11.5, 7.35, z, 11.5, 7.75, z + 0.4], PIPE, [0, 0, 0, 0.7], 'x');
        for (const sz of [-1, 1]) {
          bx([-2.3, 2.0, sz > 0 ? 7.85 : -8.0, 2.3, 4.4, sz > 0 ? 8.0 : -7.85], DK, [0, 0, 0, 0.6]);
          bx([-2.1, 2.2, sz > 0 ? 7.8 : -7.9, 2.1, 4.2, sz > 0 ? 7.9 : -7.8], mixc(team, [0.1, 0.1, 0.12], 0.4), [0.9, 0, 0, 0.5]);
        }
        bx([-11, 0, -7.6, -10.3, 2.3, -3.2], MT, [0, 0.55, 0, 0.5]);
        bx([-11, 0, 3.2, -10.3, 2.3, 7.6], MT, [0, 0.55, 0, 0.5]);
        bx([-10.8, 0.08, 2.5, -9.6, 1.2, 3.7], [0.45, 0.4, 0.3], [0, 1.2, 0, 0.3]);
        bx([-9.5, 0.08, 2.6, -8.5, 1.0, 3.6], [0.4, 0.42, 0.3], [0, 1.0, 0, 0.3]);
        bx([-10.6, 1.2, 2.7, -9.8, 2.0, 3.5], [0.45, 0.4, 0.3], [0, 0.8, 0, 0.3]);
        // the mast: a ladder, a hazard band, cross arms and a platform under the sensor
        for (let y = 0.3; y < 20.8; y += 0.6) bx([-34.35, y, -0.3, -34.2, y + 0.07, 0.3], MT, [0, 0, 0, 0.7]);
        for (const z of [-0.35, 0.25]) bx([-34.35, 0, z, -34.2, 21, z + 0.1], MT, [0, 0, 0, 0.7]);
        bx([-34.05, 10, -1.05, -31.95, 11.2, 1.05], MT, [0, 1, 2, 0.4]);
        bx([-36.5, 19, -0.15, -29.5, 19.3, 0.15], MT, [0, 0, 0, 0.7]);
        bx([-33.15, 19, -3.5, -32.85, 19.3, 3.5], MT, [0, 0, 0, 0.7]);
        bx([-35.2, 21.6, -2.2, -30.8, 22, 2.2], MT, [0, 0.55, 0, 0.5]);
        for (const [a, b] of [[-35.2, -35.1], [-30.9, -30.8]]) bx([a, 22, -2.2, b, 23, 2.2], MT, [0, 0, 0, 0.7]);
        for (const [a, b] of [[-2.2, -2.1], [2.1, 2.2]]) bx([-35.2, 22, a, -30.8, 23, b], MT, [0, 0, 0, 0.7]);
        // spawn pads
        for (const sp of base.spawns) {
          cyls.push({ b: [sp[0] - 1.15, sp[1] - 0.05, sp[2] - 1.15, sp[0] + 1.15, sp[1] + 0.03, sp[2] + 1.15], col: team, mat: [0.9, 0, 0, 0.3], axis: 'y' });
          cyls.push({ b: [sp[0] - 0.95, sp[1] - 0.04, sp[2] - 0.95, sp[0] + 0.95, sp[1] + 0.05, sp[2] + 0.95], col: DK, mat: [0, 0.4, 0, 0.5], axis: 'y' });
        }
      }
      const bd = new Float32Array(boxes.length * INST_FLOATS);
      boxes.forEach((it, i) => {
        const b = it.b, o = i * INST_FLOATS;
        trs(bd, o, (b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, 0, 0, b[3] - b[0], b[4] - b[1], b[5] - b[2]);
        bd.set([it.col[0], it.col[1], it.col[2], 1], o + 16);
        bd.set(it.mat, o + 20);
      });
      this.setStatic('box', bd, boxes.length);
      const cd = new Float32Array(cyls.length * INST_FLOATS);
      cyls.forEach((it, i) => {
        const b = it.b, o = i * INST_FLOATS;
        const lx = b[3] - b[0], ly = b[4] - b[1], lz = b[5] - b[2], cx = (b[0] + b[3]) / 2, cyy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
        // a cylinder's own axis is y; roll it onto x, or pitch it onto z
        if (it.axis === 'x') trs(cd, o, cx, cyy, cz, 0, 0, ly, lx, lz, Math.PI / 2);
        else if (it.axis === 'z') trs(cd, o, cx, cyy, cz, 0, Math.PI / 2, lx, lz, ly);
        else trs(cd, o, cx, cyy, cz, 0, 0, lx, ly, lz);
        cd.set([it.col[0], it.col[1], it.col[2], 1], o + 16);
        cd.set(it.mat, o + 20);
      });
      this.setStatic('cyl', cd, cyls.length);
      this.scatterRocks(world, rubble);
      if (this.buildVeg) this.buildVeg(world);
    }
    setStatic(kind, data, n) {
      const m = this.meshes[kind], gl = this.gl;
      if (!m.staticBuf) m.staticBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, m.staticBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      m.staticN = n;
    }
    // boulders, for scale and detail. Only to look at: they are low and the physics ignores them.
    scatterRocks(world, rubble) {
      const t = world.terrain, look = this.look;
      const rng = JF.mulberry(world.def.seed * 7 + 1);
      const n = look.rocks == null ? 900 : look.rocks;
      const extra = (rubble || []).length * 6;
      const data = new Float32Array((n + extra) * INST_FLOATS);
      const shaped = !!this.meshes.rock0;
      const c = look.rockCol || look.rock;
      let k = 0;
      // broken stone around the ruins
      for (const b of rubble || []) {
        const cx = (b[0] + b[3]) / 2, cz = (b[2] + b[5]) / 2, w = b[3] - b[0], d = b[5] - b[2];
        for (let i = 0; i < 6; i++) {
          const x = cx + (rng() - 0.5) * (w + 5), z = cz + (rng() - 0.5) * (d + 5);
          const s = 0.5 + rng() * rng() * 1.8;
          trs(data, k * INST_FLOATS, x, t.height(x, z) - s * 0.3, z, rng() * 6.28, (rng() - 0.5) * 0.8, s * (0.8 + rng() * 0.6), s * (0.5 + rng() * 0.4), s * (0.8 + rng() * 0.6), (rng() - 0.5) * 0.6);
          const shade = 0.75 + rng() * 0.3;
          data.set([c[0] * shade, c[1] * shade, c[2] * shade, 1], k * INST_FLOATS + 16);
          data.set([0, -2, 0, 0.1], k * INST_FLOATS + 20);
          k++;
        }
      }
      for (let i = 0; i < n * 3 && k < n + extra; i++) {
        const x = JF.AREA_MIN - 150 + rng() * (JF.AREA_MAX - JF.AREA_MIN + 300), z = JF.AREA_MIN - 150 + rng() * (JF.AREA_MAX - JF.AREA_MIN + 300);
        // keep clear of the bases
        if (world.bases.some(b => Math.hypot(b.o.x - x, b.o.z - z) < 70)) continue;
        if (t.waterH != null && t.height(x, z) < t.waterH + 1) continue;
        if (t.lavaH != null && t.height(x, z) < t.lavaH + 1) continue;
        const nr = t.normal(x, z);
        const steep = 1 - nr[1];
        if (rng() > 0.25 + steep * 3) continue; // more on slopes
        const s = (1.0 + rng() * rng() * 4.5) * (steep > 0.2 ? 1.5 : 1);
        // sunk deeper on slopes, so the downhill side does not float
        const y = t.height(x, z) - s * (0.6 + steep * 2.2);
        trs(data, k * INST_FLOATS, x, y, z, rng() * 6.28, (rng() - 0.5) * 0.5, s * (0.9 + rng() * 0.7), s * (0.75 + rng() * 0.55), s * (0.9 + rng() * 0.7), (rng() - 0.5) * 0.4);
        const shade = 0.8 + rng() * 0.35;
        data.set([c[0] * shade, c[1] * shade, c[2] * shade, 1], k * INST_FLOATS + 16);
        data.set([0, -2, 0, 0.12 + rng() * 0.1], k * INST_FLOATS + 20);
        k++;
      }
      if (!shaped) { this.setStatic('sphere', data, k); return; }
      this.setStatic('sphere', new Float32Array(0), 0);
      // deal the rocks out to the shapes; the shapes are about twice as wide as the old spheres, so halve them
      for (let r = 0; r < ROCK_SHAPES; r++) {
        const sel = [];
        for (let i = r; i < k; i += ROCK_SHAPES) sel.push(i);
        const d = new Float32Array(sel.length * INST_FLOATS);
        sel.forEach((i, j) => {
          d.set(data.subarray(i * INST_FLOATS, (i + 1) * INST_FLOATS), j * INST_FLOATS);
          const o = j * INST_FLOATS;
          for (let q = 0; q < 12; q++) if (q % 4 !== 3) d[o + q] *= 1.6;
        });
        this.setStatic('rock' + r, d, sel.length);
      }
    }

    // ---------- per frame ----------
    // scene: { cam: {pos, yaw, pitch, fov}, boxes/spheres/cyls: instance arrays (built with put*), parts, beams, lights, glass, viewModel, time, hurt, flash }
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

    // one shadow map: an orthographic view down the sun, `ext` metres each side of `center`, snapped to texels so edges do not crawl
    renderShadow(sm, ext, center, back, far) {
      const gl = this.gl, sun = this.sun;
      const ld = [-sun[0], -sun[1], -sun[2]];
      let lr = norm(cross(ld, [0, 1, 0])); if (!isFinite(lr[0]) || (lr[0] === 0 && lr[1] === 0 && lr[2] === 0)) lr = [1, 0, 0];
      const lu = cross(lr, ld);
      const texel = ext * 2 / SHADOW_SIZE;
      const cr = dot(center, lr), cu = dot(center, lu);
      const dr = Math.round(cr / texel) * texel - cr, du = Math.round(cu / texel) * texel - cu;
      const sc = [center[0] + lr[0] * dr + lu[0] * du, center[1] + lr[1] * dr + lu[1] * du, center[2] + lr[2] * dr + lu[2] * du];
      const eye = [sc[0] - ld[0] * back, sc[1] - ld[1] * back, sc[2] - ld[2] * back];
      const lv = M4.view(eye, ld, lr, lu);
      const lp = M4.ortho(-ext, ext, -ext, ext, 1, far);
      sm.mat = M4.mul(lp, lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fb);
      gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2, 4);
      gl.useProgram(this.progS.p);
      gl.uniformMatrix4fv(this.progS.u.uVP, false, sm.mat);
      this.drawMeshes(this.progS);
      if (this.drawVeg) this.drawVeg('shadow', sm.mat, null, center, ext);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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
      this.proj = proj; this.view = view;
      const look = this.look, sun = this.sun, q = this.q, g = this.grade;
      this.time = scene.time || 0;

      // upload instance data
      for (const m of Object.values(this.meshes)) {
        gl.bindBuffer(gl.ARRAY_BUFFER, m.inst);
        gl.bufferData(gl.ARRAY_BUFFER, m.data.subarray(0, m.n * INST_FLOATS), gl.STREAM_DRAW);
      }

      // lights: the scene's and the bunkers' own, nearest first
      let lights = (scene.lights || []).concat(this.staticLights || []);
      if (lights.length > MAX_LIGHTS) {
        const d2 = l => (l.x - cam.pos[0]) ** 2 + (l.y - cam.pos[1]) ** 2 + (l.z - cam.pos[2]) ** 2;
        lights = lights.slice().sort((a, b) => d2(a) - d2(b)).slice(0, MAX_LIGHTS);
      }

      // ----- shadow passes -----
      let shadowOn = false, nearOn = false;
      if (this.shadowsOn) {
        const extF = q.near ? 150 : 100;
        this.renderShadow(this.shadow[1], extF, [cam.pos[0] + f[0] * extF * 0.55, cam.pos[1], cam.pos[2] + f[2] * extF * 0.55], 320, 760);
        shadowOn = true;
        if (q.near) {
          const extN = 26;
          this.renderShadow(this.shadow[0], extN, [cam.pos[0] + f[0] * extN * 0.5, cam.pos[1], cam.pos[2] + f[2] * extN * 0.5], 160, 420);
          nearOn = true;
        }
      }

      // ----- where the scene goes: the canvas, or the HDR target for the post pass -----
      const post = q.post;
      if (post && (this.fbW !== W || this.fbH !== H || !this.targets)) this.makeTargets(W, H);
      if (!post && this.targets) this.dropTargets();
      const T = this.targets;
      const hdr = post && this.hdr;
      gl.bindFramebuffer(gl.FRAMEBUFFER, post ? (T.ms ? T.ms.fb : T.scene.fb) : null);
      gl.viewport(0, 0, W, H);
      gl.clearColor(look.fog[0], look.fog[1], look.fog[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.disable(gl.BLEND);

      const texOn = !!(this.tex && this.tex.A && q.tex);
      const setCommon = this.setCommonFn = prog => {
        const U = prog.u;
        gl.uniform3fv(U.uSunDir, sun); gl.uniform3fv(U.uSunCol, look.sunColor); gl.uniform3fv(U.uAmb, look.ambient);
        if (U.uSkyTop) gl.uniform3fv(U.uSkyTop, look.skyTop);
        if (U.uSkyHor) gl.uniform3fv(U.uSkyHor, look.skyHorizon);
        if (U.uGround) gl.uniform3fv(U.uGround, look.mid);
        gl.uniform3fv(U.uFogCol, look.fog); gl.uniform1f(U.uFogDist, look.fogDist * (scene.fogScale || 1));
        gl.uniform3fv(U.uCam, cam.pos); gl.uniform1f(U.uTime, scene.time || 0);
        if (U.uHDR) gl.uniform1f(U.uHDR, hdr ? 1 : 0);
        if (U.uWet) gl.uniform1f(U.uWet, g.wet || 0);
        if (U.uClouds) gl.uniform1f(U.uClouds, look.clouds);
        const n = Math.min(MAX_LIGHTS, lights.length);
        if (U.uNumLights) {
          gl.uniform1i(U.uNumLights, n);
          if (n) {
            const lp = new Float32Array(MAX_LIGHTS * 4), lc = new Float32Array(MAX_LIGHTS * 3);
            for (let i = 0; i < n; i++) { lp.set([lights[i].x, lights[i].y, lights[i].z, lights[i].r], i * 4); lc.set(lights[i].c, i * 3); }
            gl.uniform4fv(U.uLightPos, lp); gl.uniform3fv(U.uLightCol, lc);
          }
        }
        if (U.uShadowF) {
          gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.shadow[0].tex); gl.uniform1i(U.uShadowN, 0);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.shadow[1].tex); gl.uniform1i(U.uShadowF, 1);
          gl.uniform1f(U.uShadowOn, shadowOn ? 1 : 0); gl.uniform1f(U.uNearOn, nearOn ? 1 : 0);
          if (shadowOn) gl.uniformMatrix4fv(U.uShadowMatF, false, this.shadow[1].mat);
          if (nearOn) gl.uniformMatrix4fv(U.uShadowMatN, false, this.shadow[0].mat);
        }
        if (U.uHF) { gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.hfTex); gl.uniform1i(U.uHF, 2); }
        if (U.uTexA) {
          gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texOn ? this.tex.A : this.dummyArr); gl.uniform1i(U.uTexA, 3);
          gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, texOn ? this.tex.N : this.dummyArr); gl.uniform1i(U.uTexN, 4);
          gl.uniform1f(U.uTexOn, texOn ? 1 : 0);
          if (texOn && U.uMat) gl.uniform4fv(U.uMat, this.tex.info);
        }
        if (U.uTexC) { gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex && this.tex.C ? this.tex.C : this.dummyArr); gl.uniform1i(U.uTexC, 5); }
        if (U.uMaskA) gl.uniform1f(U.uMaskA, 0);
        gl.activeTexture(gl.TEXTURE0);
      };

      // ----- land -----
      const Tp = this.progT;
      gl.useProgram(Tp.p); setCommon(Tp);
      gl.uniformMatrix4fv(Tp.u.uVP, false, vp);
      gl.uniform3fv(Tp.u.uLow, look.low); gl.uniform3fv(Tp.u.uMid, look.mid); gl.uniform3fv(Tp.u.uHigh, look.high);
      gl.uniform3fv(Tp.u.uRock, look.rock); gl.uniform3fv(Tp.u.uSnow, look.snow);
      gl.uniform1f(Tp.u.uSnowLine, look.snowLine); gl.uniform1f(Tp.u.uHmin, this.hmin); gl.uniform1f(Tp.u.uHmax, this.hmax);
      gl.uniform1f(Tp.u.uLava, this.world.terrain.lavaH != null ? 1 : 0);
      gl.uniform1f(Tp.u.uLavaH, this.world.terrain.lavaH || 0);
      if (texOn) gl.uniform4iv(Tp.u.uLayers, this.matIdx(look.mats || DEFAULT_LAYERS));
      gl.uniform1f(Tp.u.uWorn, look.worn != null ? look.worn : 1);
      gl.bindVertexArray(this.terrain.vao); gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(this.ring.vao); gl.drawElements(gl.TRIANGLES, this.ring.count, gl.UNSIGNED_INT, 0);

      // ----- solid things -----
      const Mp = this.progM;
      gl.useProgram(Mp.p); setCommon(Mp);
      gl.uniformMatrix4fv(Mp.u.uVP, false, vp);
      gl.uniform1f(Mp.u.uGlass, 0);
      if (texOn) gl.uniform4iv(Mp.u.uMeshMats, this.matIdx(MESH_MATS));
      this.drawMeshes(Mp);
      if (this.drawVeg) this.drawVeg('main', vp, setCommon);

      // ----- grass -----
      const grassK = look.grass == null ? 0 : look.grass;
      if (q.grass > 0 && grassK > 0) {
        const Gp = this.progG;
        gl.useProgram(Gp.p); setCommon(Gp);
        gl.uniformMatrix4fv(Gp.u.uVP, false, vp);
        gl.uniform1f(Gp.u.uCell, GRASS_CELL); gl.uniform1f(Gp.u.uRadius, q.grass); gl.uniform1f(Gp.u.uDensity, grassK);
        gl.uniform1f(Gp.u.uSnowLine, look.snowLine); gl.uniform1f(Gp.u.uHmin, this.hmin); gl.uniform1f(Gp.u.uHmax, this.hmax);
        const t = this.world.terrain;
        gl.uniform1f(Gp.u.uLowH, t.waterH != null ? t.waterH : t.lavaH != null ? t.lavaH : -1e6);
        const gc = look.grassCol || mixc(look.low, [0.9, 1, 0.5], 0.08), gc2 = look.grassCol2 || mixc(mixc(look.low, look.mid, 0.6), [0.9, 0.95, 0.45], 0.1);
        gl.uniform3fv(Gp.u.uGrassCol, gc); gl.uniform3fv(Gp.u.uGrassCol2, gc2);
        let n = 0; while (n < this.grassCells.length && this.grassCells[n] <= q.grass) n++;
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(this.grassVao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 12, n);
        gl.enable(gl.CULL_FACE);
      }

      // ----- sky (behind everything, drawn last to save fill) -----
      const S = this.progSky;
      gl.useProgram(S.p); setCommon(S);
      gl.uniformMatrix4fv(S.u.uInvVP, false, M4.inv(vp));
      gl.uniform1f(S.u.uStars, g.stars || 0);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.triVao); gl.drawArrays(gl.TRIANGLES, 0, 3);

      // blending never touches the alpha already there: it is the post pass's mask
      // ----- water -----
      if (this.world.terrain.waterH != null) {
        const Wp = this.progW;
        gl.useProgram(Wp.p); setCommon(Wp);
        gl.uniformMatrix4fv(Wp.u.uVP, false, vp); gl.uniform1f(Wp.u.uH, this.world.terrain.waterH);
        gl.uniform3fv(Wp.u.uWater, look.water || [0.1, 0.2, 0.25]);
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(this.waterVao); gl.drawArrays(gl.TRIANGLES, 0, 6);
        gl.depthMask(true); gl.disable(gl.BLEND);
      }

      // ----- see-through things (shields) -----
      if (scene.glass && scene.glass.length) {
        gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ZERO, gl.ONE); gl.depthMask(false);
        gl.useProgram(Mp.p);
        gl.uniform1f(Mp.u.uGlass, 1); gl.uniform1f(Mp.u.uBox, 0);
        const m = this.meshes.sphere, d = new Float32Array(scene.glass.length * INST_FLOATS);
        scene.glass.forEach((gs, i) => { trs(d, i * INST_FLOATS, gs.x, gs.y, gs.z, 0, 0, gs.s, gs.s * 1.2, gs.s); d.set([gs.c[0], gs.c[1], gs.c[2], gs.a], i * INST_FLOATS + 16); d.set([0.6, 0, 0, 1], i * INST_FLOATS + 20); });
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
        gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.parts.n);
      }
      if (scene.beams && scene.beams.n) {
        const Bp = this.progB;
        gl.useProgram(Bp.p);
        gl.uniformMatrix4fv(Bp.u.uVP, false, vp); gl.uniform3fv(Bp.u.uCam, cam.pos);
        gl.bindVertexArray(this.beamVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf);
        gl.bufferData(gl.ARRAY_BUFFER, scene.beams.data.subarray(0, scene.beams.n * 12), gl.STREAM_DRAW);
        gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, scene.beams.n);
      }
      gl.depthMask(true); gl.disable(gl.BLEND);

      // the scene's depth, for occlusion and fog, before the weapon clears it
      if (post && this.grabDepth) this.grabDepth(T, T.ms ? T.ms.fb : T.scene.fb, W, H);
      // ----- first-person weapon: its own near camera, drawn over everything -----
      if (scene.viewModel && scene.viewModel.length) {
        gl.clear(gl.DEPTH_BUFFER_BIT);
        const vproj = M4.persp(1.1, W / H, 0.02, 10);
        const vvp = M4.mul(vproj, view);
        gl.useProgram(Mp.p); setCommon(Mp);
        gl.uniform1f(Mp.u.uMaskA, 0.75); // marks the weapon so occlusion and fog leave it alone
        gl.uniform1f(Mp.u.uShadowOn, 0); gl.uniform1f(Mp.u.uGlass, 0);
        gl.uniformMatrix4fv(Mp.u.uVP, false, vvp);
        gl.enable(gl.CULL_FACE);
        const byKind = {};
        for (const it of scene.viewModel) (byKind[it.kind] = byKind[it.kind] || []).push(it);
        for (const [kind, list] of Object.entries(byKind)) {
          const m = this.meshes[kind], d = new Float32Array(list.length * INST_FLOATS);
          list.forEach((it, i) => { d.set(it.m, i * INST_FLOATS); d.set([it.col[0], it.col[1], it.col[2], 1], i * INST_FLOATS + 16); d.set(it.mat || [0, 0, 0, 0.6], i * INST_FLOATS + 20); });
          gl.uniform1f(Mp.u.uBox, kind === 'box' ? 1 : 0);
          gl.bindVertexArray(m.vao); gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STREAM_DRAW);
          gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, list.length);
        }
      }
      gl.bindVertexArray(null);

      if (post) this.postPass(scene, T, W, H, hdr, vp, f);
    }

    // bloom, light shafts, tone mapping, grade, vignette, grain: the HDR picture becomes the one on screen
    postPass(scene, T, W, H, hdr, vp, f) {
      const gl = this.gl, g = this.grade, q = this.q, look = this.look, sun = this.sun;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.triVao);
      if (T.ms) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, T.ms.fb);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.scene.fb);
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }
      const draw = (prog, target, tex, tw, th, set) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        gl.viewport(0, 0, target ? target.w : W, target ? target.h : H);
        gl.useProgram(prog.p);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(prog.u.uTex, 0);
        gl.uniform2f(prog.u.uTexel, 1 / tw, 1 / th);
        if (set) set(prog.u);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      };
      // bloom: bright bits, blurred at three sizes
      const B = T.bloom;
      draw(this.progBright, B[0].a, T.scene.tex, W, H, U => gl.uniform1f(U.uThresh, hdr ? 1.0 : 0.72));
      const blur = b => {
        draw(this.progBlur, b.b, b.a.tex, b.w, b.h, U => gl.uniform2f(U.uDir, 1, 0));
        draw(this.progBlur, b.a, b.b.tex, b.w, b.h, U => gl.uniform2f(U.uDir, 0, 1));
      };
      blur(B[0]);
      for (let i = 1; i < 3; i++) { draw(this.progDown, B[i].a, B[i - 1].a.tex, B[i - 1].w, B[i - 1].h); blur(B[i]); }
      // light shafts from the sun, when it is in front of the camera
      let rayK = 0;
      if (q.rays && g.rays > 0) {
        const px = this.camPos[0] + sun[0] * 2000, py = this.camPos[1] + sun[1] * 2000, pz = this.camPos[2] + sun[2] * 2000;
        const m = vp;
        const cx = m[0] * px + m[4] * py + m[8] * pz + m[12], cy = m[1] * px + m[5] * py + m[9] * pz + m[13], cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
        if (cw > 0) {
          const su = cx / cw * 0.5 + 0.5, sv = cy / cw * 0.5 + 0.5;
          const off = Math.max(Math.abs(su - 0.5), Math.abs(sv - 0.5)) * 2;
          const vis = sstep(0.05, 0.3, dot(f, sun)) * (1 - sstep(0.75, 1.5, off));
          if (vis > 0.01) {
            draw(this.progRayMask, T.rayMask, T.scene.tex, W, H, U => { gl.uniform2f(U.uSun, su, sv); gl.uniform1f(U.uAspect, W / H); gl.uniform3fv(U.uSunCol, look.sunColor); });
            draw(this.progRays, T.rays, T.rayMask.tex, T.rayMask.w, T.rayMask.h, U => gl.uniform2f(U.uSun, su, sv));
            rayK = g.rays * vis * 0.6;
          }
        }
      }
      const atm = this.atmosPass ? this.atmosPass(T, scene) : null;
      // the finish
      draw(this.progFinal, T.ldr, T.scene.tex, W, H, U => {
        gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, atm && atm.ao ? atm.ao : this.whiteTex); gl.uniform1i(U.uAO, 5);
        gl.activeTexture(gl.TEXTURE6); gl.bindTexture(gl.TEXTURE_2D, atm && atm.fog ? atm.fog : this.noFogTex); gl.uniform1i(U.uFog, 6);
        gl.uniform1f(U.uAOK, atm && atm.ao ? (g.ao != null ? g.ao : 0.85) : 0); gl.uniform1f(U.uFogK, atm && atm.fog ? 1 : 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, B[0].a.tex); gl.uniform1i(U.uBloom0, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, B[1].a.tex); gl.uniform1i(U.uBloom1, 2);
        gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, B[2].a.tex); gl.uniform1i(U.uBloom2, 3);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, T.rays.tex); gl.uniform1i(U.uRays, 4);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform1f(U.uBloomK, (hdr ? 0.35 : 0.5) * g.bloom); gl.uniform1f(U.uRayK, rayK);
        gl.uniform1f(U.uExposure, g.exposure); gl.uniform1f(U.uSat, g.sat); gl.uniform1f(U.uContrast, g.contrast); gl.uniform1f(U.uGamma, g.gamma);
        gl.uniform3fv(U.uLift, g.lift); gl.uniform3fv(U.uGain, g.gain);
        gl.uniform1f(U.uVig, g.vignette); gl.uniform1f(U.uGrain, q.grain); gl.uniform1f(U.uTime, scene.time || 0);
        gl.uniform1f(U.uHurt, Math.min(1, scene.hurt || 0)); gl.uniform1f(U.uFlash, Math.min(1, scene.flash || 0));
        gl.uniform1f(U.uHeat, this.world.terrain.lavaH != null ? q.heat : 0); gl.uniform1f(U.uCA, q.ca * 0.012);
        gl.uniform1f(U.uHDR, hdr ? 1 : 0);
      });
      if (T.ldr) draw(this.progFxaa, null, T.ldr.tex, W, H);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
    }

    drawMeshes(prog) {
      const gl = this.gl;
      for (const [k, m] of Object.entries(this.meshes)) {
        if (prog.u.uBox) gl.uniform1f(prog.u.uBox, k === 'box' ? 1 : 0);
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
  const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  root.JFRender = { Renderer, Batch, M4, trs, norm, cross, mixc, QUALITY, COMMON, compile, INST_FLOATS, POST_VS };
})(window);
