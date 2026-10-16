#!/usr/bin/env python3
"""
Bakes Jetfall's surface textures: tileable PBR sets made from noise, no photos, so they are our own.

Each material is three JPEGs in jetfall/tex/:
  <name>_a.jpg  albedo (the engine's colours, no gamma step, like every `look` colour)
  <name>_n.jpg  r, g = normal x, y (0.5 = flat), b = roughness
  <name>_h.jpg  height (for blending layers and a little ambient occlusion)
and jetfall/tex/manifest.json lists them in order with the mean albedo of each, which the renderer uses to tint a
material toward a map's own colours.

Everything is built in the frequency domain or on a wrapped grid, so every image tiles. Run:
  python3 tools/jetfall-textures.py            (1024 px, a minute or two)
  python3 tools/jetfall-textures.py --size 256 (quick look)
"""
import argparse, json, os
import numpy as np
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument('--size', type=int, default=1024)
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'jetfall', 'tex'))
ap.add_argument('--only', default='')
args = ap.parse_args()
N = args.size
os.makedirs(args.out, exist_ok=True)


# ---------- tileable noise ----------
def freqs(n):
    f = np.fft.fftfreq(n) * n
    fx, fy = np.meshgrid(f, f)
    return np.sqrt(fx * fx + fy * fy)


def norm01(a):
    a = a - a.min()
    m = a.max()
    return a / m if m > 0 else a


def fbm(seed, beta=2.0, lo=1.0, hi=None, aniso=None):
    """Noise with a 1/f^beta spectrum between frequencies lo and hi (in repeats per tile). Tiles exactly."""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((N, N))
    F = np.fft.fft2(w)
    f = np.fft.fftfreq(N) * N
    fx, fy = np.meshgrid(f, f)
    if aniso:
        fx = fx * aniso[0]
        fy = fy * aniso[1]
    r = np.sqrt(fx * fx + fy * fy)
    amp = np.where(r > 0, 1.0 / np.maximum(r, 1e-6) ** (beta / 2 + 0.5), 0)
    amp *= 1.0 / (1.0 + np.exp(-(r - lo) * 2.0))
    if hi:
        amp *= np.exp(-(r / hi) ** 2)
    return norm01(np.real(np.fft.ifft2(F * amp)))


def blur(a, sigma):
    """Gaussian blur that wraps (FFT)."""
    if sigma <= 0:
        return a
    r = freqs(N)
    g = np.exp(-2 * (np.pi * sigma * r / N) ** 2)
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., i]) * g)) for i in range(a.shape[2])], -1)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def sample(a, x, y):
    """Bilinear lookup with wrapping; x, y in pixels."""
    x0 = np.floor(x).astype(int); y0 = np.floor(y).astype(int)
    fx = x - x0; fy = y - y0
    x0 %= N; y0 %= N; x1 = (x0 + 1) % N; y1 = (y0 + 1) % N
    return (a[y0, x0] * (1 - fx) * (1 - fy) + a[y0, x1] * fx * (1 - fy) + a[y1, x0] * (1 - fx) * fy + a[y1, x1] * fx * fy)


YY, XX = np.mgrid[0:N, 0:N].astype(np.float64)


def warp(a, wx, wy, k):
    return sample(a, XX + (wx - 0.5) * k * N, YY + (wy - 0.5) * k * N)


def worley(seed, cells, jitter=0.9):
    """Cellular noise on a wrapped grid of `cells` x `cells`: distance to the nearest and second nearest point (in cell
    units), and a random value per nearest cell."""
    rng = np.random.default_rng(seed)
    pts = rng.random((cells, cells, 2)) * jitter + (1 - jitter) / 2
    val = rng.random((cells, cells))
    u = XX / N * cells
    v = YY / N * cells
    ci = np.floor(u).astype(int)
    cj = np.floor(v).astype(int)
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0); id1 = np.zeros((N, N))
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di; nj = cj + dj
            p = pts[nj % cells, ni % cells]
            dx = ni + p[..., 0] - u
            dy = nj + p[..., 1] - v
            d = np.sqrt(dx * dx + dy * dy)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            id1 = np.where(closer, val[nj % cells, ni % cells], id1)
            f1 = np.where(closer, d, f1)
    return f1, f2, id1


