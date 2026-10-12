#!/usr/bin/env python3
"""Soundtrack for the videos: a synthwave-ish loop plus click and impact sounds, made from scratch with numpy (no samples, no licences).
usage: music.py marks.json out.wav"""
import json, sys, wave
import numpy as np

SR = 44100
info = json.load(open(sys.argv[1]))
D = float(info['duration']) + 0.3
rng = np.random.default_rng(int(info.get('seed', 1)))
N = int(D * SR)
L = np.zeros(N); R = np.zeros(N)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def put(buf, t, sig, gain=1.0):
    i = int(t * SR)
    if i >= N or i < 0: return
    j = min(N, i + len(sig))
    buf[i:j] += sig[:j - i] * gain
def stereo(t, sig, gain=1.0, pan=0.0):
    put(L, t, sig, gain * (1 - max(0, pan))); put(R, t, sig, gain * (1 + min(0, pan)))

def env(n, a=0.005, d=0.2, floor=0.0):
    x = np.arange(n) / SR
    e = np.minimum(1, x / max(a, 1e-4)) * (floor + (1 - floor) * np.exp(-x / d))
    return e

BPM = 104.0
beat = 60.0 / BPM
bar = 4 * beat
# A minor: Am  F  C  G  (root midi, chord tones)
CHORDS = [(45, [57, 60, 64]), (41, [53, 57, 60]), (48, [55, 60, 64]), (43, [55, 59, 62])]

def saw_pad(freq, n):
    x = np.arange(n) / SR
    sig = np.zeros(n)
    for k in range(1, 9):
        for det in (-0.004, 0.0, 0.004):
            sig += np.sin(2 * np.pi * freq * (1 + det) * k * x + rng.random() * 6.28) / k
    return sig / 14

def pluck(freq, n, bright=1.0):
    x = np.arange(n) / SR
    sig = np.sin(2 * np.pi * freq * x) + 0.5 * np.sin(2 * np.pi * freq * 2 * x) * bright + 0.25 * np.sin(2 * np.pi * freq * 3 * x) * bright
    return sig * env(n, 0.003, 0.11)

def kick(n=int(0.35 * SR)):
    x = np.arange(n) / SR
    f = 45 + 110 * np.exp(-x * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-x * 9)

def hat(n=int(0.06 * SR)):
    return rng.standard_normal(n) * np.exp(-np.arange(n) / SR * 90) * 0.5

def snare(n=int(0.22 * SR)):
    x = np.arange(n) / SR
    return (rng.standard_normal(n) * 0.7 + np.sin(2 * np.pi * 190 * x) * 0.5) * np.exp(-x * 20)

kick_times = []
bars = int(D / bar) + 2
for b in range(bars):
    t0 = b * bar
    root, tones = CHORDS[b % 4]
    drive = t0 >= 4.5                      # an intro of pad and plucks, then the beat comes in
    big = t0 >= 4.5 + 4 * bar              # and a fuller second part
    # pad
    n = int((bar + 0.4) * SR)
    pad = sum(saw_pad(hz(m), n) for m in tones) * np.minimum(1, np.arange(n) / SR / 0.6) * np.minimum(1, (n - np.arange(n)) / SR / 0.4)
    stereo(t0, pad, 0.55 if not big else 0.62, 0.0)
    # bass: eighth notes
    if drive:
        for k in range(8):
            f = hz(root - 12) * (2 if k % 4 == 3 else 1)
            nn = int(0.22 * SR)
            x = np.arange(nn) / SR
            sig = (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * 2 * f * x)) * env(nn, 0.004, 0.16)
            stereo(t0 + k * beat / 2, sig, 0.5)
    # arpeggio, sixteenths
    pattern = [0, 1, 2, 1, 2, 1, 0, 2] * 2
    for k in range(16):
        m = tones[pattern[k]] + (12 if (k % 8) in (3, 7) else 0) + (12 if big and k % 4 == 2 else 0)
        tt = t0 + k * beat / 4
        sig = pluck(hz(m + 12), int(0.3 * SR), 1.0 if drive else 0.6)
        stereo(tt, sig, 0.16 if not drive else 0.2, -0.35 if k % 2 else 0.35)
        stereo(tt + beat * 0.75, sig, 0.07, 0.0)  # a soft echo
    if drive:
        for k in range(4):
            tt = t0 + k * beat
            if k % 2 == 0:
                kick_times.append(tt); stereo(tt, kick(), 0.9)
            else:
                stereo(tt, snare(), 0.32)
            stereo(tt + beat / 2, hat(), 0.22, 0.2)
            if big:
                stereo(tt + beat / 4, hat(), 0.1, -0.2); stereo(tt + 3 * beat / 4, hat(), 0.1, 0.2)

# sidechain pump: duck everything but the kick-like transients a little right after each kick
duck = np.ones(N)
for t in kick_times:
    i = int(t * SR); n = int(0.28 * SR)
    if i < N:
        j = min(N, i + n)
        duck[i:j] = np.minimum(duck[i:j], 0.55 + 0.45 * (np.arange(j - i) / n) ** 1.5)
L *= duck; R *= duck

# sound effects tied to what happens on screen
for m in info.get('marks', []):
    t = float(m['t'])
    if m['kind'] == 'click':
        n = int(0.09 * SR); x = np.arange(n) / SR
        sig = np.sin(2 * np.pi * (900 + 700 * np.exp(-x * 40)) * x) * np.exp(-x * 45)
        stereo(t, sig, 0.30)
    elif m['kind'] == 'hit':
        n = int(1.6 * SR); x = np.arange(n) / SR
        boom = np.sin(2 * np.pi * (38 + 90 * np.exp(-x * 7)) * x) * np.exp(-x * 2.2)
        wash = rng.standard_normal(n) * np.exp(-x * 3.2) * (1 - np.exp(-x * 40)) * 0.25
        stereo(t, boom * 0.9 + wash, 0.9)
    elif m['kind'] == 'good':
        for k, mm in enumerate((72, 76, 79, 84)):
            n = int(0.35 * SR)
            stereo(t + k * 0.07, pluck(hz(mm), n, 1.2), 0.35, 0.0)

peak = max(np.abs(L).max(), np.abs(R).max(), 1e-6)
fade_in = np.minimum(1, np.arange(N) / SR / 1.2)
fade_out = np.minimum(1, (N - np.arange(N)) / SR / 2.0)
L = np.tanh(L / peak * 1.35) * 0.8 * fade_in * fade_out
R = np.tanh(R / peak * 1.35) * 0.8 * fade_in * fade_out
pcm = (np.stack([L, R], axis=1) * 32767).astype('<i2')
with wave.open(sys.argv[2], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
