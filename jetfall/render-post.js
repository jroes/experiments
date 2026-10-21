/*
 * Jetfall renderer, part three: ambient occlusion and volumetric fog. Adds methods to JFRender.Renderer; render.js
 * calls them when they are there (Balanced and Sharp only, like the rest of the post pass).
 *
 *  - the scene's depth is copied to a texture just before the first-person weapon draws (it clears depth)
 *  - ambient occlusion: at half size from that depth, a few samples in the hemisphere over each point, then blurred
 *    with a depth check so it does not bleed across edges
 *  - fog you can see light in: at half size, a ray from the eye to what the pixel shows (at most FOG_REACH metres),
 *    a few steps along it; each step asks the sun's shadow map (or, past it, the heightfield's sun texture) whether
 *    sunlight reaches it, so light comes through doorways, between trees and over ridges in shafts. Thicker near the
 *    ground, stirred by 3D noise, brighter toward the sun, and lit by explosions.
 *  - the final pass multiplies the picture by the occlusion and adds the fog (render.js FINAL_FS)
 */
(function (root) {
  'use strict';
  const R = root.JFRender;
  const { COMMON, compile, POST_VS } = R;
  const FOG_REACH = 280, FOG_STEPS = 22;

  const AO_FS = `#version 300 es
  precision highp float;
  uniform highp sampler2D uDepth; uniform mat4 uProj, uInvProj; uniform vec2 uTexel; uniform float uRadius;
  in vec2 vUv; out vec4 o;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  vec3 viewPos(vec2 uv) { float d = texture(uDepth, uv).r; vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
  void main() {
    float d = texture(uDepth, vUv).r;
    if (d >= 0.99999) { o = vec4(1.0); return; }
    vec3 p = viewPos(vUv);
    // the surface normal from the depth around this pixel (the smaller step on each side, so edges stay crisp)
    vec3 px1 = viewPos(vUv + vec2(uTexel.x, 0.0)) - p, px2 = p - viewPos(vUv - vec2(uTexel.x, 0.0));
    vec3 py1 = viewPos(vUv + vec2(0.0, uTexel.y)) - p, py2 = p - viewPos(vUv - vec2(0.0, uTexel.y));
    vec3 dx = abs(px1.z) < abs(px2.z) ? px1 : px2, dy = abs(py1.z) < abs(py2.z) ? py1 : py2;
    vec3 n = normalize(cross(dx, dy));
    float a = hash(gl_FragCoord.xy) * 6.2832;
    vec3 rv = vec3(cos(a), sin(a), 0.0);
    vec3 t = normalize(rv - n * dot(rv, n)), b = cross(n, t);
    float occ = 0.0;
    const int S = 10;
    float rad = uRadius * (1.0 + clamp(-p.z / 60.0, 0.0, 2.0));
    for (int i = 0; i < S; i++) {
      float fi = float(i);
      float r = fract(fi * 0.618 + hash(gl_FragCoord.xy + fi)) ;
      float ang = fi * 2.4;
      vec3 h = vec3(cos(ang) * sqrt(1.0 - r), sin(ang) * sqrt(1.0 - r), sqrt(r));
      float sc = mix(0.15, 1.0, (fi + 1.0) / float(S));
      vec3 s = p + (t * h.x + b * h.y + n * h.z) * rad * sc * sc;
      vec4 c = uProj * vec4(s, 1.0);
      vec2 suv = c.xy / c.w * 0.5 + 0.5;
      if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
      float sz = viewPos(suv).z;
      float range = smoothstep(0.0, 1.0, rad / abs(p.z - sz));
      occ += (sz >= s.z + 0.05 * rad ? 1.0 : 0.0) * range;
    }
    float ao = 1.0 - occ / float(S);
    ao = mix(1.0, ao, 1.0 - smoothstep(120.0, 220.0, -p.z));
    o = vec4(ao, ao, ao, 1.0);
  }`;
  const AOBLUR_FS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex; uniform highp sampler2D uDepth; uniform vec2 uTexel, uDir; uniform float uNear, uFar;
  in vec2 vUv; out vec4 o;
  float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
  void main() {
    float z0 = lin(texture(uDepth, vUv).r);
    float s = 0.0, w = 0.0;
    for (int i = -3; i <= 3; i++) {
      vec2 uv = vUv + uDir * uTexel * float(i) * 1.5;
      float z = lin(texture(uDepth, uv).r);
      float k = exp(-float(i * i) * 0.12) * (1.0 / (1.0 + abs(z - z0) / max(z0 * 0.02, 0.05)));
      s += texture(uTex, uv).r * k; w += k;
    }
    float ao = s / max(w, 1e-4);
    o = vec4(ao, ao, ao, 1.0);
  }`;
  const FOG_FS = `#version 300 es
  precision highp float;
  ${COMMON}
  uniform highp sampler2D uDepth; uniform mat4 uInvVP; uniform float uDensity, uFalloff, uReach;
  in vec2 vUv; out vec4 o;
  float phase(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
  float sunVis(vec3 p) {
    float v = groundShade(p);
    if (uShadowOn > 0.5) {
      vec4 sf = uShadowMatF * vec4(p, 1.0); vec3 c = sf.xyz * 0.5 + 0.5;
      float m = max(abs(c.x - 0.5), abs(c.y - 0.5)) * 2.0;
      if (m < 1.0 && c.z < 1.0) v *= mix(texture(uShadowF, vec3(c.xy, c.z - 0.002)), 1.0, smoothstep(0.8, 1.0, m));
    }
    return v;
  }
  void main() {
    float d = texture(uDepth, vUv).r;
    vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); wp /= wp.w;
    vec3 ray = wp.xyz - uCam; float dist = length(ray); vec3 dir = ray / max(dist, 1e-4);
    float L = min(d >= 0.99999 ? uReach : dist, uReach);
    float j = hash(gl_FragCoord.xy + fract(uTime * 13.7) * 91.0);
    float cosT = dot(dir, uSunDir);
    vec3 sunPh = uSunCol * (phase(cosT, 0.65) * 5.0 + 0.06);
    vec3 amb = mix(uFogCol, uAmb, 0.4) * 0.12;
    vec3 inS = vec3(0.0); float T = 1.0;
    float prev = 0.0;
    for (int i = 0; i < ${FOG_STEPS}; i++) {
      // steps bunch up near the eye, where shafts are sharpest
      float f = (float(i) + j) / float(${FOG_STEPS});
      float t = L * f * f;
      float dt = t - prev; prev = t;
      vec3 p = uCam + dir * t;
      float ground = hfAt(p.xz).x;
      float hgt = max(p.y - ground, 0.0);
      float dens = uDensity * exp(-hgt / uFalloff) * (0.45 + 1.1 * noise3(p * 0.045 + vec3(uTime * 0.25, 0.0, uTime * 0.15)));
      if (dens < 1e-6) continue;
      vec3 light = sunPh * sunVis(p) + amb + pointLights(p, -dir) * 0.6;
      float tr = exp(-dens * dt);
      inS += T * light * (1.0 - tr);
      T *= tr;
    }
    o = vec4(inS, T);
  }`;

  const P = R.Renderer.prototype;

  P.atmosInit = function () {
    const gl = this.gl;
    this.progAO = compile(gl, POST_VS, AO_FS);
    this.progAOB = compile(gl, POST_VS, AOBLUR_FS);
    this.progFog = compile(gl, POST_VS, FOG_FS);
  };

  // extra targets: the depth copy, and half-size occlusion (two, for the blur) and fog
  P.atmosTargets = function (T, W, H) {
    const gl = this.gl;
    const dt = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dt);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, W, H);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const dfb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, dfb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, dt, 0);
    const dok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const depth = { tex: dt, fb: dfb, w: W, h: H, ok: dok };
    T.all.push(depth);
    if (!dok) return;
    const hw = Math.max(1, W >> 1), hh = Math.max(1, H >> 1);
    const ao = this.target(hw, hh, gl.RGBA8, false), ao2 = this.target(hw, hh, gl.RGBA8, false);
    const fog = this.target(hw, hh, this.hdr ? gl.RGBA16F : gl.RGBA8, false);
    T.all.push(ao, ao2, fog);
    if (ao.ok && ao2.ok && fog.ok) T.atm = { depth, ao, ao2, fog, hw, hh };
  };

  // copy the scene's depth (from whatever is bound for reading) before the weapon clears it
  P.grabDepth = function (T, src, W, H) {
    if (!T.atm) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, src);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, T.atm.depth.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, src);
  };

  // occlusion and fog for this frame; returns their textures for the final pass, or null
  P.atmosPass = function (T, scene) {
    const A = T.atm;
    if (!A || !this.progAO) return null;
    const gl = this.gl, q = this.q, look = this.look, g = this.grade;
    const quad = (prog, target, set) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
      gl.viewport(0, 0, target.w, target.h);
      gl.useProgram(prog.p);
      set(prog.u);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const bindDepth = (U, unit) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, A.depth.tex); gl.uniform1i(U.uDepth, unit); };
    let aoTex = null, fogTex = null;
    if (q.ao) {
      const invProj = R.M4.inv(this.proj);
      quad(this.progAO, A.ao, U => {
        bindDepth(U, 0);
        gl.uniformMatrix4fv(U.uProj, false, this.proj); gl.uniformMatrix4fv(U.uInvProj, false, invProj);
        gl.uniform2f(U.uTexel, 1 / A.depth.w, 1 / A.depth.h); gl.uniform1f(U.uRadius, 1.4);
      });
      const blur = (src, dst, dx, dy) => quad(this.progAOB, dst, U => {
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, src.tex); gl.uniform1i(U.uTex, 1);
        bindDepth(U, 0);
        gl.uniform2f(U.uTexel, 1 / A.hw, 1 / A.hh); gl.uniform2f(U.uDir, dx, dy);
        gl.uniform1f(U.uNear, 0.12); gl.uniform1f(U.uFar, 6000);
      });
      blur(A.ao, A.ao2, 1, 0); blur(A.ao2, A.ao, 0, 1);
      aoTex = A.ao.tex;
    }
    if (q.fog && this.setCommonFn) {
      const vol = look.vol || {};
      quad(this.progFog, A.fog, U => {
        this.setCommonFn(this.progFog);
        bindDepth(U, 6);
        gl.uniformMatrix4fv(U.uInvVP, false, R.M4.inv(this.vp));
        gl.uniform1f(U.uDensity, (vol.density != null ? vol.density : 0.0016) * (g.vol != null ? g.vol : 1));
        gl.uniform1f(U.uFalloff, vol.falloff || 30);
        gl.uniform1f(U.uReach, FOG_REACH);
      });
      fogTex = A.fog.tex;
    }
    gl.activeTexture(gl.TEXTURE0);
    return { ao: aoTex, fog: fogTex };
  };
})(window);
