/*
 * HD-2D on the graphics card (WebGL2). hd2d.js still draws the pixel art on the CPU; this file lights it and does every camera effect
 * from hd2d-post.js (depth of field, bloom, light shafts, lens flare, dust, fog, tint, vignette) in a few small shader passes.
 * The same numbers as the canvas version, so the two look alike; hd2d-post.js stays as the fallback when WebGL2 is missing or lost.
 *
 * Also here: HD2D.backdrop, which has hd2d-worker.js draw each room's background off the main thread.
 * Browser only. Raw WebGL2, no library.
 */
(function (root) {
  'use strict';
  const HD = root.HD2D, W = HD.W, H = HD.H, DW = HD.DW, DH = HD.DH, DS = DW / 160;
  const MAXL = 64; // lights per room; more than any room has

  // Every offscreen picture keeps row 0 at the top (gl_FragCoord.y is the picture's row); only the last pass flips for the page.
  const VS = `#version 300 es
  layout(location = 0) in vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;
  // Lighting: the light map is worked out at a quarter size, smoothed back up and banded, as Scene.finish does.
  const FS_LIGHT = `#version 300 es
  precision highp float; precision highp int;
  uniform highp sampler2D uCol; uniform highp usampler2D uEmit; uniform int uN; uniform vec4 uL[${MAXL}]; uniform vec3 uC[${MAXL}]; uniform float uAmb, uGain, uSteps;
  out vec4 o;
  vec3 lm(int i, int j) {
    vec2 p = (vec2(float(i), float(j)) + 0.5) * (160.0 / ${W / 4}.0); vec3 s = vec3(uAmb);
    for (int k = 0; k < ${MAXL}; k++) { if (k >= uN) break; vec2 d = p - uL[k].xy; float d2 = dot(d, d) / (uL[k].z * uL[k].z);
      if (d2 < 1.0) { float dd = sqrt(d2); s += (1.0 - dd) * (1.0 - dd) * uL[k].w * uGain * uC[k]; } }
    return s;
  }
  void main() {
    ivec2 q = ivec2(gl_FragCoord.xy); vec3 col = texelFetch(uCol, q, 0).rgb; uint e = texelFetch(uEmit, q, 0).r;
    if (e == 0u) {
      float fx = clamp((float(q.x) + 0.5) / 4.0 - 0.5, 0.0, ${W / 4 - 1}.0), fy = clamp((float(q.y) + 0.5) / 4.0 - 0.5, 0.0, ${H / 4 - 1}.0);
      int i0 = int(floor(fx)), j0 = int(floor(fy)), i1 = min(${W / 4 - 1}, i0 + 1), j1 = min(${H / 4 - 1}, j0 + 1); float tx = fx - float(i0), ty = fy - float(j0);
      vec3 v = mix(mix(lm(i0, j0), lm(i1, j0), tx), mix(lm(i0, j1), lm(i1, j1), tx), ty);
      col *= floor(v * uSteps + 0.5) / uSteps;
    }
    o = vec4(min(col, 255.0) / 255.0, e == 1u ? 1.0 : 0.0); // alpha marks things that glow, for the bloom
  }`;
  // depth of field mask: blur above and below the hero, and over the far background
  const FS_MASK = `#version 300 es
  precision highp float;
  uniform highp sampler2D uDepth; uniform float uFoc, uClear, uRamp, uBg; out vec4 o;
  void main() { ivec2 q = ivec2(gl_FragCoord.xy); float a0 = clamp((abs((float(q.y) + 0.5) / ${H / 4}.0 - uFoc) - uClear) / uRamp, 0.0, 1.0);
    bool far = texelFetch(uDepth, q * 4 + 2, 0).r < 0.13; o = vec4(far ? max(a0, uBg) : a0, 0, 0, 1); }`;
  const FS_COPY = `#version 300 es
  precision highp float; uniform sampler2D uT; uniform vec2 uSize; out vec4 o;
  void main() { o = vec4(texture(uT, gl_FragCoord.xy / uSize).rgb, 1.0); }`;
  const FS_BRIGHT = `#version 300 es
  precision highp float; uniform sampler2D uT; uniform float uThr; out vec4 o;
  void main() { vec4 c = texelFetch(uT, ivec2(gl_FragCoord.xy) * 2, 0); float l = dot(c.rgb, vec3(0.3, 0.59, 0.11));
    float k = c.a > 0.5 ? 1.0 : max(0.0, (l - uThr) / (1.0 - uThr)); o = vec4(c.rgb * k, 1.0); }`;
  // the picture at page size: crisp pixels, depth of field, bloom, lens flare
  const FS_COMP = `#version 300 es
  precision highp float;
  uniform sampler2D uLit, uB2, uMask, uG1, uG2; uniform float uDof, uBloom, uFlare; uniform vec2 uSun; out vec4 o;
  float glow(vec2 p, vec2 c, float R) { return max(0.0, 1.0 - length(p - c) / R); }
  void main() {
    vec2 p = gl_FragCoord.xy, uv = p / vec2(${DW}.0, ${DH}.0);
    vec3 c = texelFetch(uLit, ivec2(p) / 2, 0).rgb;
    c = mix(c, texture(uB2, uv).rgb, texture(uMask, uv).r * uDof);
    c = min(c + uBloom * texture(uG1, uv).rgb, 1.0); c = min(c + uBloom * texture(uG2, uv).rgb, 1.0);
    if (uFlare > 0.0) {
      c += vec3(255.0, 200.0, 120.0) / 255.0 * 0.42 * glow(p, uSun, ${DW}.0 * 0.3);
      vec2 mid = vec2(${DW}.0, ${DH}.0) / 2.0;
      vec4 G[4] = vec4[4](vec4(0.35, 0.03, 0.12, 0), vec4(0.7, 0.015, 0.18, 0), vec4(1.15, 0.05, 0.08, 0), vec4(1.5, 0.022, 0.12, 0));
      for (int k = 0; k < 4; k++) { vec2 g = uSun + (mid - uSun) * 2.0 * G[k].x; float R = G[k].y * ${DW}.0, t = length(p - g) / R;
        if (t < 1.0) { vec3 col = t < 0.7 ? mix(vec3(255, 230, 200), vec3(255, 170, 120), t / 0.7) : vec3(255, 170, 120); float a = t < 0.7 ? mix(G[k].z, G[k].z * 0.6, t / 0.7) : mix(G[k].z * 0.6, 0.0, (t - 0.7) / 0.3); c += col / 255.0 * a; } }
      c = min(c, 1.0);
    }
    o = vec4(c, 1.0);
  }`;
  // light shafts (triangles that fade out) and dust (soft points), added on top
  const VS_ADD = `#version 300 es
  layout(location = 0) in vec2 p; layout(location = 1) in vec4 col; layout(location = 2) in float size; out vec4 vc; out float vs;
  void main() { gl_Position = vec4(p.x / ${DW}.0 * 2.0 - 1.0, p.y / ${DH}.0 * 2.0 - 1.0, 0.0, 1.0); vc = col; vs = size; gl_PointSize = size > 0.0 ? size * 2.0 + 2.0 : 1.0; }`;
  const FS_ADD = `#version 300 es
  precision highp float; in vec4 vc; in float vs; out vec4 o;
  void main() { float k = 1.0; if (vs > 0.0) { float d = length(gl_PointCoord - 0.5) * (vs * 2.0 + 2.0); k = clamp(vs - d + 0.5, 0.0, 1.0); } o = vec4(vc.rgb * vc.a * k, 1.0); }`;
  // fog (screen), tint (soft-light), vignette, then out to the page, flipped the right way up
  const FS_FINAL = `#version 300 es
  precision highp float;
  uniform sampler2D uT; uniform vec4 uFog; uniform vec4 uTint; uniform float uVig; out vec4 o;
  vec3 D(vec3 b) { return mix(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, step(b, vec3(0.25))); }
  void main() {
    vec2 p = vec2(gl_FragCoord.x, ${DH}.0 - gl_FragCoord.y); vec3 c = texelFetch(uT, ivec2(p), 0).rgb;
    if (uFog.a > 0.0 && p.y >= 0.55 * ${DH}.0) { float a = uFog.a * (p.y - 0.55 * ${DH}.0) / (0.45 * ${DH}.0); c = c + a * (uFog.rgb - c * uFog.rgb); }
    if (uTint.a > 0.0) { vec3 s = uTint.rgb, lo = c - (1.0 - 2.0 * s) * c * (1.0 - c), hi = c + (2.0 * s - 1.0) * (D(c) - c); c = mix(c, mix(lo, hi, step(0.5, s)), uTint.a); }
    if (uVig > 0.0) { float d = length(p - vec2(${DW}.0 / 2.0, ${DH}.0 * 0.55)), a = uVig * clamp((d - ${DW}.0 * 0.3) / (${DW}.0 * 0.45), 0.0, 1.0); c = mix(c, vec3(4, 3, 12) / 255.0, a); }
    o = vec4(c, 1.0);
  }`;

  // Set up WebGL2 on a canvas. Returns null when there is none (the caller then uses the canvas 2D path).
  function gl2(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) return null;
    const R = { gl, lost: false, verts: new Float32Array(7 * 4096), hex: {} };
    function build() {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const prog = (vs, fs) => {
        const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
        const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
        for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
        return { p, u };
      };
      R.P = { light: prog(VS, FS_LIGHT), mask: prog(VS, FS_MASK), copy: prog(VS, FS_COPY), bright: prog(VS, FS_BRIGHT), comp: prog(VS, FS_COMP), add: prog(VS_ADD, FS_ADD), fin: prog(VS, FS_FINAL) };
      R.vao = gl.createVertexArray(); gl.bindVertexArray(R.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      R.addVao = gl.createVertexArray(); gl.bindVertexArray(R.addVao); R.addBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, R.addBuf);
      gl.bufferData(gl.ARRAY_BUFFER, R.verts.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 28, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 8);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 28, 24);
      gl.bindVertexArray(R.vao);
      const tex = (w, h, internal, fmt, type, filter) => {
        const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, internal, w, h);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t;
      };
      const target = (w, h, filter, internal) => { w = Math.round(w); h = Math.round(h); const t = tex(w, h, internal || gl.RGBA8, 0, 0, filter); const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return { t, fb, w, h }; };
      const L = gl.LINEAR, N = gl.NEAREST;
      R.T = {
        col: tex(W, H, gl.RGB32F, 0, 0, N), emit: tex(W, H, gl.R8UI, 0, 0, N), depth: tex(W, H, gl.R32F, 0, 0, N),
        lit: target(W, H, N), mask: target(W / 4, H / 4, L, gl.R8),
        b1: target(W / 3, H / 3, L), b2: target(W / 7, H / 7, L),
        bright: target(W / 2, H / 2, L), g1: target(W / 4, H / 4, L), g2: target(W / 10, H / 10, L), big: target(DW, DH, N),
      };
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      R.lightU = new Float32Array(MAXL * 4); R.colU = new Float32Array(MAXL * 3);
    }
    build();
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); R.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { build(); R.lost = false; });
    R.draw = (frame, opts) => draw(R, frame, opts || {});
    return R;
  }

  const hex = (R, h) => R.hex[h] || (R.hex[h] = [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);

  // frame: what HD2D.render(..., { raw: true }) returned. opts: t (seconds), low (no camera effects)
  function draw(R, frame, opts) {
    if (R.lost) return false;
    const gl = R.gl, P = R.P, T = R.T, S = frame.scene, look = frame.look, Lk = look.light, post = opts.low ? null : look.post, t = opts.t || 0;
    const run = (prog, tgt, setup) => { gl.useProgram(prog.p); gl.bindFramebuffer(gl.FRAMEBUFFER, tgt ? tgt.fb : null); gl.viewport(0, 0, tgt ? tgt.w : DW, tgt ? tgt.h : DH); if (setup) setup(prog.u); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); };
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };
    gl.bindVertexArray(R.vao); gl.disable(gl.BLEND); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    // the unlit picture: colour, what glows, and how far away things are
    bind(0, T.col); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGB, gl.FLOAT, S.col);
    bind(1, T.emit); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED_INTEGER, gl.UNSIGNED_BYTE, S.emit);
    bind(2, T.depth); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RED, gl.FLOAT, S.depth);
    // lighting
    const nl = Math.min(MAXL, S.lights.length);
    for (let i = 0; i < nl; i++) { const l = S.lights[i]; R.lightU[i * 4] = l.x; R.lightU[i * 4 + 1] = l.y; R.lightU[i * 4 + 2] = l.r; R.lightU[i * 4 + 3] = l.i; R.colU[i * 3] = l.c[0] / 255; R.colU[i * 3 + 1] = l.c[1] / 255; R.colU[i * 3 + 2] = l.c[2] / 255; }
    run(P.light, T.lit, u => { gl.uniform1i(u.uCol, 0); gl.uniform1i(u.uEmit, 1); gl.uniform1i(u.uN, nl); gl.uniform4fv(u.uL, R.lightU); gl.uniform3fv(u.uC, R.colU); gl.uniform1f(u.uAmb, Lk.ambient); gl.uniform1f(u.uGain, Lk.gain); gl.uniform1f(u.uSteps, Lk.steps); });
    // depth of field
    const dof = post && post.dof;
    if (dof) {
      bind(2, T.depth);
      run(P.mask, T.mask, u => { gl.uniform1i(u.uDepth, 2); gl.uniform1f(u.uFoc, frame.focus); gl.uniform1f(u.uClear, dof.clear); gl.uniform1f(u.uRamp, dof.ramp); gl.uniform1f(u.uBg, dof.bg); });
      bind(0, T.lit.t); run(P.copy, T.b1, u => { gl.uniform1i(u.uT, 0); gl.uniform2f(u.uSize, T.b1.w, T.b1.h); });
      bind(0, T.b1.t); run(P.copy, T.b2, u => { gl.uniform1i(u.uT, 0); gl.uniform2f(u.uSize, T.b2.w, T.b2.h); });
    }
    // bloom
    if (post && post.bloom) {
      bind(0, T.lit.t); run(P.bright, T.bright, u => { gl.uniform1i(u.uT, 0); gl.uniform1f(u.uThr, post.thr); });
      bind(0, T.bright.t); run(P.copy, T.g1, u => { gl.uniform1i(u.uT, 0); gl.uniform2f(u.uSize, T.g1.w, T.g1.h); });
      bind(0, T.g1.t); run(P.copy, T.g2, u => { gl.uniform1i(u.uT, 0); gl.uniform2f(u.uSize, T.g2.w, T.g2.h); });
    }
    bind(0, T.lit.t); bind(1, T.b2.t); bind(2, T.mask.t); bind(3, T.g1.t); bind(4, T.g2.t);
    const sun = post && post.flare && frame.sun;
    run(P.comp, T.big, u => {
      gl.uniform1i(u.uLit, 0); gl.uniform1i(u.uB2, 1); gl.uniform1i(u.uMask, 2); gl.uniform1i(u.uG1, 3); gl.uniform1i(u.uG2, 4);
      gl.uniform1f(u.uDof, dof ? 1 : 0); gl.uniform1f(u.uBloom, (post && post.bloom) || 0); gl.uniform1f(u.uFlare, sun ? 1 : 0); gl.uniform2f(u.uSun, sun ? sun[0] * DS : 0, sun ? sun[1] * DS : 0);
    });
    // light shafts and dust
    if (post) {
      let v = R.verts, n = 0;
      const V = (x, y, c, a, size) => { if (n + 7 > v.length) { const w = new Float32Array(v.length * 2); w.set(v); v = R.verts = w; } v[n++] = x; v[n++] = y; v[n++] = c[0] / 255; v[n++] = c[1] / 255; v[n++] = c[2] / 255; v[n++] = a; v[n++] = size || 0; };
      const quad = (pts, color, a) => { for (const k of [0, 1, 2, 0, 2, 3]) V(pts[k][0], pts[k][1], color, k < 2 ? a : 0); };
      const fan = (cx, cy, ang, h, L, color, a) => { V(cx, cy, color, a); V(cx + Math.cos(ang - h) * L, cy + Math.sin(ang - h) * L, color, 0); V(cx + Math.cos(ang + h) * L, cy + Math.sin(ang + h) * L, color, 0); };
      for (const r of frame.shafts) {
        const color = r.color || [255, 220, 170], a0 = r.a === undefined ? 0.12 : r.a;
        if (r.kind === 'window') {
          const k0 = r.n || 6;
          for (let k = 0; k < k0; k++) { const x0 = r.x0 + (r.x1 - r.x0) * (k + 0.2) / k0 + 2 * Math.sin(t * 0.3 + k), w = 3 + 5 * HD.hash(k, 1, 1), a = a0 * (0.8 + 0.2 * Math.sin(t * 0.9 + k * 1.7)); quad([[x0 * DS, r.y0 * DS], [(x0 + w) * DS, r.y0 * DS], [(x0 + w + r.slant + 9) * DS, r.y1 * DS], [(x0 + r.slant) * DS, r.y1 * DS]], color, a); }
        } else if (r.kind === 'cone') {
          quad([[(r.x - r.w0) * DS, r.y * DS], [(r.x + r.w0) * DS, r.y * DS], [(r.x + r.w1) * DS, r.y1 * DS], [(r.x - r.w1) * DS, r.y1 * DS]], color, a0 * (r.flicker ? 0.85 + 0.15 * Math.sin(t * 13 + r.x) : 1));
        } else if (r.kind === 'sun') {
          const k0 = r.n || 7, from = r.from || 0.35, to = r.to || 1.25;
          for (let k = 0; k < k0; k++) fan(r.x * DS, r.y * DS, from + (to - from) * (k + 0.5) / k0 + 0.02 * Math.sin(t * 0.4 + k), 0.02 + 0.025 * HD.hash(k, 2, 2), DW * 1.3, color, a0 * (0.7 + 0.3 * Math.sin(t * 0.7 + k * 2)));
        } else if (r.kind === 'sweep') fan(r.x * DS, r.y * DS, Math.PI * 0.72 + Math.sin(t * (r.speed || 1.4)) * 0.45, 0.13, DW * 1.1, color, a0);
      }
      const nTri = n / 7;
      if (post.dust) for (let i = 0; i < post.dust.n; i++) {
        const x = ((HD.hash(i, 1, 7) + 0.012 * Math.sin(t * 0.4 + i)) % 1) * DW, y = (((HD.hash(i, 2, 7) - t * 0.01 * (0.3 + HD.hash(i, 3, 7))) % 1) + 1) % 1 * DH;
        V(x, y, post.dust.color, 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 2.1)), (0.6 + 1.6 * HD.hash(i, 4, 7)) * DW / 960);
      }
      const nAll = n / 7;
      if (nAll) {
        gl.useProgram(P.add.p); gl.bindFramebuffer(gl.FRAMEBUFFER, T.big.fb); gl.viewport(0, 0, DW, DH);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        gl.bindVertexArray(R.addVao); gl.bindBuffer(gl.ARRAY_BUFFER, R.addBuf);
        if (v.byteLength > gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)) gl.bufferData(gl.ARRAY_BUFFER, v.byteLength, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, v, 0, n);
        if (nTri) gl.drawArrays(gl.TRIANGLES, 0, nTri);
        if (nAll > nTri) gl.drawArrays(gl.POINTS, nTri, nAll - nTri);
        gl.disable(gl.BLEND); gl.bindVertexArray(R.vao);
      }
    }
    // fog, tint and vignette, onto the page
    bind(0, T.big.t);
    run(P.fin, null, u => {
      gl.uniform1i(u.uT, 0);
      const f = post && post.fog; gl.uniform4f(u.uFog, f ? f.color[0] / 255 : 0, f ? f.color[1] / 255 : 0, f ? f.color[2] / 255 : 0, f ? f.a : 0);
      const ti = post && post.tint, tc = ti ? hex(R, ti.color) : [0, 0, 0]; gl.uniform4f(u.uTint, tc[0], tc[1], tc[2], ti ? Math.min(1, ti.a * 2.5) : 0);
      gl.uniform1f(u.uVig, (post && post.vignette) || 0);
    });
    return true;
  }

  // The room's background drawn by hd2d-worker.js. cache is the same object handed to HD2D.render as opts.cache; pass the returned
  // refresh as opts.refresh. While a newer background is on its way the last one is shown, so the main thread never waits.
  // Returns null if a worker cannot be made (the background is then drawn in place, as before).
  function backdrop(def, cache, name) {
    let worker = null, busy = false;
    try {
      const gameSrc = Array.from(root.document.scripts).map(s => s.src).find(src => /\/game\.js(\?|$)/.test(src));
      const base = Array.from(root.document.scripts).map(s => s.src).find(src => /\/hd2d\.js(\?|$)/.test(src));
      if (!gameSrc || !base) return null;
      worker = new root.Worker(new URL('hd2d-worker.js', base));
      worker.postMessage({ type: 'init', name, scripts: [new URL('adventure.js', base).href, base, gameSrc] });
    } catch (e) { return null; }
    worker.onmessage = e => {
      const m = e.data; busy = false;
      if (m.type !== 'back') return;
      if (m.key !== cache.key) { worker.postMessage({ type: 'recycle', snap: m.snap }, [m.snap.col.buffer, m.snap.emit.buffer, m.snap.depth.buffer, m.snap.stamp.buffer]); return; } // the room moved on
      const old = cache.snap;
      cache.snap = m.snap; cache.t = m.t; cache.own = true;
      if (old) worker.postMessage({ type: 'recycle', snap: old }, [old.col.buffer, old.emit.buffer, old.depth.buffer, old.stamp.buffer]);
    };
    worker.onerror = () => { worker = null; busy = false; };
    return (g, key, t) => {
      if (!worker || busy) return;
      busy = true;
      worker.postMessage({ type: 'draw', key, t, step: g.step, state: g.state });
    };
  }

  HD.gl = gl2;
  HD.backdrop = backdrop;
})(window);
