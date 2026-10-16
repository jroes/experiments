/*
 * Jetfall renderer, part two: trees, bushes and their foliage. Adds methods to JFRender.Renderer.
 *
 *  - shapes come from vegetation.js (made in code, no files); bark is drawn by the mesh shader (material kind -5),
 *    foliage by its own shader: cards cut out by the foliage texture, swaying in the wind, lit as a soft ball with
 *    light coming through the leaves when you look toward the sun
 *  - placement comes from JFVeg.plant, once per map, bucketed into 256 m chunks; each frame a chunk is skipped when it
 *    is behind the camera or past the fog, and drawn with simpler shapes past LOD_DIST
 *  - the shadow maps get the chunks near their centre only
 */
(function (root) {
  'use strict';
  const JF = root.JF, R = root.JFRender;
  const { COMMON, compile, trs, INST_FLOATS } = R;
  const CHUNK = 256, LOD_DIST = 230;

  const FOL_VS = `#version 300 es
  layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor;
  layout(location=2) in vec4 aM0; layout(location=3) in vec4 aM1; layout(location=4) in vec4 aM2; layout(location=5) in vec4 aM3;
  layout(location=6) in vec4 aCol; layout(location=7) in vec4 aT;
  uniform mat4 uVP; uniform float uTime, uWind;
  out vec3 vPos; out vec3 vNor; out vec3 vUV; out float vAO; out vec3 vTint;
  void main() {
    mat4 m = mat4(aM0, aM1, aM2, aM3);
    vec4 wp = m * vec4(aPos, 1.0);
    float s = length(aM1.xyz);
    float ph = aM3.x * 0.031 + aM3.z * 0.017;
    // the whole tree leans with the wind, more at the top; leaves flutter on their own
    float bend = aPos.y * aPos.y;
    wp.xyz += vec3(sin(uTime * 0.9 + ph), 0.0, cos(uTime * 0.7 + ph * 1.3)) * bend * s * 0.012 * uWind;
    wp.xyz += vec3(sin(uTime * 3.1 + ph + aPos.x * 31.0), sin(uTime * 3.7 + aPos.z * 29.0) * 0.5, cos(uTime * 2.9 + aPos.y * 27.0)) * 0.03 * uWind * min(s, 3.0) * 0.4;
    vPos = wp.xyz; vNor = normalize(mat3(m) * aNor); vUV = aT.xyz; vAO = aT.w; vTint = aCol.rgb;
    gl_Position = uVP * wp;
  }`;
  const FOL_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform mediump sampler2DArray uTexC;
  uniform float uSnowy, uCardSize;
  in vec3 vPos; in vec3 vNor; in vec3 vUV; in float vAO; in vec3 vTint; out vec4 o;
  void main() {
    vec4 tx = texture(uTexC, vUV);
    // smaller mip levels average the cut-out away; push the edge out as they do, so far trees stay full
    vec2 g = vec2(length(dFdx(vUV.xy)), length(dFdy(vUV.xy))) * uCardSize;
    float mip = max(0.0, log2(max(g.x, g.y)));
    if (tx.a * (1.0 + mip * 0.32) < 0.5) discard;
    vec3 n = normalize(vNor);
    vec3 col = tx.rgb * vTint;
    col = mix(col, vec3(0.86, 0.9, 0.95), smoothstep(0.1, 0.55, n.y) * uSnowy * 0.85);
    float sh = shadowAt(vPos, n) * groundShade(vPos) * cloudAt(vPos.xz);
    vec3 v = normalize(uCam - vPos);
    float diff = clamp(dot(n, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
    float trans = pow(max(dot(-v, uSunDir), 0.0), 5.0) * 0.9 * (1.0 - uSnowy * 0.6);
    vec3 lit = col * (uSunCol * (diff * vAO + trans) * sh * 1.1 + hemi(n) * (0.35 + 0.65 * vAO) + pointLights(vPos, n));
    lit = fogMix(lit, vPos);
    o = vec4(outc(lit), 0.0);
  }`;
  const FOLS_VS = `#version 300 es
  layout(location=0) in vec3 aPos;
  layout(location=2) in vec4 aM0; layout(location=3) in vec4 aM1; layout(location=4) in vec4 aM2; layout(location=5) in vec4 aM3;
  layout(location=7) in vec4 aT;
  uniform mat4 uVP; uniform float uTime, uWind;
  out vec3 vUV;
  void main() {
    mat4 m = mat4(aM0, aM1, aM2, aM3);
    vec4 wp = m * vec4(aPos, 1.0);
    float s = length(aM1.xyz), ph = aM3.x * 0.031 + aM3.z * 0.017;
    wp.xyz += vec3(sin(uTime * 0.9 + ph), 0.0, cos(uTime * 0.7 + ph * 1.3)) * aPos.y * aPos.y * s * 0.012 * uWind;
    vUV = aT.xyz;
    gl_Position = uVP * wp;
  }`;
  const FOLS_FS = `#version 300 es
  precision mediump float;
  uniform mediump sampler2DArray uTexC;
  in vec3 vUV;
  void main() { if (texture(uTexC, vUV).a < 0.45) discard; }`;

  const P = R.Renderer.prototype;

  // shapes, made once per context
  P.vegInit = function () {
    const gl = this.gl, V = root.JFVeg;
    this.progF = compile(gl, FOL_VS, FOL_FS);
    this.progFS = compile(gl, FOLS_VS, FOLS_FS);
    const bark = g => (g ? this.makeMesh(g) : null);
    const fol = g => (g ? this.makeFolMesh(g) : null);
    const fir = V.conifer(3, 0), firLo = V.conifer(3, 1), oak = V.broadleaf(5, 0), oakLo = V.broadleaf(5, 1), dead = V.deadTree(7), bushS = V.bush(9);
    this.vegShapes = {
      fir: { bark: bark(fir.bark), barkLo: bark(firLo.bark), fol: fol(fir.fol), folLo: fol(firLo.fol) },
      oak: { bark: bark(oak.bark), barkLo: bark(oakLo.bark), fol: fol(oak.fol), folLo: fol(oakLo.fol) },
      dead: { bark: bark(dead.bark), barkLo: null, fol: null, folLo: null },
      bush: { bark: null, barkLo: null, fol: fol(bushS.fol), folLo: null },
    };
    this.vegChunks = [];
  };

  P.makeFolMesh = function (g) {
    const gl = this.gl;
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const nv = g.P.length / 3, data = new Float32Array(nv * 10);
    for (let i = 0; i < nv; i++) {
      data.set(g.P.slice(i * 3, i * 3 + 3), i * 10); data.set(g.N.slice(i * 3, i * 3 + 3), i * 10 + 3); data.set(g.T.slice(i * 4, i * 4 + 4), i * 10 + 6);
    }
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12);
    gl.enableVertexAttribArray(7); gl.vertexAttribPointer(7, 4, gl.FLOAT, false, 40, 24);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(g.I), gl.STATIC_DRAW);
    for (let i = 0; i < 5; i++) { gl.enableVertexAttribArray(2 + i); gl.vertexAttribDivisor(2 + i, 1); }
    gl.bindVertexArray(null);
    return { vao, count: g.I.length };
  };

  // where the plants go for this map, at this quality
  P.buildVeg = function (world) {
    const gl = this.gl, V = root.JFVeg;
    for (const c of this.vegChunks || []) for (const k of Object.values(c.kinds)) { gl.deleteBuffer(k.bark); gl.deleteBuffer(k.fol); }
    this.vegChunks = [];
    this.vegFor = { world, q: this.q.veg };
    const look = world.def.look, veg = look.veg;
    if (!V || !veg || !this.q.veg) return;
    const p = V.plant(world, (x, z) => this.landHeight(x, z));
    const keep = (i, k) => ((Math.imul(i + 1, 2654435761) >>> 0) / 4294967296) < k;
    const list = p.trees.filter((t, i) => keep(i, this.q.veg)).concat(this.q.veg >= 0.5 ? p.bushes.filter((b, i) => keep(i + 99991, this.q.veg)) : []);
    const tint = veg.tint || [1, 1, 1], oakTint = veg.oakTint || [1.05, 1.0, 0.82], bushTint = veg.bushTint || oakTint;
    const barkCol = { fir: veg.bark || [0.3, 0.23, 0.17], oak: veg.bark || [0.36, 0.32, 0.27], dead: veg.bark || [0.4, 0.36, 0.31] };
    const chunks = new Map();
    const rng = JF.mulberry(world.def.seed * 31 + 7);
    for (const t of list) {
      const key = Math.floor(t.x / CHUNK) + ',' + Math.floor(t.z / CHUNK);
      let c = chunks.get(key);
      if (!c) { c = { cx: (Math.floor(t.x / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(t.z / CHUNK) + 0.5) * CHUNK, minY: Infinity, maxY: -Infinity, items: {} }; chunks.set(key, c); }
      c.minY = Math.min(c.minY, t.y); c.maxY = Math.max(c.maxY, t.y + t.s);
      (c.items[t.kind] = c.items[t.kind] || []).push(t);
    }
    for (const c of chunks.values()) {
      const kinds = {};
      for (const [kind, items] of Object.entries(c.items)) {
        const shape = this.vegShapes[kind];
        const n = items.length;
        const bark = new Float32Array(n * INST_FLOATS), fol = new Float32Array(n * INST_FLOATS);
        items.forEach((t, i) => {
          const o = i * INST_FLOATS, v = 0.82 + rng() * 0.36;
          trs(bark, o, t.x, t.y, t.z, t.yaw, t.tilt, t.s, t.s, t.s);
          fol.set(bark.subarray(o, o + 16), o);
          const bc = barkCol[kind] || barkCol.oak;
          bark.set([bc[0] * v, bc[1] * v, bc[2] * v, 1, 0, -5, 0, 0.1], o + 16);
          const tc = kind === 'fir' ? tint : kind === 'bush' ? bushTint : oakTint;
          const hue = 0.92 + rng() * 0.16;
          fol.set([tc[0] * v * hue, tc[1] * v, tc[2] * v / hue, 1, 0, 0, 0, 0], o + 16);
        });
        const mk = d => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW); return b; };
        kinds[kind] = { n, bark: shape.bark ? mk(bark) : null, fol: shape.fol ? mk(fol) : null };
      }
      this.vegChunks.push({ cx: c.cx, cz: c.cz, cy: (c.minY + c.maxY) / 2, r: CHUNK * 0.75 + (c.maxY - c.minY) / 2 + 10, kinds });
    }
  };

  // draw the plants. mode 'main' (setCommon given) or 'shadow' (around center, ext metres)
  P.drawVeg = function (mode, vp, setCommon, center, ext) {
    if (!this.vegChunks || !this.vegChunks.length) return;
    const gl = this.gl, cam = this.camPos, time = this.time || 0, look = this.look;
    const wind = (look.veg && look.veg.wind != null) ? look.veg.wind : 1;
    const texOn = !!(this.tex && this.tex.C);
    const planes = mode === 'main' ? frustum(vp) : null;
    const maxD = look.fogDist * 1.25;
    const draws = [];
    for (const c of this.vegChunks) {
      if (mode === 'main') {
        const d = Math.hypot(c.cx - cam[0], c.cy - cam[1], c.cz - cam[2]) - c.r;
        if (d > maxD) continue;
        if (!sphereIn(planes, c.cx, c.cy, c.cz, c.r)) continue;
        draws.push({ c, lo: d > LOD_DIST });
      } else {
        if (Math.max(Math.abs(c.cx - center[0]), Math.abs(c.cz - center[2])) > ext + CHUNK * 0.6) continue;
        draws.push({ c, lo: true });
      }
    }
    if (!draws.length) return;
    const ptrs = buf => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let i = 0; i < 6; i++) gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
    };
    const folPtrs = buf => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      for (let i = 0; i < 5; i++) gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
    };
    // bark
    if (mode === 'main') {
      const Mp = this.progM;
      gl.useProgram(Mp.p); setCommon(Mp);
      gl.uniformMatrix4fv(Mp.u.uVP, false, vp);
      gl.uniform1f(Mp.u.uGlass, 0); gl.uniform1f(Mp.u.uBox, 0);
    } else {
      gl.useProgram(this.progS.p);
      gl.uniformMatrix4fv(this.progS.u.uVP, false, vp);
    }
    for (const { c, lo } of draws) {
      for (const [kind, k] of Object.entries(c.kinds)) {
        const sh = this.vegShapes[kind], m = (lo && sh.barkLo) || sh.bark;
        if (!m || !k.bark) continue;
        gl.bindVertexArray(m.vao); ptrs(k.bark);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, k.n);
      }
    }
    // foliage
    if (!texOn) { gl.bindVertexArray(null); return; }
    const Fp = mode === 'main' ? this.progF : this.progFS;
    gl.useProgram(Fp.p);
    if (mode === 'main') {
      setCommon(Fp);
      gl.uniform1f(Fp.u.uSnowy, look.veg && look.veg.snowy ? 1 : 0);
      gl.uniform1f(Fp.u.uCardSize, 512);
    } else {
      gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex.C); gl.uniform1i(Fp.u.uTexC, 5); gl.activeTexture(gl.TEXTURE0);
    }
    gl.uniformMatrix4fv(Fp.u.uVP, false, vp);
    gl.uniform1f(Fp.u.uTime, time); gl.uniform1f(Fp.u.uWind, wind);
    gl.disable(gl.CULL_FACE);
    for (const { c, lo } of draws) {
      for (const [kind, k] of Object.entries(c.kinds)) {
        const sh = this.vegShapes[kind], m = (lo && sh.folLo) || sh.fol;
        if (!m || !k.fol) continue;
        if (mode === 'shadow' && kind === 'bush') continue;
        gl.bindVertexArray(m.vao); folPtrs(k.fol);
        gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, k.n);
      }
    }
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
  };

  // the four side planes of a view-projection matrix (column major)
  function frustum(m) {
    const row = k => [m[k], m[4 + k], m[8 + k], m[12 + k]];
    const r0 = row(0), r1 = row(1), r3 = row(3);
    return [[r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]], [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]],
      [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]], [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]]];
  }
  function sphereIn(planes, x, y, z, r) {
    for (const p of planes) { const l = Math.hypot(p[0], p[1], p[2]); if ((p[0] * x + p[1] * y + p[2] * z + p[3]) / l < -r) return false; }
    return true;
  }
})(window);
