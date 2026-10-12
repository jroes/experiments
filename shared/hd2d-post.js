/*
 * The camera for HD-2D pictures (see hd2d.js): takes a lit frame and puts it on the page canvas with depth of field,
 * bloom, light shafts, dust in the air, fog, a colour tint and a vignette. Browser only: it uses canvas compositing.
 * With low set, the frame goes on as plain pixels and nothing else, for slow phones.
 */
(function (root) {
  'use strict';
  const HD = root.HD2D;
  const DS = HD.DW / 160; // display pixels per world unit
  const mk = (w, h) => { const c = root.document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  const c2 = cv => cv.getContext('2d');
  const rgba = (c, a) => 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + Math.max(0, a) + ')';
  const hexRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  let fx = null;
  function canvases() {
    if (fx) return fx;
    const W = HD.W, H = HD.H;
    fx = { pix: mk(W, H), mask: mk(W / 4, H / 4), bright: mk(W / 2, H / 2), b1: mk(W / 3, H / 3), b2: mk(W / 7, H / 7), tmp: mk(HD.DW, HD.DH), g1: mk(W / 4, H / 4), g2: mk(W / 10, H / 10) };
    fx.pixImg = c2(fx.pix).createImageData(W, H); fx.maskImg = c2(fx.mask).createImageData(W / 4, H / 4); fx.brightImg = c2(fx.bright).createImageData(W / 2, H / 2);
    return fx;
  }
  function shrink(src, dst) { const g = c2(dst); g.imageSmoothingEnabled = true; g.clearRect(0, 0, dst.width, dst.height); g.drawImage(src, 0, 0, dst.width, dst.height); }
  function quad(ctx, pts, grad) { ctx.fillStyle = grad; ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]); ctx.closePath(); ctx.fill(); }
  function fall(ctx, y0, y1, color, a) { const g = ctx.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0)); return g; }

  // light shafts, in world units: window (beams falling from a window), cone (from a lamp), sun (a fan of beams from a point), sweep (a turning beacon)
  function shafts(ctx, list, t) {
    for (const r of list) {
      const color = r.color || [255, 220, 170], a0 = r.a === undefined ? 0.12 : r.a;
      if (r.kind === 'window') {
        const n = r.n || 6;
        for (let k = 0; k < n; k++) {
          const x0 = r.x0 + (r.x1 - r.x0) * (k + 0.2) / n + 2 * Math.sin(t * 0.3 + k), w = 3 + 5 * HD.hash(k, 1, 1), a = a0 * (0.8 + 0.2 * Math.sin(t * 0.9 + k * 1.7));
          quad(ctx, [[x0 * DS, r.y0 * DS], [(x0 + w) * DS, r.y0 * DS], [(x0 + w + r.slant + 9) * DS, r.y1 * DS], [(x0 + r.slant) * DS, r.y1 * DS]], fall(ctx, r.y0 * DS, r.y1 * DS, color, a));
        }
      } else if (r.kind === 'cone') {
        const a = a0 * (r.flicker ? 0.85 + 0.15 * Math.sin(t * 13 + r.x) : 1);
        quad(ctx, [[(r.x - r.w0) * DS, r.y * DS], [(r.x + r.w0) * DS, r.y * DS], [(r.x + r.w1) * DS, r.y1 * DS], [(r.x - r.w1) * DS, r.y1 * DS]], fall(ctx, r.y * DS, r.y1 * DS, color, a));
      } else if (r.kind === 'sun') {
        const cx = r.x * DS, cy = r.y * DS, L = HD.DW * 1.3, n = r.n || 7;
        for (let k = 0; k < n; k++) {
          const ang = (r.from || 0.35) + ((r.to || 1.25) - (r.from || 0.35)) * (k + 0.5) / n + 0.02 * Math.sin(t * 0.4 + k), h = 0.02 + 0.025 * HD.hash(k, 2, 2);
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, L); g.addColorStop(0, rgba(color, a0 * (0.7 + 0.3 * Math.sin(t * 0.7 + k * 2)))); g.addColorStop(1, rgba(color, 0));
          quad(ctx, [[cx, cy], [cx + Math.cos(ang - h) * L, cy + Math.sin(ang - h) * L], [cx + Math.cos(ang + h) * L, cy + Math.sin(ang + h) * L]], g);
        }
      } else if (r.kind === 'sweep') {
        const cx = r.x * DS, cy = r.y * DS, ang = Math.PI * 0.72 + Math.sin(t * (r.speed || 1.4)) * 0.45, h = 0.13, L = HD.DW * 1.1;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, L); g.addColorStop(0, rgba(color, a0)); g.addColorStop(1, rgba(color, 0));
        quad(ctx, [[cx, cy], [cx + Math.cos(ang - h) * L, cy + Math.sin(ang - h) * L], [cx + Math.cos(ang + h) * L, cy + Math.sin(ang + h) * L]], g);
      }
    }
  }

  // frame: what HD2D.render returned. opts: t (seconds), low (plain pixels only)
  function post(ctx, frame, opts) {
    const f = canvases(), W = frame.W, H = frame.H, DW = HD.DW, DH = HD.DH, P = frame.look.post, t = opts.t || 0;
    f.pixImg.data.set(frame.rgba); c2(f.pix).putImageData(f.pixImg, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(f.pix, 0, 0, DW, DH);
    if (opts.low || !P) { ctx.restore(); return; }
    ctx.imageSmoothingEnabled = true;
    // depth of field: a blurred copy, shown above and below the hero and over the far background
    if (P.dof) {
      const m = f.maskImg.data, MW = W / 4, MH = H / 4, d = P.dof, foc = frame.focus;
      for (let y = 0; y < MH; y++) {
        const a0 = Math.max(0, Math.min(1, (Math.abs((y + 0.5) / MH - foc) - d.clear) / d.ramp));
        for (let x = 0; x < MW; x++) { const far = frame.depth[(y * 4 + 2) * W + x * 4 + 2] < 0.13; m[(y * MW + x) * 4 + 3] = 255 * (far ? Math.max(a0, d.bg) : a0); }
      }
      c2(f.mask).putImageData(f.maskImg, 0, 0);
      shrink(f.pix, f.b1); shrink(f.b1, f.b2);
      const tg = c2(f.tmp); tg.globalCompositeOperation = 'source-over'; tg.imageSmoothingEnabled = true; tg.clearRect(0, 0, DW, DH);
      tg.drawImage(f.b2, 0, 0, DW, DH); tg.globalCompositeOperation = 'destination-in'; tg.drawImage(f.mask, 0, 0, DW, DH); tg.globalCompositeOperation = 'source-over';
      ctx.drawImage(f.tmp, 0, 0);
    }
    // bloom: bright things glow (worked out at half size: it is blurred anyway)
    if (P.bloom) {
      const b = f.brightImg.data, px = frame.rgba, emit = frame.emit, thr = P.thr, BW = W / 2, BH = H / 2;
      for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
        const i = (y * 2) * W + x * 2, o = (y * BW + x) * 4;
        const r = px[i * 4], g = px[i * 4 + 1], bl = px[i * 4 + 2], l = (0.3 * r + 0.59 * g + 0.11 * bl) / 255;
        const k = emit[i] === 1 ? 1 : Math.max(0, (l - thr) / (1 - thr));
        b[o] = r * k; b[o + 1] = g * k; b[o + 2] = bl * k; b[o + 3] = 255;
      }
      c2(f.bright).putImageData(f.brightImg, 0, 0); shrink(f.bright, f.g1); shrink(f.g1, f.g2);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = P.bloom;
      ctx.drawImage(f.g1, 0, 0, DW, DH); ctx.drawImage(f.g2, 0, 0, DW, DH); ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    shafts(ctx, frame.shafts, t);
    if (P.flare && frame.sun) {
      const sx = frame.sun[0] * DS, sy = frame.sun[1] * DS, warm = [255, 200, 120];
      let g = ctx.createRadialGradient(sx, sy, 0, sx, sy, DW * 0.3); g.addColorStop(0, rgba(warm, 0.42)); g.addColorStop(1, rgba(warm, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH);
      for (const [k, rr, a] of [[0.35, 0.03, 0.12], [0.7, 0.015, 0.18], [1.15, 0.05, 0.08], [1.5, 0.022, 0.12]]) {
        const x = sx + (DW / 2 - sx) * 2 * k, y = sy + (DH / 2 - sy) * 2 * k, R = rr * DW;
        g = ctx.createRadialGradient(x, y, 0, x, y, R); g.addColorStop(0, rgba([255, 230, 200], a)); g.addColorStop(0.7, rgba([255, 170, 120], a * 0.6)); g.addColorStop(1, rgba([255, 170, 120], 0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (P.dust) for (let i = 0; i < P.dust.n; i++) {
      const x = ((HD.hash(i, 1, 7) + 0.012 * Math.sin(t * 0.4 + i)) % 1) * DW, y = (((HD.hash(i, 2, 7) - t * 0.01 * (0.3 + HD.hash(i, 3, 7))) % 1) + 1) % 1 * DH;
      const a = 0.12 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.5 + i * 2.1)), R = (0.6 + 1.6 * HD.hash(i, 4, 7)) * DW / 960;
      ctx.fillStyle = rgba(P.dust.color, a); ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
    }
    if (P.fog) { ctx.globalCompositeOperation = 'screen'; const g = ctx.createLinearGradient(0, 0.55 * DH, 0, DH); g.addColorStop(0, rgba(P.fog.color, 0)); g.addColorStop(1, rgba(P.fog.color, P.fog.a)); ctx.fillStyle = g; ctx.fillRect(0, 0.55 * DH, DW, 0.45 * DH); }
    if (P.tint) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = Math.min(1, P.tint.a * 2.5); ctx.fillStyle = rgba(hexRgb(P.tint.color), 1); ctx.fillRect(0, 0, DW, DH); ctx.globalAlpha = 1; }
    if (P.vignette) { ctx.globalCompositeOperation = 'source-over'; const g = ctx.createRadialGradient(DW / 2, DH * 0.55, DW * 0.3, DW / 2, DH * 0.55, DW * 0.75); g.addColorStop(0, 'rgba(4,3,12,0)'); g.addColorStop(1, 'rgba(4,3,12,' + P.vignette + ')'); ctx.fillStyle = g; ctx.fillRect(0, 0, DW, DH); }
    ctx.restore();
  }

  HD.post = post;
})(window);