def ss(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    """a to b by t; a colour (3,) or image (H, W, 3) blended by a mask (H, W) gets the mask broadcast over channels."""
    if np.ndim(t) == 2 and (np.ndim(a) != 2 or np.ndim(b) != 2) and (np.shape(a)[-1:] == (3,) or np.shape(b)[-1:] == (3,)):
        t = t[..., None]
    return a + (b - a) * t


def col(c):
    return np.array(c, dtype=np.float64)


def normals(h, strength):
    """Normal from a height field (wrapped differences). strength = height range in pixels."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def cavity(h, sigma):
    """How much lower than its surroundings each pixel is: a cheap ambient occlusion."""
    return np.clip((blur(h, sigma) - h) * 4.0, 0, 1)


def save(name, albedo, height, rough, nstrength, manifest, scale, extra=None):
    albedo = np.clip(albedo, 0, 1)
    n = normals(height, nstrength)
    nimg = np.stack([n[..., 0] * 0.5 + 0.5, n[..., 1] * 0.5 + 0.5, np.clip(rough, 0, 1)], -1)
    q = 90
    Image.fromarray((albedo * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, name + '_a.jpg'), quality=q, optimize=True)
    Image.fromarray((nimg * 255 + 0.5).astype(np.uint8)).save(os.path.join(args.out, name + '_n.jpg'), quality=q, optimize=True)
    # the height only blends layers, so half size is plenty
    Image.fromarray((norm01(height) * 255 + 0.5).astype(np.uint8)).resize((N // 2, N // 2), Image.LANCZOS).save(os.path.join(args.out, name + '_h.jpg'), quality=q, optimize=True)
    entry = {'name': name, 'mean': [round(float(v), 4) for v in albedo.reshape(-1, 3).mean(0)], 'scale': scale}
    if extra:
        entry.update(extra)
    manifest.append(entry)
    print('  ', name, entry['mean'])


# ---------- materials ----------
# Each returns (albedo HxWx3, height HxW, roughness HxW, normal strength, metres per tile)

def mat_grass():
    # turf seen from above: short blades in many greens over dark soil, in clumps
    rng = np.random.default_rng(11)
    soil = fbm(1, 1.6, 2)
    base = lerp(col([0.16, 0.13, 0.08]), col([0.24, 0.2, 0.12]), soil)
    clump = fbm(2, 2.4, 2, 40)
    S = N * 3
    hi = Image.new('L', (N, N), 0)
    al = Image.fromarray((base * 255).astype(np.uint8))
    dh = ImageDraw.Draw(hi); da = ImageDraw.Draw(al)
    count = int(55000 * (N / 1024) ** 2)
    greens = [(70, 112, 34), (92, 128, 40), (110, 140, 52), (60, 96, 30), (128, 140, 60), (84, 120, 46), (140, 132, 70)]
    for i in range(count):
        x, y = rng.random() * N, rng.random() * N
        c = clump[int(y) % N, int(x) % N]
        if rng.random() > 0.35 + c * 0.9:
            continue
        a = rng.random() * np.pi * 2
        L = (6 + rng.random() * 14) * N / 1024
        x2, y2 = x + np.cos(a) * L, y + np.sin(a) * L
        g = greens[rng.integers(len(greens))]
        k = 0.75 + rng.random() * 0.5
        gc = tuple(int(min(255, v * k)) for v in g)
        hv = int(120 + rng.random() * 135)
        w = max(1, int(round((1.5 + rng.random() * 1.5) * N / 1024)))
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                if -30 < x + ox < N + 30 and -30 < y + oy < N + 30:
                    da.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=gc, width=w)
                    dh.line([(x + ox, y + oy), (x2 + ox, y2 + oy)], fill=hv, width=w)
    del S
    albedo = np.asarray(al).astype(np.float64) / 255
    h = np.asarray(hi).astype(np.float64) / 255
    h = blur(h, 0.7) * 0.8 + soil * 0.2
    albedo = albedo * (1 - 0.35 * cavity(h, 3)[..., None])
    # dry patches
    dry = ss(0.55, 0.8, fbm(3, 2.2, 1.5, 12))
    albedo = lerp(albedo, albedo * col([1.25, 1.1, 0.75]), dry * 0.6)
    rough = 0.82 - h * 0.12
    return albedo, h, rough, 6, 2.5


def mat_dirt():
    soil = fbm(21, 1.8, 2)
    fine = fbm(22, 0.6, 30)
    f1, f2, cid = worley(23, 22)
    stones = ss(0.34, 0.24, f1) * (cid > 0.6)
    f1b, _, cidb = worley(24, 60)
    pebbles = ss(0.3, 0.2, f1b) * (cidb > 0.65)
    h = soil * 0.45 + fine * 0.15 + stones * 0.6 * (0.6 + 0.4 * cid) + pebbles * 0.3
    albedo = lerp(col([0.3, 0.22, 0.14]), col([0.42, 0.32, 0.21]), soil)
    albedo = albedo * (0.85 + 0.3 * fine)[..., None]
    sc = lerp(col([0.3, 0.27, 0.24]), col([0.46, 0.42, 0.37]), (cid - 0.6) / 0.4)
    albedo = lerp(albedo, sc * (0.8 + 0.4 * fine)[..., None], stones * 0.85)
    albedo = lerp(albedo, col([0.4, 0.36, 0.3]), pebbles * 0.5)
    albedo = albedo * (1 - 0.45 * cavity(h, 4))[..., None]
    rough = 0.9 - stones * 0.15
    return albedo, h, rough, 10, 3.0


def mat_rock():
    w1, w2 = fbm(31, 2.2, 1), fbm(32, 2.2, 1)
    big = fbm(33, 2.0, 1.5)
    ridge = 1 - np.abs(fbm(34, 1.6, 3) * 2 - 1)
    strata = 0.5 + 0.5 * np.sin((YY / N * 9 + warp(big, w1, w2, 0.25) * 2.5) * 2 * np.pi)
    f1, f2, cid = worley(35, 4, 1.0)
    f1w = warp(f2 - f1, w1, w2, 0.22)
    cracks = ss(0.035, 0.0, f1w) * ss(0.3, 0.6, fbm(38, 2.0, 2))
    ridge2 = 1 - np.abs(warp(fbm(39, 1.8, 5), w2, w1, 0.1) * 2 - 1)
    fine = fbm(36, 0.8, 40)
    cid = blur(cid, 6)
    h = big * 0.45 + ridge * 0.2 + ridge2 * 0.15 + strata * 0.1 + fine * 0.08 - cracks * 0.3 + cid * 0.1
    h = norm01(h)
    c1, c2, c3 = col([0.38, 0.37, 0.35]), col([0.52, 0.5, 0.47]), col([0.45, 0.4, 0.35])
    albedo = lerp(c1 * 0.85, c2 * 1.05, ss(0.2, 0.8, big * 0.4 + ridge2 * 0.4 + ridge * 0.2))
    albedo = lerp(albedo, c3, ss(0.4, 0.8, strata) * 0.4)
    albedo = albedo * (0.82 + 0.3 * fine + 0.15 * cid)[..., None]
    lichen = ss(0.62, 0.75, fbm(37, 1.4, 6)) * ss(0.4, 0.7, h)
    albedo = lerp(albedo, col([0.5, 0.52, 0.36]), lichen * 0.5)
    albedo = albedo * (1 - 0.55 * cracks - 0.9 * cavity(h, 3) - 0.6 * cavity(h, 10))[..., None]
    rough = 0.78 + fine * 0.15 - lichen * 0.1
    return albedo, h, rough, 26, 6.0


def mat_sand():
    w1, w2 = fbm(41, 2.4, 1), fbm(42, 2.4, 1)
    d = XX / N * 7 + YY / N * 3
    rip = np.sin((d + (warp(w1, w2, w1, 0.3) - 0.5) * 2.0) * 2 * np.pi)
    rip = 0.5 + 0.5 * np.sign(rip) * np.abs(rip) ** 0.7
    grain = fbm(43, 0.2, 120)
    big = fbm(44, 2.2, 1)
    h = rip * 0.55 + big * 0.3 + grain * 0.15
    albedo = lerp(col([0.72, 0.58, 0.4]), col([0.82, 0.68, 0.5]), big)
    albedo = albedo * (0.92 + 0.16 * grain + 0.08 * rip)[..., None]
    dark = ss(0.6, 0.85, grain) * 0.3
    albedo = albedo * (1 - dark)[..., None]
    rough = 0.88 + grain * 0.1
    return albedo, h, rough, 5, 4.0


def mat_snow():
    big = fbm(51, 2.4, 1)
    mid = fbm(52, 1.8, 4)
    fine = fbm(53, 0.5, 60)
    h = big * 0.55 + mid * 0.35 + fine * 0.1
    albedo = lerp(col([0.82, 0.86, 0.92]), col([0.95, 0.96, 0.98]), h)
    cav = cavity(h, 6)
    albedo = lerp(albedo, col([0.62, 0.72, 0.86]), cav * 0.8)
    sparkle = (np.random.default_rng(54).random((N, N)) > 0.995).astype(float)
    rough = 0.7 - sparkle * 0.55 - mid * 0.1
    return albedo, h, rough, 4, 4.0


def mat_ash():
    f1, f2, cid = worley(61, 30)
    f1b, _, cidb = worley(62, 75)
    soil = fbm(63, 1.6, 2)
    st = ss(0.45, 0.15, f1) * (0.6 + 0.4 * cid)
    pb = ss(0.4, 0.1, f1b)
    h = soil * 0.3 + st * 0.55 + pb * 0.25
    albedo = lerp(col([0.12, 0.11, 0.11]), col([0.22, 0.2, 0.19]), soil)
    sc = lerp(col([0.16, 0.15, 0.15]), col([0.3, 0.27, 0.26]), cid)
    albedo = lerp(albedo, sc, st)
    ember = ss(0.9, 0.97, cid) * st
    albedo = lerp(albedo, col([0.36, 0.16, 0.1]), ember * 0.7)
    albedo = albedo * (1 - 0.5 * cavity(h, 4))[..., None]
    rough = 0.92 - st * 0.12
    return albedo, h, rough, 10, 3.0


def mat_concrete():
    stain = fbm(71, 2.2, 1)
    mid = fbm(72, 1.6, 6)
    grain = fbm(73, 0.3, 120)
    rng = np.random.default_rng(74)
    pits = np.zeros((N, N))
    f1, _, cid = worley(75, 90)
    pits = ss(0.18, 0.05, f1) * (cid > 0.7)
    h = 0.6 + mid * 0.15 + grain * 0.15 - pits * 0.5
    albedo = lerp(col([0.5, 0.5, 0.48]), col([0.62, 0.61, 0.58]), stain)
    albedo = albedo * (0.9 + 0.2 * grain + 0.1 * mid)[..., None]
    albedo = albedo * (1 - 0.4 * pits)[..., None]
    streak = ss(0.6, 0.9, fbm(76, 1.6, 3, None, (0.25, 6))) * 0.12
    albedo = albedo * (1 - streak)[..., None]
    rough = 0.85 + grain * 0.1
    del rng
    return albedo, h, rough, 6, 4.0


def mat_metal():
    brushed = fbm(81, 1.0, 2, None, (0.05, 1.0))
    grain = fbm(82, 0.4, 100)
    blot = fbm(83, 1.8, 4)
    rng = np.random.default_rng(84)
    sc = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(sc)
    for i in range(int(260 * (N / 1024) ** 2)):
        x, y = rng.random() * N, rng.random() * N
        a = rng.normal(0.2, 0.6)
        L = rng.random() ** 2 * 120 * N / 1024 + 8
        v = int(60 + rng.random() * 140)
        for ox in (-N, 0, N):
            for oy in (-N, 0, N):
                d.line([(x + ox, y + oy), (x + ox + np.cos(a) * L, y + oy + np.sin(a) * L)], fill=v, width=1)
    scr = blur(np.asarray(sc).astype(np.float64) / 255, 0.6)
    grime = ss(0.62, 0.9, blot) * 0.7
    h = 0.5 + brushed * 0.1 + grain * 0.05 - scr * 0.15
    albedo = lerp(col([0.5, 0.52, 0.54]), col([0.6, 0.61, 0.63]), brushed)
    albedo = lerp(albedo, col([0.3, 0.28, 0.25]), grime * 0.5)
    albedo = albedo + scr[..., None] * 0.12
    rough = 0.45 + grime * 0.35 + grain * 0.1 - scr * 0.25
    return albedo, h, rough, 3, 2.0


def mat_bark():
    w1 = fbm(91, 2.0, 1)
    ridges = fbm(92, 1.4, 2, None, (6.0, 0.25))
    fine = fbm(93, 0.6, 40)
    rngb = np.random.default_rng(94)
    u = XX / N * 14; v = YY / N * 3
    ci = np.floor(u).astype(int); cj = np.floor(v).astype(int)
    pts = rngb.random((3, 14, 2))
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni, nj = ci + di, cj + dj
            pp = pts[nj % 3, ni % 14]
            dd = np.sqrt((ni + pp[..., 0] - u) ** 2 + ((nj + pp[..., 1] - v) * 0.6) ** 2)
            closer = dd < f1
            f2 = np.where(closer, f1, np.minimum(f2, dd)); f1 = np.where(closer, dd, f1)
    plates = ss(0.0, 0.14, warp(f2 - f1, w1, w1, 0.03))
    h = ridges * 0.6 + plates * 0.3 + fine * 0.1
    albedo = lerp(col([0.18, 0.13, 0.09]), col([0.36, 0.28, 0.2]), h)
    albedo = albedo * (1 - 0.5 * cavity(h, 3))[..., None]
    moss = ss(0.6, 0.8, fbm(95, 1.6, 3)) * ss(0.4, 0.7, h)
    albedo = lerp(albedo, col([0.26, 0.34, 0.14]), moss * 0.5)
    rough = 0.9 + fine * 0.08
    return albedo, h, rough, 14, 2.0


MATS = [('grass', mat_grass), ('dirt', mat_dirt), ('rock', mat_rock), ('sand', mat_sand), ('snow', mat_snow),
        ('ash', mat_ash), ('concrete', mat_concrete), ('metal', mat_metal), ('bark', mat_bark)]


# ---------- foliage cards (RGBA PNG): needles and leaves on transparent ----------
def foliage(name, kind, seed):
    rng = np.random.default_rng(seed)
    S = N // 2
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx = S / 2
    if kind == 'needles':
        # a fir branch seen from above: a central twig with needles all along it, and side twigs
        def twig(x0, y0, ang, L, depth):
            x1, y1 = x0 + np.cos(ang) * L, y0 + np.sin(ang) * L
            d.line([(x0, y0), (x1, y1)], fill=(60, 44, 30, 255), width=max(1, int(S / 200)))
            steps = int(L / (S / 220))
            for i in range(steps):
                t = i / max(1, steps)
                px, py = x0 + (x1 - x0) * t, y0 + (y1 - y0) * t
                for side in (-1, 1):
                    na = ang + side * (0.9 + rng.random() * 0.3)
                    nl = S * (0.045 + rng.random() * 0.02) * (1 - t * 0.4)
                    g = rng.integers(0, 40)
                    d.line([(px, py), (px + np.cos(na) * nl, py + np.sin(na) * nl)], fill=(34 + g, 62 + g, 32 + g // 2, 255), width=max(2, int(S / 150)))
            if depth > 0:
                for i in range(5):
                    t = 0.2 + i * 0.15
                    for side in (-1, 1):
                        twig(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, ang + side * (0.7 + rng.random() * 0.3), L * (0.45 - t * 0.25), depth - 1)
        twig(cx, S * 0.97, -np.pi / 2, S * 0.92, 1)
    else:
        # a leafy cluster: many small leaves round a centre
        for i in range(int(420 * (S / 512) ** 2)):
            r = (rng.random() ** 0.6) * S * 0.46
            a = rng.random() * np.pi * 2
            x, y = cx + np.cos(a) * r, cx + np.sin(a) * r
            la = rng.random() * np.pi * 2
            L, W = S * (0.035 + rng.random() * 0.02), S * (0.018 + rng.random() * 0.01)
            pts = [(x + np.cos(la) * L, y + np.sin(la) * L), (x + np.cos(la + 1.57) * W, y + np.sin(la + 1.57) * W),
                   (x - np.cos(la) * L * 0.6, y - np.sin(la) * L * 0.6), (x - np.cos(la + 1.57) * W, y - np.sin(la + 1.57) * W)]
            g = rng.integers(0, 50)
            shade = 0.7 + 0.3 * (1 - r / (S * 0.46))
            d.polygon(pts, fill=(int((52 + g) * shade), int((92 + g) * shade), int((30 + g // 3) * shade), 255))
    # colour bleeds into the clear pixels so smaller mip levels do not get dark edges
    a = np.asarray(img).astype(np.float64) / 255
    al = a[..., 3:4]
    S2 = a.shape[0]
    def bl(x, s):
        f = np.fft.fftfreq(S2) * S2
        fx, fy = np.meshgrid(f, f)
        g = np.exp(-2 * (np.pi * s * np.sqrt(fx * fx + fy * fy) / S2) ** 2)
        return np.real(np.fft.ifft2(np.fft.fft2(x, axes=(0, 1)) * g[..., None], axes=(0, 1)))
    rgb = a[..., :3] * al
    fill = rgb.copy(); wsum = al.copy()
    for sgm in (2, 6, 16, 40):
        fill = fill + bl(rgb, sgm); wsum = wsum + bl(al, sgm)
    fill = fill / np.maximum(wsum, 1e-4)
    out = np.where(al > 0.5, a[..., :3], fill)
    img = Image.fromarray((np.concatenate([np.clip(out, 0, 1), al], -1) * 255 + 0.5).astype(np.uint8), 'RGBA')
    img.save(os.path.join(args.out, name + '.png'), optimize=True)
    print('  ', name)


manifest = []
only = set(args.only.split(',')) if args.only else None
print('baking', N)
for name, fn in MATS:
    if only and name not in only:
        continue
    a, h, r, s, sc = fn()
    save(name, a, h, r, s * N / 1024, manifest, sc)
if not only:
    foliage('needles', 'needles', 101)
    foliage('leaves', 'leaves', 102)
    with open(os.path.join(args.out, 'manifest.json'), 'w') as f:
        json.dump({'size': N, 'materials': manifest, 'cards': ['needles', 'leaves']}, f, indent=1)
print('done')
