/*
 * Jetfall: the rules. Jetpacks, skiing, capture the flag. No DOM here, so it runs in node and in a worker.
 *
 * The host's browser runs the one true World. Every other browser runs `movePlayer` for its own player only
 * (prediction) and is corrected by the host's snapshots. So movement must be the same function in both places:
 * keep everything that moves a player inside movePlayer and the state it reads inside the player.
 *
 * Units are metres and seconds. y is up. The map is SIZE x SIZE metres.
 */
(function (root) {
  'use strict';

  const TICK = 1 / 60;
  const GRAV = 20;
  const N = 256, CELL = 8, SIZE = N * CELL;   // heightfield: (N+1)^2 heights, 8 m apart
  const AREA_MIN = 230, AREA_MAX = SIZE - 230;  // the mission area; outside it you are pushed back
  const CEILING = 900;
  const TEAMS = [
    { name: 'Ember', color: '#ff7a3d', rgb: [1.0, 0.45, 0.2] },
    { name: 'Azure', color: '#4fb3ff', rgb: [0.3, 0.65, 1.0] },
  ];

  // input buttons
  const B = { FIRE: 1, JET: 2, JUMP: 4, PACK: 8, GREN: 16, ALT: 32 };

  const ARMORS = {
    light:  { name: 'Light',  hp: 70,  mass: 1.0, run: 12, accel: 70, jet: 37, jetCost: 22, energy: 60,  regen: 11, jump: 8,   r: 0.5,  h: 2.0, slots: 3, grenades: 3, impact: 30 },
    medium: { name: 'Medium', hp: 105, mass: 1.45, run: 10, accel: 60, jet: 33, jetCost: 22, energy: 75,  regen: 11, jump: 7.5, r: 0.6,  h: 2.3, slots: 4, grenades: 4, impact: 28 },
    heavy:  { name: 'Heavy',  hp: 165, mass: 2.1, run: 8,  accel: 50, jet: 30, jetCost: 21, energy: 95,  regen: 11, jump: 7,   r: 0.75, h: 2.6, slots: 5, grenades: 5, impact: 26 },
  };
  const ARMOR_KEYS = ['light', 'medium', 'heavy'];

  // kind: 'proj' flies, 'hitscan' is instant, 'beam' is held.
  // dmg is damage at the centre, r the splash radius (0 = direct hit only), knock the shove at the centre for light armor (m/s).
  const WEAPONS = {
    blaster: { name: 'Blaster',          kind: 'proj', code: 1, speed: 160, grav: 0,   dmg: 13,  r: 0,   knock: 2,  cd: 0.32, ammo: 0,   energy: 6, inherit: 0.4, life: 2.5, blurb: 'Uses energy, never ammo. Weak but always there.' },
    chain:   { name: 'Chaingun',         kind: 'proj', code: 2, speed: 380, grav: 0,   dmg: 9,   r: 0,   knock: 1,  cd: 0.085, ammo: 200, spin: 0.3, spread: 0.016, inherit: 0.5, life: 1.0, quiet: true, blurb: 'Spins up, then a stream of bullets. Good up close and on flag runners.' },
    disc:    { name: 'Disc Launcher',    kind: 'proj', code: 3, speed: 68,  grav: 0,   dmg: 48,  r: 7.5, knock: 26, cd: 1.15, ammo: 15,  inherit: 0.5, life: 6, blurb: 'Slow disc, big blast, big shove. Aim at the feet, or under yourself to fly.' },
    gl:      { name: 'Grenade Launcher', kind: 'proj', code: 4, speed: 52,  grav: 1,   dmg: 42,  r: 8,   knock: 20, cd: 0.85, ammo: 12,  inherit: 1, life: 2.2, bounce: 0.45, fuse: true, blurb: 'Lobs grenades that bounce, then blow after two seconds. They go off on contact with a player.' },
    plasma:  { name: 'Plasma Rifle',     kind: 'proj', code: 5, speed: 62,  grav: 0,   dmg: 40,  r: 3.5, knock: 6,  cd: 0.6, ammo: 30,  inherit: 0.5, life: 5, blurb: 'Hot bolt, small splash, hits hard.' },
    mortar:  { name: 'Mortar',           kind: 'proj', code: 6, speed: 48,  grav: 1,   dmg: 110, r: 18,  knock: 34, cd: 2.0, ammo: 10,  inherit: 1, life: 8, arm: 0.25, blurb: 'Heavy armor only. Long arc, huge blast. Wrecks generators.' },
    laser:   { name: 'Laser Rifle',      kind: 'hitscan', code: 7, range: 450, dmg: 18, perEnergy: 0.85, minEnergy: 25, cd: 1.4, ammo: 0, blurb: 'Light armor only. Instant hit, burns all your energy: the more you have, the harder it hits. Head shots count double.' },
    elf:     { name: 'ELF Projector',    kind: 'beam', code: 8, range: 42, drain: 55, dmg: 7, ammo: 0, cd: 0, blurb: 'Hold on someone to drain their energy and hurt them a little. Grounds jetters.' },
  };
  const WEAPON_KEYS = ['blaster', 'chain', 'disc', 'gl', 'plasma', 'mortar', 'laser', 'elf'];
  const NOT_FOR = { light: ['mortar'], medium: ['mortar', 'laser'], heavy: ['laser'] };
  // projectiles that are not a carried weapon
  const EXTRA_PROJ = {
    hgren:  { name: 'Hand grenade', kind: 'proj', code: 9,  speed: 30, grav: 1, dmg: 45, r: 9, knock: 22, inherit: 1, life: 2.0, bounce: 0.4, fuse: true },
    tbolt:  { name: 'Turret',       kind: 'proj', code: 10, speed: 58, grav: 0, dmg: 20, r: 3.5, knock: 8, inherit: 0, life: 4 },
  };
  const PROJ = Object.assign({}, WEAPONS, EXTRA_PROJ);
  const PROJ_BY_CODE = {};
  for (const [k, w] of Object.entries(PROJ)) PROJ_BY_CODE[w.code] = k;

  const PACKS = {
    none:   { name: 'No pack', blurb: '' },
    energy: { name: 'Energy pack', regen: 9, blurb: 'Faster energy: fly longer, jet more often.' },
    repair: { name: 'Repair pack', blurb: 'Hold the pack key: heals you, or whatever friendly thing you look at up close (generator, turret, station, a friend).' },
    shield: { name: 'Shield pack', blurb: 'Press the pack key to switch on. Damage eats energy instead of health.' },
    ammo:   { name: 'Ammo pack',   blurb: 'Half again as much ammo, and two more grenades.' },
  };
  const PACK_KEYS = ['none', 'energy', 'repair', 'shield', 'ammo'];

  const SPAWN_KIT = { armor: 'light', weapons: ['blaster', 'chain', 'disc'], pack: 'none' };
  const DEFAULT_LOADOUT = { armor: 'medium', weapons: ['disc', 'chain', 'plasma', 'gl'], pack: 'energy' };

  const RESPAWN_S = 3, AUTO_RESPAWN_S = 8;
  const FLAG_RETURN_S = 40;
  const MIDAIR_H = 3; // this far over the land to count as a midair
  const FLAG_R = 2.4, FLAG_TOP = 3.6; // touch: this far from the pole, feet up to this high over its foot (it is drawn 2.9 m tall)
  const STATION_S = 0.9;
  const OBJ = {
    gen:     { name: 'Generator', hp: 700 },
    station: { name: 'Inventory station', hp: 320 },
    turret:  { name: 'Turret', hp: 180, range: 110, cd: 2.2, turn: 1.3, lead: 0.85, spread: 0.02 },
    sensor:  { name: 'Sensor', hp: 260 },
    target:  { name: 'Target', hp: 1 },
  };
  const ONLINE_AT = 0.6; // a destroyed thing comes back when repaired to this fraction

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const has = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
  const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);

  // ---------- random numbers (seeded; the world keeps its own) ----------
  function mulberry(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- noise for the land ----------
  function hash2(x, z, s) {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(s | 0, 2147483587);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, z, s) {
    const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
    const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
    const a = hash2(ix, iz, s), b = hash2(ix + 1, iz, s), c = hash2(ix, iz + 1, s), d = hash2(ix + 1, iz + 1, s);
    return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
  }
  function fbm(x, z, s, oct, gain) {
    let sum = 0, amp = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * (vnoise(x, z, s + i * 101) * 2 - 1);
      norm += amp; amp *= gain; x *= 2.03; z *= 2.03;
    }
    return sum / norm;
  }
  function ridged(x, z, s, oct) {
    let sum = 0, amp = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      const v = 1 - Math.abs(vnoise(x, z, s + i * 57) * 2 - 1);
      sum += amp * v * v; norm += amp; amp *= 0.5; x *= 2.1; z *= 2.1;
    }
    return sum / norm;
  }

  // ---------- maps ----------
  // Everything about how a map looks is here too, so a map is one piece of data. The renderer reads `look`.
  const MAPS = {
    highland: {
      name: 'Highland', blurb: 'Green rolling hills. Long ski runs between the bases.',
      seed: 7, amp: 150, freq: 1 / 520, ridge: 0.35, rough: 0.48, dist: 620, off: 160, baseH: null,
      props: ['tower', 'arch', 'ruin', 'ruin', 'arch'], center: 'tower',
      look: {
        skyTop: [0.22, 0.42, 0.75], skyHorizon: [0.72, 0.82, 0.92], sun: [0.55, 0.45, 0.35], sunColor: [1.1, 1.0, 0.86], ambient: [0.36, 0.43, 0.55],
        fog: [0.66, 0.75, 0.86], fogDist: 1700, clouds: 0.55,
        low: [0.27, 0.42, 0.16], mid: [0.36, 0.48, 0.2], high: [0.5, 0.48, 0.42], rock: [0.42, 0.4, 0.37], snow: [0.93, 0.95, 0.98], snowLine: 0.8,
        grass: 1, grade: { exposure: 1.05, sat: 1.12, contrast: 1.08, gain: [1.04, 1.0, 0.95] },
      },
    },
    dunes: {
      name: 'Dust Basin', blurb: 'Big dunes under an orange sky. Fast going downhill.',
      seed: 21, amp: 120, freq: 1 / 430, ridge: 0.15, rough: 0.4, dist: 650, off: -120, baseH: null,
      props: ['arch', 'arch', 'ruin', 'ruin', 'spire'], center: 'arch', weather: 'dust',
      look: {
        skyTop: [0.38, 0.45, 0.62], skyHorizon: [0.98, 0.72, 0.45], sun: [-0.4, 0.38, 0.55], sunColor: [1.0, 0.82, 0.6], ambient: [0.55, 0.45, 0.4],
        fog: [0.92, 0.7, 0.5], fogDist: 1400, clouds: 0.2, rocks: 250,
        low: [0.72, 0.52, 0.32], mid: [0.8, 0.6, 0.38], high: [0.68, 0.48, 0.32], rock: [0.55, 0.38, 0.27], snow: [0.85, 0.7, 0.5], snowLine: 2,
        grass: 0.12, grassCol: [0.62, 0.5, 0.28], grassCol2: [0.72, 0.62, 0.35],
        grade: { exposure: 1.05, sat: 1.1, contrast: 1.06, gain: [1.08, 0.97, 0.86], lift: [0.015, 0, -0.01], vignette: 0.38 },
      },
    },
    frost: {
      name: 'Frostline', blurb: 'Snow and steep ridges. Low cloud, hard to see far.',
      seed: 33, amp: 190, freq: 1 / 480, ridge: 0.6, rough: 0.5, dist: 600, off: 200, baseH: null,
      props: ['spire', 'spire', 'tower', 'ruin'], center: 'tower', weather: 'snow',
      look: {
        skyTop: [0.5, 0.58, 0.68], skyHorizon: [0.8, 0.84, 0.88], sun: [0.2, 0.42, -0.6], sunColor: [0.95, 0.96, 1.0], ambient: [0.55, 0.6, 0.7],
        fog: [0.78, 0.82, 0.87], fogDist: 950, clouds: 0.8, rocks: 700, rockCol: [0.5, 0.52, 0.56],
        low: [0.82, 0.86, 0.9], mid: [0.88, 0.9, 0.94], high: [0.95, 0.96, 0.98], rock: [0.38, 0.4, 0.45], snow: [0.97, 0.98, 1.0], snowLine: 0.3,
        grass: 0, grade: { sat: 0.95, contrast: 0.98, gain: [0.95, 0.99, 1.08], lift: [0.02, 0.03, 0.05], bloom: 0.8, vignette: 0.26 },
      },
    },
    ashfall: {
      name: 'Ashfall', blurb: 'Dark volcanic rock, a red sky and lava in the low ground. The lava burns: jet over it.',
      seed: 47, amp: 170, freq: 1 / 400, ridge: 0.7, rough: 0.55, dist: 610, off: -180, baseH: null,
      props: ['spire', 'spire', 'ruin', 'tower'], center: 'spire', weather: 'ash', lava: 0.18,
      look: {
        skyTop: [0.12, 0.08, 0.12], skyHorizon: [0.62, 0.25, 0.14], sun: [0.55, 0.3, 0.3], sunColor: [1.0, 0.6, 0.4], ambient: [0.38, 0.28, 0.3],
        fog: [0.35, 0.16, 0.12], fogDist: 1250, clouds: 0.4, rocks: 1300,
        low: [0.16, 0.14, 0.14], mid: [0.22, 0.19, 0.18], high: [0.3, 0.27, 0.25], rock: [0.12, 0.11, 0.11], snow: [0.5, 0.45, 0.42], snowLine: 0.9,
        lava: true,
        grass: 0.06, grassCol: [0.22, 0.18, 0.14], grassCol2: [0.3, 0.24, 0.16],
        grade: { exposure: 1.3, sat: 1.1, contrast: 1.12, gain: [1.1, 0.92, 0.85], bloom: 1.25, stars: 0.8, vignette: 0.4 },
      },
    },
    lakes: {
      name: 'Twin Lakes', blurb: 'Two lakes in the middle and rain. Water slows you down, so ski around it or jet over.',
      seed: 61, amp: 130, freq: 1 / 470, ridge: 0.3, rough: 0.46, dist: 640, off: 60, baseH: null,
      shape: 'lakes', props: ['ruin', 'arch', 'tower', 'ruin'], center: 'tower', weather: 'rain',
      look: {
        skyTop: [0.3, 0.38, 0.5], skyHorizon: [0.62, 0.68, 0.74], sun: [0.35, 0.5, -0.5], sunColor: [0.95, 0.95, 0.92], ambient: [0.45, 0.5, 0.58],
        fog: [0.58, 0.64, 0.7], fogDist: 1100, clouds: 0.9,
        low: [0.24, 0.36, 0.2], mid: [0.3, 0.42, 0.22], high: [0.42, 0.44, 0.4], rock: [0.36, 0.37, 0.38], snow: [0.9, 0.92, 0.95], snowLine: 0.85,
        water: [0.12, 0.24, 0.3],
        grass: 0.9, grade: { exposure: 1.05, sat: 0.96, contrast: 1.04, gain: [0.94, 1.0, 1.06], wet: 0.5, bloom: 0.9 },
      },
    },
    canyon: {
      name: 'Canyon Run', blurb: 'A deep canyon between the bases with three bridges. Dive in and ski the floor, or take a bridge.',
      seed: 73, amp: 110, freq: 1 / 500, ridge: 0.25, rough: 0.45, dist: 640, off: -90, baseH: null,
      shape: 'canyon', props: ['ruin', 'tower', 'arch'], weather: 'dust',
      look: {
        skyTop: [0.28, 0.45, 0.72], skyHorizon: [0.86, 0.8, 0.7], sun: [0.3, 0.55, 0.45], sunColor: [1.1, 0.95, 0.8], ambient: [0.45, 0.42, 0.42],
        fog: [0.82, 0.76, 0.66], fogDist: 1500, clouds: 0.3, rocks: 1100,
        low: [0.62, 0.38, 0.24], mid: [0.7, 0.48, 0.3], high: [0.78, 0.6, 0.42], rock: [0.58, 0.32, 0.2], snow: [0.85, 0.7, 0.55], snowLine: 2,
        grass: 0.3, grassCol: [0.55, 0.45, 0.22], grassCol2: [0.68, 0.58, 0.3],
        grade: { exposure: 1.05, sat: 1.12, contrast: 1.08, gain: [1.08, 0.98, 0.9] },
      },
    },
  };
  const MAP_KEYS = Object.keys(MAPS);

  // ---------- courses ----------
  // A course is a line of gates to pass in order (the first starts the clock, the last stops it) and targets to shoot on the way.
  // Gates are [x, z, h, r]: h is the centre's height over the ground (left out: a gate you ski through), r the radius.
  // Targets are [x, z, h]: a disc on a post, h over the ground. Each target missed adds `penalty` seconds. Everyone runs the same kit so times compare.
  const COURSE_KIT = { armor: 'light', weapons: ['disc', 'chain', 'blaster'], pack: 'energy' };
  const GATE_H = 3, GATE_R = 7, TARGET_PENALTY = 5, COURSE_RESPAWN_S = 1;
  const COURSES = {
    green: {
      name: 'Green Run', map: 'highland', blurb: 'A long run down the hills, one jump. Learn to ski here.',
      start: [300, 288],
      gates: [[320, 300], [415, 355], [519, 393], [627, 412], [711, 482, 10, 8], [801, 546], [891, 609], [982, 672], [1060, 760]],
      targets: [[405, 377], [617, 434], [726, 463], [787, 566], [905, 589], [966, 690]],
    },
    dunes: {
      name: 'Dune Dash', map: 'dunes', blurb: 'Off the big dune and straight down. Two gates in the air.',
      start: [1085, 862],
      gates: [[1060, 870], [1000, 880], [900, 834], [801, 787], [701, 741, 12, 8], [601, 694], [493, 675], [383, 665, 10, 8], [300, 620]],
      targets: [[1005, 857], [811, 765], [691, 763], [608, 671], [490, 699], [390, 642]],
    },
    ridge: {
      name: 'Ridge Line', map: 'frost', blurb: 'Steep drops off the north ridge, then a climb to the finish. You will need the jets.',
      start: [1165, 535],
      gates: [[1150, 560], [1100, 680], [1050, 790, 12, 8], [1000, 900], [950, 1000], [880, 1100], [800, 1200]],
      targets: [[1078, 670], [1072, 800], [978, 890], [971, 1012], [861, 1086]],
    },
    lava: {
      name: 'Lava Run', map: 'ashfall', blurb: 'Down the black slopes and over a pool of lava. Do not land in it.',
      start: [920, 495],
      gates: [[900, 520], [800, 600], [700, 680], [600, 740], [500, 800], [420, 900], [480, 1000, 16, 8], [440, 1130]],
      targets: [[785, 581], [714, 700], [588, 719], [516, 818], [396, 898]],
    },
    shore: {
      name: 'Shore Run', map: 'lakes', blurb: 'From the east hills down to the lake, then along the shore. Water is slow: stay on the bank.',
      start: [1760, 425],
      gates: [[1740, 440], [1650, 500], [1580, 600], [1615, 720], [1605, 840], [1600, 960], [1550, 1060], [1545, 1160], [1480, 1260]],
      targets: [[1633, 483], [1604, 604], [1629, 841], [1577, 954], [1522, 1152]],
    },
    canyon: {
      name: 'Canyon Dive', map: 'canyon', blurb: 'Dive off the rim and ski the canyon floor under three bridges. Long and fast.',
      start: [1010, 280],
      gates: [[1027, 300], [1136, 400], [1068, 520], [971, 640], [913, 744], [915, 860], [988, 980], [1024, 1024], [1111, 1140], [1135, 1304], [1068, 1420], [971, 1540]],
      targets: [[1112, 404], [899, 640, 8], [951, 626], [892, 867], [1010, 1035], [1133, 1131], [1072, 1250, 8], [1083, 1430]],
    },
  };
  const COURSE_KEYS = Object.keys(COURSES);

  // base origins: point symmetric about the centre, so neither side has the better land
  function basePositions(def) {
    const c = SIZE / 2;
    return [
      { x: c - def.dist, z: c - def.off, face: 1 },
      { x: c + def.dist, z: c + def.off, face: -1 },
    ];
  }

  // ---------- terrain ----------
  function makeTerrain(mapKey, seedOverride) {
    const def = MAPS[mapKey];
    const seed = seedOverride == null ? def.seed : seedOverride | 0;
    const H = new Float32Array((N + 1) * (N + 1));
    const raw = (x, z) => {
      const nx = x * def.freq, nz = z * def.freq;
      const base = fbm(nx, nz, seed, 6, def.rough);
      const r = ridged(nx * 0.7 + 13.1, nz * 0.7 - 7.7, seed + 9, 5);
      const broad = fbm(nx * 0.35 + 3.3, nz * 0.35 + 1.7, seed + 77, 3, 0.5);
      return def.amp * (0.55 * base + def.ridge * (r - 0.45) + 0.6 * broad);
    };
    const bases = basePositions(def);
    // flatten around each base: the pad is level, then blends into the hills
    let padH = 0;
    for (const b of bases) padH += raw(b.x, b.z) + raw(SIZE - b.x, SIZE - b.z);
    padH /= 4;
    for (let iz = 0; iz <= N; iz++) {
      for (let ix = 0; ix <= N; ix++) {
        const x = ix * CELL, z = iz * CELL;
        let h = (raw(x, z) + raw(SIZE - x, SIZE - z)) * 0.5 * 1.35; // symmetric land
        h -= carve(def, x, z);
        for (const b of bases) {
          const d = Math.sqrt((x - b.x) * (x - b.x) + (z - b.z) * (z - b.z));
          const t = clamp((d - 45) / 110, 0, 1), s = t * t * (3 - 2 * t);
          h = padH + (h - padH) * s;
        }
        // raise the rim outside the mission area so the edge reads as a wall of hills
        const ex = Math.max(0, AREA_MIN - x, x - AREA_MAX), ez = Math.max(0, AREA_MIN - z, z - AREA_MAX);
        const e = Math.sqrt(ex * ex + ez * ez);
        h += e * e * 0.004;
        H[iz * (N + 1) + ix] = h;
      }
    }
    // lowest point at 20 m so nothing is below 0
    let lo = Infinity;
    for (let i = 0; i < H.length; i++) if (H[i] < lo) lo = H[i];
    for (let i = 0; i < H.length; i++) H[i] = H[i] - lo + 20;
    const t = new Terrain(H, padH - lo + 20);
    // water fills the lake basins up to a level; lava fills the lowest ground
    if (def.shape === 'lakes') t.waterH = t.height(SIZE / 2, SIZE / 2 - LAKE_OFF) + LAKE_DEPTH * 0.62;
    if (def.lava) {
      const hs = [];
      for (let iz = 0; iz <= N; iz += 2) for (let ix = 0; ix <= N; ix += 2) { const x = ix * CELL, z = iz * CELL; if (x > AREA_MIN && x < AREA_MAX && z > AREA_MIN && z < AREA_MAX) hs.push(H[iz * (N + 1) + ix]); }
      hs.sort((a, b) => a - b);
      t.lavaH = hs[Math.floor(hs.length * def.lava)];
    }
    return t;
  }

  // Shapes cut into the noise for some maps. Each is point symmetric about the centre, like the land.
  const LAKE_OFF = 330, LAKE_R = 190, LAKE_DEPTH = 46;
  const CANYON_A = 120, CANYON_K = Math.PI * 2 / 900, CANYON_W = 75, CANYON_D = 85;
  const canyonX = z => SIZE / 2 + CANYON_A * Math.sin((z - SIZE / 2) * CANYON_K);
  function carve(def, x, z) {
    const c = SIZE / 2;
    if (def.shape === 'lakes') {
      let d = 0;
      for (const s of [-1, 1]) {
        const dx = x - c, dz = z - (c + s * LAKE_OFF);
        const r = Math.sqrt(dx * dx + dz * dz) / LAKE_R;
        if (r < 1) { const k = 1 - r * r; d = Math.max(d, LAKE_DEPTH * k * k * (3 - 2 * k)); }
      }
      return d;
    }
    if (def.shape === 'canyon') {
      const d = Math.abs(x - canyonX(z));
      if (d >= CANYON_W) return 0;
      const t = d / CANYON_W, k = 1 - t;
      // steep walls, a flat floor
      return CANYON_D * Math.min(1, k * k * (3 - 2 * k) * 1.6);
    }
    return 0;
  }

  class Terrain {
    constructor(heights, padH) { this.h = heights; this.padH = padH; this.waterH = null; this.lavaH = null; }
    at(ix, iz) {
      ix = ix < 0 ? 0 : ix > N ? N : ix; iz = iz < 0 ? 0 : iz > N ? N : iz;
      return this.h[iz * (N + 1) + ix];
    }
    // the same two triangles per cell as the mesh that is drawn: split along x+z = 1
    height(x, z) {
      let gx = x / CELL, gz = z / CELL;
      if (gx < 0) gx = 0; else if (gx > N - 1e-6) gx = N - 1e-6;
      if (gz < 0) gz = 0; else if (gz > N - 1e-6) gz = N - 1e-6;
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      const h00 = this.at(ix, iz), h10 = this.at(ix + 1, iz), h01 = this.at(ix, iz + 1), h11 = this.at(ix + 1, iz + 1);
      if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
      return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
    }
    normal(x, z, out) {
      out = out || [0, 1, 0];
      let gx = clamp(x / CELL, 0, N - 1e-6), gz = clamp(z / CELL, 0, N - 1e-6);
      const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
      let dx, dz;
      if (fx + fz <= 1) { dx = this.at(ix + 1, iz) - this.at(ix, iz); dz = this.at(ix, iz + 1) - this.at(ix, iz); }
      else { dx = this.at(ix + 1, iz + 1) - this.at(ix, iz + 1); dz = this.at(ix + 1, iz + 1) - this.at(ix + 1, iz); }
      const nx = -dx / CELL, nz = -dz / CELL, l = len3(nx, 1, nz);
      out[0] = nx / l; out[1] = 1 / l; out[2] = nz / l;
      return out;
    }
    // first point where the segment a->b goes under the ground: returns t in [0,1] or -1
    raycast(ax, ay, az, bx, by, bz) {
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const dist = Math.sqrt(dx * dx + dz * dz) + Math.abs(dy) * 0.25;
      const steps = Math.max(1, Math.ceil(dist / 2.5));
      let pt = 0;
      if (ay < this.height(ax, az)) return 0;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
        if (y < this.height(x, z)) {
          let lo = pt, hi = t;
          for (let k = 0; k < 8; k++) {
            const m = (lo + hi) / 2;
            if (ay + dy * m < this.height(ax + dx * m, az + dz * m)) hi = m; else lo = m;
          }
          return hi;
        }
        pt = t;
      }
      return -1;
    }
  }

  // ---------- boxes (buildings and things) ----------
  // A box is [minX, minY, minZ, maxX, maxY, maxZ]. Bases are point-mirrored, so every box stays axis aligned.
  function segBox(ax, ay, az, dx, dy, dz, b, pad) {
    pad = pad || 0;
    let t0 = 0, t1 = 1;
    const o = [ax, ay, az], d = [dx, dy, dz];
    for (let i = 0; i < 3; i++) {
      const lo = b[i] - pad, hi = b[i + 3] + pad;
      if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo || o[i] > hi) return -1; continue; }
      let ta = (lo - o[i]) / d[i], tb = (hi - o[i]) / d[i];
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0;
  }

  // One base, in local coordinates: +x faces the enemy. y = 0 is the floor.
  // Returns walls (plain solid boxes) and things (generator, stations, turrets, flag stand, spawn points).
  function baseLayout() {
    const W = [];
    const box = (x0, y0, z0, x1, y1, z1, mat) => W.push({ b: [x0, y0, z0, x1, y1, z1], mat: mat || 'wall' });
    // bunker 24 x 18, walls 1 thick, 8 high, doors 4 wide and 4.5 high front and back
    for (const s of [-1, 1]) {
      const x0 = s < 0 ? -12 : 11, x1 = s < 0 ? -11 : 12;
      box(x0, 0, -9, x1, 8, -2.2);
      box(x0, 0, 2.2, x1, 8, 9);
      box(x0, 4.6, -2.2, x1, 8, 2.2);
    }
    box(-12, 0, -9, 12, 8, -8);
    box(-12, 0, 8, 12, 8, 9);
    box(-12, 8, -9, 12, 9, 9, 'roof');
    box(-12, -2, -9, 12, 0.08, 9, 'floor');
    // a low wall on the roof edge for cover
    box(-12, 9, -9, -11.3, 10.2, 9, 'trim');
    box(11.3, 9, -9, 12, 10.2, -3, 'trim');
    box(11.3, 9, 3, 12, 10.2, 9, 'trim');
    // sensor mast behind
    box(-34, -2, -1, -32, 22, 1, 'mast');
    // cover outside the front door
    box(17, -2, -6, 19, 3, -2, 'cover');
    box(17, -2, 2, 19, 3, 6, 'cover');
    box(-4, -2, 13, 4, 2.4, 15, 'cover');
    box(-4, -2, -15, 4, 2.4, -13, 'cover');

    const things = [
      { kind: 'gen', b: [-1.6, 0.08, -1.6, 1.6, 3.6, 1.6] },
      { kind: 'station', b: [4.5, 0, -7.9, 7.5, 0.42, -5.6] },
      { kind: 'station', b: [-7.5, 0, 5.6, -4.5, 0.42, 7.9] },
      { kind: 'turret', b: [9.2, 9, -8.4, 10.8, 10.4, -6.8] },
      { kind: 'turret', b: [9.2, 9, 6.8, 10.8, 10.4, 8.4] },
      { kind: 'sensor', b: [-34.8, 22, -1.8, -31.2, 24.5, 1.8] },
    ];
    const flag = [0, 9, 0];
    const stand = { b: [-1, 9, -1, 1, 9.4, 1], mat: 'stand' };
    W.push(stand);
    const spawns = [[-8, 0.2, -4], [-8, 0.2, 4], [6, 0.2, 3], [-6, 0.2, -3], [-28, 0, -10], [-28, 0, 10], [-40, 0, -6], [-40, 0, 6]];
    return { walls: W, things, flag: [0, 9.4, 0], spawns };
  }

  // place a local box into the world for a base at (bx, by, bz) facing `face` (+1 or -1)
  function placeBox(b, o) {
    if (o.face > 0) return [o.x + b[0], o.y + b[1], o.z + b[2], o.x + b[3], o.y + b[4], o.z + b[5]];
    return [o.x - b[3], o.y + b[1], o.z - b[5], o.x - b[0], o.y + b[4], o.z - b[2]];
  }
  const placePt = (p, o) => [o.x + p[0] * o.face, o.y + p[1], o.z + p[2] * o.face];

  // ---------- the world ----------
  class World {
    constructor(opts) {
      opts = opts || {};
      this.courseKey = has(COURSES, opts.course) ? opts.course : null;
      this.course = null; // built below: { def, gates, targets, start, yaw, kit, penalty }
      this.mapKey = this.courseKey ? COURSES[this.courseKey].map : has(MAPS, opts.map) ? opts.map : 'highland';
      this.def = MAPS[this.mapKey];
      this.terrain = opts.terrain || makeTerrain(this.mapKey);
      this.rng = mulberry(opts.seed == null ? 12345 : opts.seed);
      this.capLimit = clamp(opts.capLimit | 0 || 5, 1, 20);
      this.timeLimit = clamp(+opts.timeLimit || 20 * 60, 60, 3600);
      this.tick = 0;
      this.time = 0;
      this.players = new Map();
      this.proj = [];
      this.nextProj = 1;
      this.events = [];
      this.evSeq = 0;
      this.score = [0, 0];
      this.over = null;   // { winner, at }
      this.solids = [];   // { b, mat, team, obj }
      this.objects = [];
      this.flags = [];
      this.bases = [];
      this.buildBases();
      if (this.courseKey) this.buildCourse();
    }

    // Gates get a facing (from the gate before to the one after) and a centre on the land; targets become objects anyone can hit.
    buildCourse() {
      const def = COURSES[this.courseKey], t = this.terrain;
      const gates = def.gates.map(g => ({ c: [g[0], t.height(g[0], g[1]) + (g[2] == null ? GATE_H : g[2]), g[1]], r: g[3] || GATE_R, n: [0, 0, 1], air: g[2] != null && g[2] > GATE_H + 2 }));
      gates.forEach((g, i) => {
        const a = gates[Math.max(0, i - 1)].c, b = gates[Math.min(gates.length - 1, i + 1)].c;
        const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.sqrt(dx * dx + dz * dz) || 1;
        g.n = [dx / l, 0, dz / l];
      });
      const targets = def.targets.map((tg, ti) => {
        const y = t.height(tg[0], tg[1]) + (tg[2] == null ? 4 : tg[2]);
        const b = [tg[0] - 1.2, y - 1.2, tg[1] - 1.2, tg[0] + 1.2, y + 1.2, tg[1] + 1.2];
        // faces the nearest gate: that is where the shots come from
        let near = gates[0], nd = Infinity;
        for (const g of gates) { const d = (g.c[0] - tg[0]) ** 2 + (g.c[2] - tg[1]) ** 2; if (d < nd) { nd = d; near = g; } }
        const yaw = Math.atan2(-(near.c[0] - tg[0]), -(near.c[2] - tg[1]));
        const obj = { id: this.objects.length, kind: 'target', team: -1, ti, b, c: [tg[0], y, tg[1]], hp: 1, max: 1, up: true, yaw, pitch: 0, cd: 0, target: -1, repairT: 0 };
        this.objects.push(obj);
        const grp = this.baseBounds.length;
        this.solids.push({ b, mat: 'target', team: -1, obj, grp });
        this.baseBounds.push(b.slice());
        return obj;
      });
      const start = [def.start[0], t.height(def.start[0], def.start[1]), def.start[1]];
      const g0 = gates[0].c;
      this.course = {
        key: this.courseKey, def, gates, targets, start, yaw: Math.atan2(-(g0[0] - start[0]), -(g0[2] - start[2])),
        kit: cleanLoadout(def.kit || COURSE_KIT), penalty: def.penalty == null ? TARGET_PENALTY : def.penalty,
      };
    }

    buildBases() {
      const L = baseLayout();
      const pos = basePositions(this.def);
      const y = this.terrain.padH;
      pos.forEach((p, team) => {
        const o = { x: p.x, y, z: p.z, face: p.face };
        const base = { team, o, spawns: L.spawns.map(s => placePt(s, o)), bounds: null };
        for (const s of base.spawns) s[1] = Math.max(s[1], this.terrain.height(s[0], s[2]) + 0.1);
        let bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
        for (const w of L.walls) {
          const b = placeBox(w.b, o);
          this.solids.push({ b, mat: w.mat, team, grp: team });
          for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], b[i]); bb[i + 3] = Math.max(bb[i + 3], b[i + 3]); }
        }
        for (const t of L.things) {
          const b = placeBox(t.b, o);
          const obj = { id: this.objects.length, kind: t.kind, team, b, hp: OBJ[t.kind].hp, max: OBJ[t.kind].hp, up: true, yaw: o.face > 0 ? -Math.PI / 2 : Math.PI / 2, pitch: 0, cd: 0, target: -1, repairT: 0 };
          obj.c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
          // which way (world z) the wall behind a station is, for drawing its frame
          if (t.kind === 'station') obj.wall = Math.sign((t.b[2] + t.b[5]) / 2) * o.face;
          this.objects.push(obj);
          this.solids.push({ b, mat: t.kind, team, obj, grp: team });
          for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], b[i]); bb[i + 3] = Math.max(bb[i + 3], b[i + 3]); }
        }
        base.bounds = bb;
        this.bases.push(base);
        const home = placePt(L.flag, o);
        this.flags.push({ team, home, pos: home.slice(), vel: [0, 0, 0], state: 'home', carrier: -1, returnAt: 0 });
      });
      this.baseBounds = this.bases.map(b => b.bounds);
      this.buildProps();
    }

    // Neutral things out in the field: towers, arches, ruins, spires, bridges. Placed in point-symmetric pairs.
    // Each is its own group of boxes with its own bounds (this.baseBounds[grp]), so collision only looks at what is near.
    buildProps() {
      const def = this.def, t = this.terrain, c = SIZE / 2;
      const rng = mulberry(def.seed * 31 + 5);
      const placed = [];
      const add = (boxes, x, z, mat) => {
        for (const mirror of (x === c && z === c ? [false] : [false, true])) {
          const grp = this.baseBounds.length;
          const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
          for (const lb of boxes) {
            let b = mirror ? [2 * c - lb[3], lb[1], 2 * c - lb[5], 2 * c - lb[0], lb[4], 2 * c - lb[2]] : lb.slice(0, 6);
            this.solids.push({ b, mat: lb[6] || mat, team: -1, grp });
            for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], b[i]); bb[i + 3] = Math.max(bb[i + 3], b[i + 3]); }
          }
          this.baseBounds.push(bb);
        }
        placed.push([x, z], [2 * c - x, 2 * c - z]);
      };
      // boxes for one thing at (x, z), standing on the ground; y in local metres
      const make = (kind, x, z) => {
        const g = Math.min(t.height(x - 6, z - 6), t.height(x + 6, z - 6), t.height(x - 6, z + 6), t.height(x + 6, z + 6), t.height(x, z));
        const B = (x0, y0, z0, x1, y1, z1, mat) => [x + x0, g + y0, z + z0, x + x1, g + y1, z + z1, mat];
        const rot = rng() < 0.5; // arches and walls run along x or along z
        const R = (x0, y0, z0, x1, y1, z1, mat) => (rot ? B(z0, y0, x0, z1, y1, x1, mat) : B(x0, y0, z0, x1, y1, z1, mat));
        if (kind === 'tower') {
          const H = 22 + Math.floor(rng() * 12);
          return [B(-2, -3, -2, 2, H, 2), B(-6.5, H, -6.5, 6.5, H + 1, 6.5, 'deck'),
            B(-6.5, H + 1, -6.5, -5.8, H + 2.2, -1.5), B(-6.5, H + 1, 1.5, -5.8, H + 2.2, 6.5), B(5.8, H + 1, -6.5, 6.5, H + 2.2, -1.5), B(5.8, H + 1, 1.5, 6.5, H + 2.2, 6.5),
            B(-3.5, -3, -3.5, 3.5, 2, 3.5)];
        }
        if (kind === 'arch') {
          const W = 9 + Math.floor(rng() * 5), H = 12 + Math.floor(rng() * 6);
          return [R(-W - 3, -3, -1.6, -W, H, 1.6), R(W, -3, -1.6, W + 3, H, 1.6), R(-W - 3, H, -1.6, W + 3, H + 3, 1.6)];
        }
        if (kind === 'spire') {
          const H = 14 + Math.floor(rng() * 10);
          return [B(-4, -3, -4, 4, H * 0.45, 4), B(-2.6, H * 0.45, -2.6, 2.6, H * 0.8, 2.6), B(-1.4, H * 0.8, -1.4, 1.4, H, 1.4)];
        }
        // ruin: broken walls around a square
        const out = [];
        const n = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const side = i % 4, len = 4 + rng() * 7, h = 1.5 + rng() * 5, along = (rng() - 0.5) * 12;
          if (side === 0) out.push(B(along - len / 2, -2, -10, along + len / 2, h, -9));
          if (side === 1) out.push(B(along - len / 2, -2, 9, along + len / 2, h, 10));
          if (side === 2) out.push(B(-10, -2, along - len / 2, -9, h, along + len / 2));
          if (side === 3) out.push(B(9, -2, along - len / 2, 10, h, along + len / 2));
        }
        return out;
      };
      const free = (x, z, gap) => {
        if (x < AREA_MIN + 60 || x > AREA_MAX - 60 || z < AREA_MIN + 60 || z > AREA_MAX - 60) return false;
        for (const b of this.bases) if (Math.hypot(b.o.x - x, b.o.z - z) < 190) return false;
        for (const p of placed) if (Math.hypot(p[0] - x, p[1] - z) < gap) return false;
        if (t.waterH != null && t.height(x, z) < t.waterH + 3) return false;
        if (t.lavaH != null && t.height(x, z) < t.lavaH + 2) return false;
        if (def.shape === 'canyon' && Math.abs(x - canyonX(z)) < CANYON_W + 20) return false;
        if (t.normal(x, z)[1] < 0.8) return false;
        return true;
      };
      if (def.shape === 'canyon') {
        // three bridges across the canyon, at the rim height
        for (const dz of [0, -280]) {
          const zb = c + dz, xc = canyonX(zb);
          const rim = Math.max(t.height(xc - CANYON_W - 8, zb), t.height(xc + CANYON_W + 8, zb));
          const L = CANYON_W + 14, y = rim + 0.6;
          const floor = t.height(xc, zb);
          const boxes = [[xc - L, y - 1, zb - 4, xc + L, y, zb + 4, 'deck'],
            [xc - L, y, zb - 4, xc + L, y + 1.1, zb - 3.4], [xc - L, y, zb + 3.4, xc + L, y + 1.1, zb + 4],
            [xc - 22, floor - 2, zb - 1.5, xc - 19, y - 1, zb + 1.5], [xc + 19, floor - 2, zb - 1.5, xc + 22, y - 1, zb + 1.5]];
          if (dz === 0) { const grp = this.baseBounds.length; const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
            for (const lb of boxes) { this.solids.push({ b: lb.slice(0, 6), mat: lb[6] || 'stone', team: -1, grp }); for (let i = 0; i < 3; i++) { bb[i] = Math.min(bb[i], lb[i]); bb[i + 3] = Math.max(bb[i + 3], lb[i + 3]); } }
            this.baseBounds.push(bb); placed.push([xc, zb]);
          } else add(boxes, xc, zb, 'stone');
        }
      } else if (def.center) add(make(def.center, c, c), c, c, 'stone');
      for (const kind of def.props || []) {
        for (let tries = 0; tries < 60; tries++) {
          const x = AREA_MIN + rng() * (AREA_MAX - AREA_MIN), z = AREA_MIN + rng() * (AREA_MAX - AREA_MIN);
          if (!free(x, z, 150) || !free(2 * c - x, 2 * c - z, 150)) continue;
          add(make(kind, x, z), x, z, 'stone');
          break;
        }
      }
    }

    // ----- players -----
    addPlayer(o) {
      const id = o.id;
      const team = this.course ? 0 : o.team === 0 || o.team === 1 ? o.team : this.smallerTeam(); // a course has one team: nobody shoots anybody
      const p = newPlayer(id, cleanName(o.name), team, !!o.bot);
      p.loadout = cleanLoadout(o.loadout) || { ...DEFAULT_LOADOUT, weapons: DEFAULT_LOADOUT.weapons.slice() };
      this.players.set(id, p);
      p.deadT = RESPAWN_S - 0.4; p.wantSpawn = true;
      this.ev({ k: 'join', id, name: p.name, team });
      return p;
    }
    removePlayer(id) {
      const p = this.players.get(id);
      if (!p) return;
      if (p.flag >= 0) this.dropFlag(p, true);
      this.players.delete(id);
      this.ev({ k: 'leave', id, name: p.name });
    }
    smallerTeam() {
      const n = [0, 0];
      for (const p of this.players.values()) n[p.team]++;
      return n[0] <= n[1] ? 0 : 1;
    }
    setTeam(id, team) {
      const p = this.players.get(id);
      if (!p || (team !== 0 && team !== 1) || p.team === team || this.course) return;
      if (p.alive) this.kill(p, null, 'team');
      p.team = team;
      this.ev({ k: 'team', id, team });
    }

    ev(e) { e.t = this.tick; e.s = ++this.evSeq; this.events.push(e); }

    spawn(p) {
      if (this.course) return this.spawnCourse(p);
      const base = this.bases[p.team];
      const s = base.spawns[Math.floor(this.rng() * base.spawns.length)];
      p.alive = true;
      p.pos = [s[0] + (this.rng() - 0.5) * 2, s[1] + 0.2, s[2] + (this.rng() - 0.5) * 2];
      p.flagSeen = null; // no sweep from where you died
      p.vel = [0, 0, 0];
      p.yaw = base.o.face > 0 ? -Math.PI / 2 : Math.PI / 2; // facing the enemy
      p.pitch = 0;
      p.spawnYaw = p.yaw;
      equip(p, SPAWN_KIT);
      p.wi = Math.max(0, p.weapons.indexOf('disc')); // start with the disc in hand
      p.lastHitBy = -1;
      p.spawnProt = 2;
      this.ev({ k: 'spawn', id: p.id });
    }
    // a course: everyone starts behind the first gate, facing it, in the course's kit, with a fresh run
    spawnCourse(p) {
      const C = this.course;
      p.alive = true;
      p.pos = [C.start[0] + (this.rng() - 0.5) * 6, C.start[1] + 0.2, C.start[2] + (this.rng() - 0.5) * 6];
      p.vel = [0, 0, 0]; p.yaw = C.yaw; p.pitch = 0; p.spawnYaw = p.yaw;
      p.ground = false; p.kick = 0; p.flagSeen = null; p.gateSeen = null;
      equip(p, C.kit);
      p.wi = Math.max(0, p.weapons.indexOf('disc'));
      p.lastHitBy = -1; p.spawnProt = 0;
      p.run = newRun(C);
      this.ev({ k: 'spawn', id: p.id });
    }
    // back to the start, now (K): a run in progress is thrown away
    restart(p) {
      if (!this.course) return;
      if (p.alive) this.spawnCourse(p); else p.wantSpawn = true;
    }

    // the gate the player is due passes when the path since the last tick crosses its disc; the first starts the clock, the last stops it
    touchGates(p) {
      const run = p.run, C = this.course;
      const a = p.gateSeen || p.pos, b = p.pos;
      p.gateSeen = p.pos.slice();
      if (!run || run.done) return;
      const g = C.gates[run.gate];
      const da = (a[0] - g.c[0]) * g.n[0] + (a[2] - g.c[2]) * g.n[2], db = (b[0] - g.c[0]) * g.n[0] + (b[2] - g.c[2]) * g.n[2];
      if (da === db || da * db > 0) return; // did not cross the gate's plane
      const f = da / (da - db);
      const x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f + ARMORS[p.armor].h * 0.5, z = a[2] + (b[2] - a[2]) * f;
      if ((x - g.c[0]) ** 2 + (y - g.c[1]) ** 2 + (z - g.c[2]) ** 2 > g.r * g.r) return;
      const at = this.time - TICK * (1 - f);
      if (run.gate === 0) { run.t0 = at; this.ev({ k: 'cstart', id: p.id }); }
      else this.ev({ k: 'cgate', id: p.id, g: run.gate, n: C.gates.length, el: at - run.t0 });
      run.gate++;
      if (run.gate < C.gates.length) return;
      run.done = true; run.doneAt = this.time;
      run.time = at - run.t0; run.pen = (C.targets.length - run.hits) * C.penalty; run.total = run.time + run.pen;
      let best = 0;
      if (p.best < 0 || run.total < p.best) { p.best = run.total; best = 1; }
      p.runs++;
      this.ev({ k: 'cfinish', id: p.id, time: run.time, pen: run.pen, total: run.total, hits: run.hits, of: C.targets.length, best });
    }
    // targets are per player: hitting one counts for whoever shot it, during their run, once
    hitTarget(o, by) {
      const run = by && by.run;
      if (!run || run.t0 < 0 || run.done || run.hit[o.ti]) return;
      run.hit[o.ti] = true; run.hits++;
      this.ev({ k: 'ctarget', id: by.id, ti: o.ti, n: run.hits, of: this.course.targets.length });
    }

    // run one tick of one player's own input (movement, weapons). Called once per input the player sent.
    applyInput(p, inp) {
      if (!p.alive) {
        if ((inp.b & B.FIRE) && !(p.prevB & B.FIRE)) p.wantSpawn = true;
        p.prevB = inp.b;
        p.yaw = inp.yaw; p.pitch = inp.pitch;
        return;
      }
      movePlayer(this, p, inp, TICK);
      this.usePlayerTools(p, inp, TICK);
      p.prevB = inp.b;
    }

    // everything else that moves on its own: projectiles, flags, turrets, timers
    step() {
      const dt = TICK;
      this.tick++;
      this.time += dt;
      if (this.over) return;
      for (const p of this.players.values()) {
        if (!p.alive) {
          p.deadT += dt;
          const wait = this.course ? COURSE_RESPAWN_S : RESPAWN_S, auto = this.course ? COURSE_RESPAWN_S + 1.5 : AUTO_RESPAWN_S;
          if (p.deadT >= wait && (p.wantSpawn || p.bot || p.deadT >= auto)) { p.wantSpawn = false; this.spawn(p); }
          continue;
        }
        if (p.spawnProt > 0) p.spawnProt -= dt;
        if (this.course) this.touchGates(p);
        else { this.stations(p, dt); this.touchFlags(p); }
        if (p.pos[1] < this.terrain.height(p.pos[0], p.pos[2]) - 5) this.kill(p, null, 'stuck'); // fell through somehow
      }
      this.stepProjectiles(dt);
      this.stepFlags(dt);
      this.stepObjects(dt);
      if (!this.course && this.time >= this.timeLimit) this.finish(this.score[0] === this.score[1] ? -1 : this.score[0] > this.score[1] ? 0 : 1);
      if (this.events.length > 4000) this.events.splice(0, this.events.length - 2000);
    }

    finish(winner) {
      if (this.over) return;
      this.over = { winner, at: this.tick };
      this.ev({ k: 'over', winner });
    }

    power(team) {
      const g = this.objects.find(o => o.kind === 'gen' && o.team === team);
      return !!(g && g.up);
    }

    // ----- weapons and packs -----
    usePlayerTools(p, inp, dt) {
      const A = ARMORS[p.armor];
      if (p.fireCd > 0) p.fireCd -= dt;
      if (p.switchT > 0) p.switchT -= dt;
      if (p.gcd > 0) p.gcd -= dt;
      // switch weapon
      if (inp.w !== 255 && inp.w < p.weapons.length && inp.w !== p.wi) { p.wi = inp.w; p.switchT = 0.3; p.spin = 0; }
      const wk = p.weapons[p.wi];
      const W = wk && WEAPONS[wk];
      const fire = (inp.b & B.FIRE) !== 0;
      if (W && W.spin) p.spin = fire ? Math.min(W.spin, p.spin + dt) : Math.max(0, p.spin - dt * 0.6);
      p.elfT = -1;
      if (W && fire && p.switchT <= 0) {
        if (W.kind === 'beam') this.elf(p, W, dt);
        else if (p.fireCd <= 0 && (!W.spin || p.spin >= W.spin)) this.fireWeapon(p, wk, W);
      }
      // hand grenade
      if ((inp.b & B.GREN) && !(p.prevB & B.GREN) && p.grenades > 0 && p.gcd <= 0) {
        p.grenades--; p.gcd = 0.6;
        const f = aimDir(p.yaw, p.pitch + 0.12);
        this.launch(p, 'hgren', eye(p), f);
        this.ev({ k: 'fire', id: p.id, w: 'hgren' });
      }
      // packs
      const pressed = (inp.b & B.PACK) && !(p.prevB & B.PACK);
      p.repairing = -2;
      if (p.pack === 'shield') {
        if (pressed) p.shieldOn = !p.shieldOn;
        if (p.shieldOn) { p.energy -= 3.5 * dt; if (p.energy <= 0) { p.energy = 0; p.shieldOn = false; } }
      } else p.shieldOn = false;
      if (p.pack === 'repair' && (inp.b & B.PACK)) this.repair(p, dt);
      void A;
    }

    fireWeapon(p, wk, W) {
      if (W.ammo > 0) {
        if ((p.ammo[wk] | 0) <= 0) { p.fireCd = 0.3; this.ev({ k: 'dry', id: p.id }); return; }
        p.ammo[wk]--;
      }
      if (W.energy) {
        if (p.energy < W.energy) { p.fireCd = 0.2; return; }
        p.energy -= W.energy;
      }
      p.fireCd = W.cd;
      p.shots = (p.shots + 1) & 255;
      if (W.kind === 'hitscan') return this.laser(p, W);
      let f = aimDir(p.yaw, p.pitch);
      if (W.spread) {
        const s = W.spread;
        f = [f[0] + (this.rng() - 0.5) * 2 * s, f[1] + (this.rng() - 0.5) * 2 * s, f[2] + (this.rng() - 0.5) * 2 * s];
        const l = len3(f[0], f[1], f[2]); f = [f[0] / l, f[1] / l, f[2] / l];
      }
      this.launch(p, wk, eye(p), f);
      this.ev({ k: 'fire', id: p.id, w: wk });
    }

    // start a projectile at the eye, then move it out to the muzzle (blocked if a wall is in between)
    launch(p, kind, from, dir) {
      const W = PROJ[kind];
      const v = [dir[0] * W.speed + p.vel[0] * W.inherit, dir[1] * W.speed + p.vel[1] * W.inherit, dir[2] * W.speed + p.vel[2] * W.inherit];
      const r = rightDir(p.yaw);
      const muzzle = [from[0] + dir[0] * 0.9 + r[0] * 0.35, from[1] + dir[1] * 0.9 - 0.25, from[2] + dir[2] * 0.9 + r[2] * 0.35];
      const pr = { id: this.nextProj++ & 0xffff, kind, owner: p.id, team: p.team, pos: from.slice(), vel: v, age: 0, shot: p.shots, prev: from.slice() };
      // the hop from eye to muzzle can hit something (point blank)
      const hit = this.traceProj(pr, muzzle, p.id);
      if (hit) { this.explode(pr, hit); return; }
      pr.pos = muzzle; pr.prev = muzzle.slice();
      this.proj.push(pr);
    }

    // trace a projectile from its position to `to`; returns { pos, t, player?, obj?, normal } or null
    traceProj(pr, to, skipId) {
      const a = pr.pos, dx = to[0] - a[0], dy = to[1] - a[1], dz = to[2] - a[2];
      let best = null;
      const tg = this.terrain.raycast(a[0], a[1], a[2], to[0], to[1], to[2]);
      if (tg >= 0) best = { t: tg, what: 'ground' };
      // shots stop at the water's surface
      const wh = this.terrain.waterH;
      if (wh != null && a[1] >= wh && to[1] < wh) { const tw = (a[1] - wh) / (a[1] - to[1]); if (!best || tw < best.t) best = { t: tw, what: 'water' }; }
      for (let i = 0; i < this.baseBounds.length; i++) {
        if (segBox(a[0], a[1], a[2], dx, dy, dz, this.baseBounds[i], 1) < 0) continue;
        for (const s of this.solids) {
          if (s.grp !== i) continue;
          const t = segBox(a[0], a[1], a[2], dx, dy, dz, s.b, 0);
          if (t >= 0 && (!best || t < best.t)) best = { t, what: 'solid', solid: s };
        }
      }
      const pad = PROJ[pr.kind].r ? 0.15 : 0.1;
      for (const q of this.players.values()) {
        if (!q.alive || q.id === skipId) continue;
        if (q.id === pr.owner && pr.age < 0.25) continue;
        const A = ARMORS[q.armor];
        const t = segBox(a[0], a[1], a[2], dx, dy, dz, [q.pos[0] - A.r, q.pos[1], q.pos[2] - A.r, q.pos[0] + A.r, q.pos[1] + A.h, q.pos[2] + A.r], pad);
        if (t >= 0 && (!best || t < best.t)) best = { t, what: 'player', player: q };
      }
      if (!best) return null;
      best.pos = [a[0] + dx * best.t, a[1] + dy * best.t, a[2] + dz * best.t];
      return best;
    }

    stepProjectiles(dt) {
      const keep = [];
      for (const pr of this.proj) {
        const W = PROJ[pr.kind];
        pr.age += dt;
        if (W.grav) pr.vel[1] -= GRAV * dt;
        const to = [pr.pos[0] + pr.vel[0] * dt, pr.pos[1] + pr.vel[1] * dt, pr.pos[2] + pr.vel[2] * dt];
        const hit = this.traceProj(pr, to, -1);
        if (hit) {
          if (W.bounce && hit.what !== 'player' && hit.what !== 'water') {
            // grenades bounce off land and walls, then go off when the fuse runs out
            const n = this.surfaceNormal(hit);
            const vn = pr.vel[0] * n[0] + pr.vel[1] * n[1] + pr.vel[2] * n[2];
            pr.vel = [(pr.vel[0] - 2 * vn * n[0]) * W.bounce, (pr.vel[1] - 2 * vn * n[1]) * W.bounce, (pr.vel[2] - 2 * vn * n[2]) * W.bounce];
            pr.pos = [hit.pos[0] + n[0] * 0.08, hit.pos[1] + n[1] * 0.08, hit.pos[2] + n[2] * 0.08];
            if (Math.abs(vn) > 6) this.ev({ k: 'bounce', x: pr.pos[0], y: pr.pos[1], z: pr.pos[2] });
          } else if (W.arm && pr.age < W.arm && hit.what !== 'player') {
            pr.age = W.life; this.explode(pr, hit, true); continue; // a dud: no damage before it arms
          } else { this.explode(pr, hit); continue; }
        } else pr.pos = to;
        if (pr.age >= W.life || pr.pos[1] > CEILING + 200) {
          if (W.fuse || W.grav) this.explode(pr, { pos: pr.pos, what: 'air' });
          continue;
        }
        keep.push(pr);
      }
      this.proj = keep;
    }

    surfaceNormal(hit) {
      if (hit.what === 'water') return [0, 1, 0];
      if (hit.what === 'solid') {
        const b = hit.solid.b, p = hit.pos;
        const d = [p[0] - b[0], b[3] - p[0], p[1] - b[1], b[4] - p[1], p[2] - b[2], b[5] - p[2]];
        let k = 0;
        for (let i = 1; i < 6; i++) if (d[i] < d[k]) k = i;
        return [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]][k];
      }
      return this.terrain.normal(hit.pos[0], hit.pos[2]);
    }

    explode(pr, hit, dud) {
      const W = PROJ[pr.kind];
      const at = hit.pos;
      this.ev({ k: 'boom', w: pr.kind, x: at[0], y: at[1], z: at[2], id: pr.id, o: pr.owner, what: hit.what, dud: dud ? 1 : 0 });
      if (dud) return;
      const owner = this.players.get(pr.owner);
      // the blast's line of sight starts a little off whatever it hit: from the exact impact point the surface itself would block it
      const n = hit.what === 'ground' || hit.what === 'solid' || hit.what === 'water' ? this.surfaceNormal(hit) : null;
      if (W.r > 0) this.splash(at, W, pr, hit.player, n);
      else if (hit.player) {
        this.damage(hit.player, W.dmg, owner, pr.kind, pr.vel, W.knock, pr.team);
      }
      if (hit.what === 'solid' && hit.solid.obj && W.r === 0) this.hurtObj(hit.solid.obj, W.dmg, owner, pr.team);
    }

    splash(at, W, pr, direct, n) {
      const eye = n ? [at[0] + n[0] * 0.4, at[1] + n[1] * 0.4, at[2] + n[2] * 0.4] : at;
      const owner = this.players.get(pr.owner);
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const A = ARMORS[q.armor];
        // nearest point of the player's box
        const cx = clamp(at[0], q.pos[0] - A.r, q.pos[0] + A.r), cy = clamp(at[1], q.pos[1], q.pos[1] + A.h), cz = clamp(at[2], q.pos[2] - A.r, q.pos[2] + A.r);
        const d = q === direct ? 0 : len3(cx - at[0], cy - at[1], cz - at[2]);
        if (d >= W.r) continue;
        if (q !== direct && this.blocked(eye, [q.pos[0], q.pos[1] + A.h * 0.5, q.pos[2]])) continue;
        const f = 1 - d / W.r;
        // push away from the blast, from slightly below the centre so blasts at the feet lift you
        const mx = q.pos[0] - at[0], my = q.pos[1] + A.h * 0.5 - at[1] + 0.6, mz = q.pos[2] - at[2];
        const l = len3(mx, my, mz) || 1;
        const self = q.id === pr.owner;
        const dmg = W.dmg * (0.25 + 0.75 * f) * (self ? 0.5 : 1);
        this.damage(q, dmg, owner, pr.kind, [mx / l, my / l, mz / l], W.knock * (0.3 + 0.7 * f), pr.team, true);
      }
      for (const o of this.objects) {
        if (o.team === pr.team) continue;
        const cx = clamp(at[0], o.b[0], o.b[3]), cy = clamp(at[1], o.b[1], o.b[4]), cz = clamp(at[2], o.b[2], o.b[5]);
        const d = len3(cx - at[0], cy - at[1], cz - at[2]);
        if (d >= W.r) continue;
        this.hurtObj(o, W.dmg * (1 - d / W.r) * (o.kind === 'gen' ? 1.3 : 1), owner, pr.team);
      }
    }

    // is the straight line between two points blocked by land or a building?
    blocked(a, b) {
      if (this.terrain.raycast(a[0], a[1], a[2], b[0], b[1], b[2]) >= 0) return true;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      for (let i = 0; i < this.baseBounds.length; i++) {
        if (segBox(a[0], a[1], a[2], dx, dy, dz, this.baseBounds[i], 0) < 0) continue;
        for (const s of this.solids) if (s.grp === i && !s.obj && segBox(a[0], a[1], a[2], dx, dy, dz, s.b, -0.05) >= 0) return true;
      }
      return false;
    }

    // dir is the direction of the shove (for direct hits the projectile's velocity)
    damage(q, dmg, by, weapon, dir, knock, team, splash) {
      if (!q.alive) return;
      const friendly = team === q.team && (!by || by.id !== q.id);
      if (friendly) return; // no team damage
      if (q.spawnProt > 0 && by && by.id !== q.id) dmg *= 0.25;
      // shove
      if (knock && dir) {
        // a blast always lifts you a little, and you stay off your feet for a moment, so ground friction does not eat the shove
        let l = len3(dir[0], dir[1], dir[2]) || 1;
        let dx = dir[0] / l, dy = dir[1] / l, dz = dir[2] / l;
        if (knock > 4 && dy < 0.35) { dy = 0.35; l = len3(dx, dy, dz); dx /= l; dy /= l; dz /= l; }
        const k = knock / ARMORS[q.armor].mass;
        q.vel[0] += dx * k; q.vel[1] += dy * k; q.vel[2] += dz * k;
        if (knock > 4) { q.ground = false; q.kick = 0.4; }
      }
      if (q.shieldOn && q.energy > 0) {
        const absorb = Math.min(dmg, q.energy * 1.4);
        q.energy -= absorb / 1.4; dmg -= absorb;
        this.ev({ k: 'shield', id: q.id });
      }
      if (dmg <= 0) return;
      q.hp -= dmg;
      if (by && by.id !== q.id) { q.lastHitBy = by.id; q.lastHitT = this.time; this.ev({ k: 'hit', by: by.id, id: q.id, d: Math.round(dmg) }); }
      if (q.hp <= 0) this.kill(q, by, weapon);
      void splash;
    }

    kill(q, by, weapon) {
      if (!q.alive) return;
      q.alive = false; q.hp = 0; q.deadT = 0; q.wantSpawn = false; q.deaths++;
      q.shieldOn = false;
      let killer = by && by.id !== q.id ? by : null;
      // falling or flying out after someone hit you still counts for them
      if (!killer && q.lastHitBy >= 0 && this.time - q.lastHitT < 6) killer = this.players.get(q.lastHitBy) || null;
      if (killer && killer.team !== q.team) { killer.kills++; killer.score += 1; }
      else if (weapon !== 'team') q.score = Math.max(0, q.score - 1);
      if (q.flag >= 0) {
        if (killer && killer.team !== q.team) killer.score += 1; // stopped a runner
        this.dropFlag(q, false);
      }
      // a midair: a disc that got you while you were well off the ground (the page shows the victim a replay)
      const mid = weapon === 'disc' && killer && killer.team !== q.team && !q.ground && q.pos[1] - this.terrain.height(q.pos[0], q.pos[2]) > MIDAIR_H;
      this.ev({ k: 'kill', id: q.id, by: killer ? killer.id : -1, w: weapon, x: q.pos[0], y: q.pos[1], z: q.pos[2], mid: mid ? 1 : 0 });
    }

    laser(p, W) {
      const e = p.energy;
      if (e < W.minEnergy) { p.fireCd = 0.3; this.ev({ k: 'dry', id: p.id }); return; }
      p.energy = 0;
      const from = eye(p), f = aimDir(p.yaw, p.pitch);
      const to = [from[0] + f[0] * W.range, from[1] + f[1] * W.range, from[2] + f[2] * W.range];
      const hit = this.traceProj({ pos: from, kind: 'laser', owner: p.id, age: 1 }, to, p.id);
      const end = hit ? hit.pos : to;
      this.ev({ k: 'laser', id: p.id, x0: from[0], y0: from[1], z0: from[2], x: end[0], y: end[1], z: end[2] });
      if (hit && hit.player && hit.player.team !== p.team) {
        const q = hit.player, head = hit.pos[1] > q.pos[1] + ARMORS[q.armor].h - 0.45;
        const dmg = (W.dmg + e * W.perEnergy) * (head ? 2 : 1);
        this.damage(q, dmg, p, head ? 'laser-head' : 'laser', f, 2, p.team);
      } else if (hit && hit.what === 'solid' && hit.solid.obj) this.hurtObj(hit.solid.obj, W.dmg, p, p.team);
    }

    elf(p, W, dt) {
      const from = eye(p), f = aimDir(p.yaw, p.pitch);
      let best = null, bestScore = Infinity;
      for (const q of this.players.values()) {
        if (!q.alive || q.team === p.team) continue;
        const c = [q.pos[0] - from[0], q.pos[1] + ARMORS[q.armor].h * 0.6 - from[1], q.pos[2] - from[2]];
        const d = len3(c[0], c[1], c[2]);
        if (d > W.range) continue;
        const cos = (c[0] * f[0] + c[1] * f[1] + c[2] * f[2]) / d;
        if (cos < 0.985) continue;
        const sc = d * (2 - cos);
        if (sc < bestScore && !this.blocked(from, [q.pos[0], q.pos[1] + 1, q.pos[2]])) { best = q; bestScore = sc; }
      }
      if (!best) return;
      p.elfT = best.id;
      best.energy = Math.max(0, best.energy - W.drain * dt);
      this.damage(best, W.dmg * dt, p, 'elf', null, 0, p.team);
    }

    repair(p, dt) {
      const from = eye(p), f = aimDir(p.yaw, p.pitch);
      const to = [from[0] + f[0] * 9, from[1] + f[1] * 9, from[2] + f[2] * 9];
      // a friendly object in front of you
      let best = null, bt = Infinity;
      for (const o of this.objects) {
        if (o.team !== p.team || o.hp >= o.max) continue;
        const t = segBox(from[0], from[1], from[2], to[0] - from[0], to[1] - from[1], to[2] - from[2], o.b, 0.6);
        if (t >= 0 && t < bt) { best = o; bt = t; }
      }
      if (best) {
        best.hp = Math.min(best.max, best.hp + 70 * dt);
        best.repairBy = p.id;
        if (!best.up && best.hp >= best.max * ONLINE_AT) { best.up = true; p.score += 1; this.ev({ k: 'obj', id: best.id, up: 1, by: p.id }); }
        p.repairing = 1000 + best.id;
        return;
      }
      let friend = null;
      for (const q of this.players.values()) {
        if (!q.alive || q.team !== p.team || q === p || q.hp >= ARMORS[q.armor].hp) continue;
        const A = ARMORS[q.armor];
        const t = segBox(from[0], from[1], from[2], to[0] - from[0], to[1] - from[1], to[2] - from[2], [q.pos[0] - A.r, q.pos[1], q.pos[2] - A.r, q.pos[0] + A.r, q.pos[1] + A.h, q.pos[2] + A.r], 0.5);
        if (t >= 0) { friend = q; break; }
      }
      const who = friend || p;
      const max = ARMORS[who.armor].hp;
      if (who.hp < max) { who.hp = Math.min(max, who.hp + 16 * dt); p.repairing = who.id; }
    }

    hurtObj(o, dmg, by, team) {
      if (o.kind === 'target') { if (dmg > 0) this.hitTarget(o, by); return; }
      if (o.team === team || dmg <= 0) return;
      const was = o.hp;
      o.hp = Math.max(0, o.hp - dmg);
      if (was > 0) this.ev({ k: 'ohit', id: o.id, by: by ? by.id : -1, d: Math.round(dmg) });
      if (was > 0 && o.hp <= 0 && o.up) {
        o.up = false;
        if (by) by.score += o.kind === 'gen' ? 3 : 1;
        this.ev({ k: 'obj', id: o.id, up: 0, by: by ? by.id : -1 });
      }
    }

    // ----- stations -----
    stations(p, dt) {
      if (p.stationCd > 0) { p.stationCd -= dt; }
      let on = null;
      for (const o of this.objects) {
        if (o.kind !== 'station' || o.team !== p.team) continue;
        const b = o.b;
        if (p.pos[0] > b[0] && p.pos[0] < b[3] && p.pos[2] > b[2] && p.pos[2] < b[5] && p.pos[1] > b[4] - 0.3 && p.pos[1] < b[4] + 0.6) { on = o; break; }
      }
      if (!on) { p.stationT = 0; p.stationId = -1; return; }
      if (!on.up || !this.power(p.team)) { p.stationId = -2; p.stationT = 0; return; }
      if (p.stationCd > 0) { p.stationId = -3; return; }
      p.stationId = on.id;
      p.stationT += dt;
      if (p.stationT >= STATION_S) {
        const flag = p.flag;
        equip(p, p.loadout);
        p.flag = flag;
        p.stationT = 0; p.stationCd = 3;
        this.ev({ k: 'station', id: p.id });
      }
    }

    // ----- flags -----
    nearFlag(p, f, from) {
      const A = ARMORS[p.armor];
      const n = Math.min(12, Math.ceil(Math.sqrt((p.pos[0] - from[0]) ** 2 + (p.pos[1] - from[1]) ** 2 + (p.pos[2] - from[2]) ** 2) / 0.8));
      for (let i = 0; i <= n; i++) {
        const t = n ? i / n : 1;
        const x = from[0] + (p.pos[0] - from[0]) * t, y = from[1] + (p.pos[1] - from[1]) * t, z = from[2] + (p.pos[2] - from[2]) * t;
        const dx = f.pos[0] - x, dz = f.pos[2] - z;
        if (dx * dx + dz * dz > FLAG_R * FLAG_R) continue;
        if (y <= f.pos[1] + FLAG_TOP && y + A.h >= f.pos[1] - 0.6) return true;
      }
      return false;
    }

    // the flag counts as a post about 3 m tall with the cloth around it. Checked along the path walked since the last tick,
    // so flying fast past it, or skimming over the top, still picks it up
    touchFlags(p) {
      const last = p.flagSeen || p.pos;
      const mx = p.pos[0] - last[0], my = p.pos[1] - last[1], mz = p.pos[2] - last[2];
      const far = mx * mx + my * my + mz * mz > 30 * 30; // a jump this big is not a flight
      p.flagSeen = p.pos.slice();
      for (const f of this.flags) {
        if (f.state === 'carried') continue;
        if (!this.nearFlag(p, f, far ? p.pos : last)) continue;
        if (f.team !== p.team) {
          if (p.flag >= 0) continue;
          f.state = 'carried'; f.carrier = p.id; p.flag = f.team;
          p.score += 1;
          this.ev({ k: 'flag', a: 'take', team: f.team, id: p.id });
        } else if (f.state === 'dropped') {
          this.returnFlag(f, p);
        } else if (f.state === 'home' && p.flag >= 0) {
          // capture
          const other = this.flags[p.flag];
          other.state = 'home'; other.pos = other.home.slice(); other.carrier = -1; other.vel = [0, 0, 0];
          p.flag = -1; p.caps++; p.score += 5;
          this.score[p.team]++;
          this.ev({ k: 'flag', a: 'cap', team: other.team, id: p.id });
          if (this.score[p.team] >= this.capLimit) this.finish(p.team);
        }
      }
    }
    returnFlag(f, by) {
      f.state = 'home'; f.pos = f.home.slice(); f.carrier = -1; f.vel = [0, 0, 0];
      if (by) by.score += 1;
      this.ev({ k: 'flag', a: 'return', team: f.team, id: by ? by.id : -1 });
    }
    dropFlag(p, quiet) {
      const f = this.flags[p.flag];
      p.flag = -1;
      if (!f) return;
      f.state = 'dropped'; f.carrier = -1;
      f.pos = [p.pos[0], p.pos[1] + 1, p.pos[2]];
      f.vel = [p.vel[0] * 0.7, Math.max(4, p.vel[1] * 0.5 + 4), p.vel[2] * 0.7];
      f.returnAt = this.time + FLAG_RETURN_S;
      this.ev({ k: 'flag', a: 'drop', team: f.team, id: p.id, quiet: quiet ? 1 : 0 });
    }
    stepFlags(dt) {
      for (const f of this.flags) {
        if (f.state === 'carried') {
          const c = this.players.get(f.carrier);
          if (!c || !c.alive) { f.state = 'dropped'; f.returnAt = this.time + FLAG_RETURN_S; continue; }
          f.pos = [c.pos[0], c.pos[1] + ARMORS[c.armor].h * 0.6, c.pos[2]];
          f.vel = c.vel.slice();
        } else if (f.state === 'dropped') {
          if (this.time >= f.returnAt) { this.returnFlag(f, null); continue; }
          f.vel[1] -= GRAV * dt;
          const to = [f.pos[0] + f.vel[0] * dt, f.pos[1] + f.vel[1] * dt, f.pos[2] + f.vel[2] * dt];
          const hit = this.traceProj({ pos: f.pos, kind: 'disc', owner: -1, age: 9 }, to, -1);
          if (hit && hit.what !== 'player') {
            f.pos = [hit.pos[0], hit.pos[1] + 0.05, hit.pos[2]];
            const n = this.surfaceNormal(hit);
            if (n[1] > 0.5) f.vel = [0, 0, 0];
            else { const vn = f.vel[0] * n[0] + f.vel[1] * n[1] + f.vel[2] * n[2]; f.vel = [f.vel[0] - vn * n[0] * 1.3, f.vel[1] - vn * n[1] * 1.3, f.vel[2] - vn * n[2] * 1.3]; }
          } else f.pos = to;
          // out of the area or below the land: send it home
          if (f.pos[0] < 0 || f.pos[0] > SIZE || f.pos[2] < 0 || f.pos[2] > SIZE || f.pos[1] < this.terrain.height(f.pos[0], f.pos[2]) - 3) this.returnFlag(f, null);
        }
      }
    }

    // ----- turrets and generators -----
    stepObjects(dt) {
      if (this.course) return; // no turrets on a course
      for (const o of this.objects) {
        if (o.kind !== 'turret') continue;
        if (o.cd > 0) o.cd -= dt;
        o.target = -1;
        if (!o.up || !this.power(o.team)) continue;
        const head = [o.c[0], o.b[4] + 0.3, o.c[2]];
        let best = null, bd = OBJ.turret.range;
        for (const q of this.players.values()) {
          if (!q.alive || q.team === o.team) continue;
          const c = [q.pos[0], q.pos[1] + 1, q.pos[2]];
          const d = len3(c[0] - head[0], c[1] - head[1], c[2] - head[2]);
          if (d < bd && !this.blocked(head, c)) { best = q; bd = d; }
        }
        if (!best) continue;
        o.target = best.id;
        // turrets turn slowly, lead only part of the way, and scatter a little: move and you can beat them
        const T = OBJ.turret, W = PROJ.tbolt;
        const v = best.vel;
        const aim = leadAim(head, [best.pos[0], best.pos[1] + 1, best.pos[2]], [v[0] * T.lead, v[1] * T.lead, v[2] * T.lead], W.speed, 0);
        const wantYaw = Math.atan2(-aim[0], -aim[2]), wantPitch = Math.asin(clamp(aim[1], -1, 1));
        let dyaw = (wantYaw - o.yaw) % (Math.PI * 2);
        if (dyaw > Math.PI) dyaw -= Math.PI * 2;
        if (dyaw < -Math.PI) dyaw += Math.PI * 2;
        const step = T.turn * dt;
        o.yaw += clamp(dyaw, -step, step);
        o.pitch += clamp(wantPitch - o.pitch, -step, step);
        if (o.cd <= 0 && Math.abs(dyaw) < 0.08 && Math.abs(wantPitch - o.pitch) < 0.08) {
          o.cd = T.cd;
          const sy = o.yaw + (this.rng() - 0.5) * 2 * T.spread, sp = o.pitch + (this.rng() - 0.5) * 2 * T.spread;
          const cp = Math.cos(sp);
          const dir = [-Math.sin(sy) * cp, Math.sin(sp), -Math.cos(sy) * cp];
          const muzzle = [head[0] + dir[0] * 1.2, head[1] + dir[1] * 1.2, head[2] + dir[2] * 1.2];
          this.proj.push({ id: this.nextProj++ & 0xffff, kind: 'tbolt', owner: -1 - o.id, team: o.team, pos: muzzle, vel: [dir[0] * W.speed, dir[1] * W.speed, dir[2] * W.speed], age: 0, shot: 0, prev: muzzle.slice() });
          this.ev({ k: 'tfire', id: o.id });
        }
      }
    }
  }

  // ---------- players ----------
  function newPlayer(id, name, team, bot) {
    return {
      id, name, team, bot,
      alive: false, deadT: 0, wantSpawn: false,
      pos: [SIZE / 2, 200, SIZE / 2], vel: [0, 0, 0], yaw: 0, pitch: 0,
      ground: false, gn: [0, 1, 0], skiing: false, jetting: false, kick: 0,
      armor: 'light', hp: 70, energy: 60,
      weapons: ['blaster'], wi: 0, ammo: {}, pack: 'none', grenades: 0,
      fireCd: 0, switchT: 0, spin: 0, gcd: 0, shots: 0, elfT: -1, repairing: -2,
      shieldOn: false, flag: -1, spawnProt: 0,
      stationT: 0, stationCd: 0, stationId: -1,
      loadout: null, prevB: 0, seq: 0,
      kills: 0, deaths: 0, caps: 0, score: 0, lastHitBy: -1, lastHitT: 0,
      run: null, best: -1, runs: 0, gateSeen: null, // courses
    };
  }
  const newRun = C => ({ gate: 0, t0: -1, time: -1, pen: 0, total: -1, hit: C.targets.map(() => false), hits: 0, done: false, doneAt: 0 });

  function equip(p, lo) {
    const A = ARMORS[lo.armor];
    p.armor = lo.armor;
    p.hp = A.hp; p.energy = A.energy;
    p.weapons = lo.weapons.slice(0, A.slots);
    p.pack = lo.pack;
    p.ammo = {};
    const mult = lo.pack === 'ammo' ? 1.5 : 1;
    for (const w of p.weapons) p.ammo[w] = Math.round(WEAPONS[w].ammo * mult);
    p.grenades = A.grenades + (lo.pack === 'ammo' ? 2 : 0);
    if (p.wi >= p.weapons.length) p.wi = 0;
    p.flag = -1; p.shieldOn = false; p.spin = 0; p.fireCd = 0.2;
  }

  // a loadout from the player (or the network): only known names, only what the armor can carry
  function cleanLoadout(lo) {
    if (!lo || typeof lo !== 'object') return null;
    const armor = has(ARMORS, lo.armor) ? lo.armor : null;
    if (!armor) return null;
    const A = ARMORS[armor];
    const ws = [];
    if (Array.isArray(lo.weapons)) for (const w of lo.weapons) {
      if (typeof w === 'string' && has(WEAPONS, w) && !NOT_FOR[armor].includes(w) && !ws.includes(w) && ws.length < A.slots) ws.push(w);
    }
    if (!ws.length) ws.push('blaster');
    const pack = has(PACKS, lo.pack) ? lo.pack : 'none';
    return { armor, weapons: ws, pack };
  }

  function cleanName(s) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20);
    return s || 'player';
  }

  const aimDir = (yaw, pitch) => {
    const cp = Math.cos(pitch);
    return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
  };
  const rightDir = yaw => [Math.cos(yaw), 0, -Math.sin(yaw)];
  const eye = p => [p.pos[0], p.pos[1] + ARMORS[p.armor].h - 0.25, p.pos[2]];

  // where to aim from `from` to hit something at `pos` moving at `vel`, with a projectile of `speed` (and gravity scale g)
  function leadAim(from, pos, vel, speed, g) {
    let t = len3(pos[0] - from[0], pos[1] - from[1], pos[2] - from[2]) / speed;
    let aim = [0, 0, -1];
    for (let i = 0; i < 4; i++) {
      const tx = pos[0] + vel[0] * t - from[0], ty = pos[1] + vel[1] * t - from[1] + 0.5 * GRAV * g * t * t, tz = pos[2] + vel[2] * t - from[2];
      const l = len3(tx, ty, tz) || 1;
      aim = [tx / l, ty / l, tz / l];
      t = l / speed;
    }
    return aim;
  }

  // ---------- movement (shared with prediction: keep it a pure function of world geometry, player and input) ----------
  // Input: { b: buttons, mx, mz: -1..1 strafe and forward, yaw, pitch, w: weapon index or 255 }
  function movePlayer(world, p, inp, dt) {
    const A = ARMORS[p.armor];
    p.yaw = inp.yaw; p.pitch = inp.pitch;
    const v = p.vel;
    // wish direction on the flat
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let wx = -sy * inp.mz + cy * inp.mx, wz = -cy * inp.mz - sy * inp.mx;
    let wl = Math.sqrt(wx * wx + wz * wz);
    if (wl > 1) { wx /= wl; wz /= wl; wl = 1; }
    const hold = b => (inp.b & b) !== 0;
    const press = b => hold(b) && !(p.prevB & b);
    if (p.kick > 0) p.kick -= dt;

    // energy and jets
    const regen = A.regen + (p.pack === 'energy' ? PACKS.energy.regen : 0);
    p.jetting = false;
    if (hold(B.JET) && p.energy > (p.wasJet ? 0 : 3) && p.pos[1] < CEILING) {
      p.jetting = true;
      p.energy -= A.jetCost * dt;
      if (p.energy < 0) p.energy = 0;
      let up = A.jet, side = 0;
      if (wl > 0.05) { up = A.jet * (1 - 0.15 * wl); side = A.jet * 0.5 * wl; }
      // sideways thrust only helps until you are already going fast that way
      const along = (v[0] * wx + v[2] * wz) / (wl || 1);
      if (along > 38) side *= Math.max(0, 1 - (along - 38) / 12);
      v[1] += up * dt;
      if (wl > 0) { v[0] += wx / wl * side * dt; v[2] += wz / wl * side * dt; }
    } else {
      p.energy = Math.min(A.energy, p.energy + regen * dt);
    }
    p.wasJet = p.jetting;

    v[1] -= GRAV * dt;
    p.skiing = false;
    if (p.ground && p.kick <= 0) {
      const n = p.gn;
      const walk = n[1] > 0.72;
      if (hold(B.JUMP)) {
        // ski: no friction, the hill does the work. A little steering.
        p.skiing = true;
        if (wl > 0) { v[0] += wx * 5 * dt; v[2] += wz * 5 * dt; }
        if (press(B.JUMP)) { v[0] += n[0] * A.jump * 0.3; v[1] += A.jump; v[2] += n[2] * A.jump * 0.3; p.ground = false; }
      } else if (walk) {
        // walking: speed up towards the wish speed, and slow down hard above it (no friction loss while skiing)
        const tx = wx * A.run, tz = wz * A.run;
        const dx = tx - v[0], dz = tz - v[2];
        const dl = Math.sqrt(dx * dx + dz * dz);
        const acc = (Math.sqrt(v[0] * v[0] + v[2] * v[2]) > A.run + 1 ? A.accel * 0.7 : A.accel) * dt;
        if (dl > 0) { const k = Math.min(1, acc / dl); v[0] += dx * k; v[2] += dz * k; }
        // follow the slope: standing on a hill does not slide you down it
        if (!p.jetting) v[1] = -(n[0] * v[0] + n[2] * v[2]) / n[1];
      }
    } else {
      // air control: small, and only to speed up in a direction you are slow in
      if (wl > 0) {
        const along = v[0] * wx + v[2] * wz;
        if (along < 14 * wl) { v[0] += wx * 7 * dt; v[2] += wz * 7 * dt; }
      }
    }
    // air drag
    const sp = len3(v[0], v[1], v[2]);
    if (sp > 1) { const k = Math.max(0, 1 - 0.00038 * sp * dt); v[0] *= k; v[1] *= k; v[2] *= k; }
    if (p.pos[1] > CEILING && v[1] > 0) v[1] *= 0.9;

    // water: slows you down and holds you up; you can jet out
    const wh = world.terrain.waterH;
    if (wh != null && p.pos[1] < wh) {
      const depth = wh - p.pos[1];
      const k = Math.max(0, 1 - 2.2 * dt);
      v[0] *= k; v[2] *= k; v[1] *= Math.max(0, 1 - 3 * dt);
      v[1] += Math.min(depth, A.h) * 16 * dt;
    }

    // mission area: a push back towards the middle
    const x = p.pos[0], z = p.pos[2];
    if (x < AREA_MIN) v[0] += (AREA_MIN - x) * 1.5 * dt + 20 * dt;
    if (x > AREA_MAX) v[0] -= (x - AREA_MAX) * 1.5 * dt + 20 * dt;
    if (z < AREA_MIN) v[2] += (AREA_MIN - z) * 1.5 * dt + 20 * dt;
    if (z > AREA_MAX) v[2] -= (z - AREA_MAX) * 1.5 * dt + 20 * dt;

    // move in small steps so fast skiers cannot pass through walls
    const dist = len3(v[0], v[1], v[2]) * dt;
    const steps = Math.min(24, Math.max(1, Math.ceil(dist / 0.35)));
    const h = dt / steps;
    let touched = false, landed = null;
    for (let i = 0; i < steps; i++) {
      p.pos[0] += v[0] * h; p.pos[1] += v[1] * h; p.pos[2] += v[2] * h;
      p.pos[0] = clamp(p.pos[0], 4, SIZE - 4); p.pos[2] = clamp(p.pos[2], 4, SIZE - 4);
      const c = collide(world, p, A);
      if (c) { touched = true; if (!landed || c.impact < landed.impact) landed = c; }
    }
    // stay stuck to the ground over small bumps when walking
    if (!touched && p.ground && !p.jetting && !hold(B.JUMP) && v[1] <= 0.5) {
      const g = world.terrain.height(p.pos[0], p.pos[2]);
      if (p.pos[1] - g < 0.4 && p.pos[1] - g > -0.01) { p.pos[1] = g; touched = true; landed = { n: world.terrain.normal(p.pos[0], p.pos[2]), impact: 0 }; }
    }
    p.ground = touched && landed.n[1] > 0.3;
    if (landed) p.gn = landed.n;
    p.fallDmg = 0;
    if (landed && landed.impact < -A.impact) p.fallDmg = (-landed.impact - A.impact) * 2.2;
    if (wh != null && p.pos[1] < wh + 0.5) p.fallDmg = 0; // a splash, not a crash
    if (p.fallDmg > 0 && world.damage) world.damage(p, p.fallDmg, null, 'fall', null, 0, -1);
    // lava burns while you stand in it
    const lh = world.terrain.lavaH;
    if (lh != null && touched && world.damage && world.terrain.height(p.pos[0], p.pos[2]) < lh && p.pos[1] < lh + 0.4) world.damage(p, 34 * dt, null, 'lava', null, 0, -1);
  }

  // push the player out of the land and the buildings; returns the contact (normal and how hard you hit) or null
  function collide(world, p, A) {
    const v = p.vel;
    let hit = null;
    const g = world.terrain.height(p.pos[0], p.pos[2]);
    if (p.pos[1] < g) {
      const n = world.terrain.normal(p.pos[0], p.pos[2]);
      p.pos[1] = g;
      const vn = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
      if (vn < 0) { v[0] -= vn * n[0]; v[1] -= vn * n[1]; v[2] -= vn * n[2]; }
      hit = { n, impact: vn };
    }
    const r = A.r;
    const px0 = p.pos[0] - r, px1 = p.pos[0] + r, py0 = p.pos[1], py1 = p.pos[1] + A.h, pz0 = p.pos[2] - r, pz1 = p.pos[2] + r;
    const bbs = world.baseBounds;
    for (let i = 0; i < bbs.length; i++) {
      const bb = bbs[i];
      if (px1 < bb[0] || px0 > bb[3] || py1 < bb[1] || py0 > bb[4] || pz1 < bb[2] || pz0 > bb[5]) continue;
      for (const s of world.solids) {
        if (s.grp !== i) continue;
        const b = s.b;
        const qx0 = p.pos[0] - r, qx1 = p.pos[0] + r, qy0 = p.pos[1], qy1 = p.pos[1] + A.h, qz0 = p.pos[2] - r, qz1 = p.pos[2] + r;
        if (qx1 <= b[0] || qx0 >= b[3] || qz1 <= b[2] || qz0 >= b[5]) continue;
        // standing on top (or a hair above): that is ground too
        if (qy0 >= b[4] - 1e-4 && qy0 <= b[4] + 0.06 && v[1] <= 0.5) { p.pos[1] = b[4]; const imp = Math.min(0, v[1]); if (v[1] < 0) v[1] = 0; hit = pick(hit, [0, 1, 0], imp); continue; }
        if (qy1 <= b[1] || qy0 >= b[4]) continue;
        const ox = Math.min(qx1 - b[0], b[3] - qx0), oy0 = b[4] - qy0, oy1 = qy1 - b[1], oz = Math.min(qz1 - b[2], b[5] - qz0);
        // step up onto low things (station pads, steps, the flag stand)
        if (oy0 <= 0.55) { p.pos[1] = b[4]; if (v[1] < 0) { const imp = v[1]; v[1] = 0; hit = pick(hit, [0, 1, 0], imp); } else hit = pick(hit, [0, 1, 0], 0); continue; }
        const oy = Math.min(oy0, oy1);
        if (oy <= ox && oy <= oz) {
          if (oy0 < oy1) { p.pos[1] = b[4]; if (v[1] < 0) { const imp = v[1]; v[1] = 0; hit = pick(hit, [0, 1, 0], imp); } else hit = pick(hit, [0, 1, 0], 0); }
          else { p.pos[1] = b[1] - A.h; if (v[1] > 0) v[1] = 0; }
        } else if (ox <= oz) {
          if (qx1 - b[0] < b[3] - qx0) { p.pos[0] = b[0] - r; if (v[0] > 0) v[0] = 0; } else { p.pos[0] = b[3] + r; if (v[0] < 0) v[0] = 0; }
        } else {
          if (qz1 - b[2] < b[5] - qz0) { p.pos[2] = b[2] - r; if (v[2] > 0) v[2] = 0; } else { p.pos[2] = b[5] + r; if (v[2] < 0) v[2] = 0; }
        }
      }
    }
    return hit;
  }
  const pick = (a, n, impact) => (!a || impact < a.impact ? { n, impact } : a);

  const api = {
    TICK, GRAV, N, CELL, SIZE, AREA_MIN, AREA_MAX, CEILING, TEAMS, B,
    ARMORS, ARMOR_KEYS, WEAPONS, WEAPON_KEYS, NOT_FOR, PROJ, PROJ_BY_CODE, PACKS, PACK_KEYS, OBJ, ONLINE_AT,
    SPAWN_KIT, DEFAULT_LOADOUT, RESPAWN_S, AUTO_RESPAWN_S, FLAG_RETURN_S, STATION_S,
    MAPS, MAP_KEYS, basePositions, baseLayout, placeBox,
    COURSES, COURSE_KEYS, COURSE_KIT, GATE_H, GATE_R, TARGET_PENALTY, COURSE_RESPAWN_S, newRun,
    mulberry, fbm, vnoise, makeTerrain, Terrain, segBox,
    World, newPlayer, equip, cleanLoadout, cleanName, movePlayer, aimDir, rightDir, eye, leadAim, clamp, has,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JF = api;
})(typeof window !== 'undefined' ? window : globalThis);
