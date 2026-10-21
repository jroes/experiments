'use strict';
// Jetfall's looks that can be checked without a browser: the plants and rocks made in code (vegetation.js), where they
// stand, and the baked textures the maps ask for. The pictures themselves are checked by eye (see CLAUDE.md).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const JF = require('../jetfall/sim.js');
const V = require('../jetfall/vegetation.js');

function checkShape(name, g, withCards) {
  const nv = g.P.length / 3;
  assert.ok(nv > 0 && Number.isInteger(nv), name + ' has vertices');
  assert.equal(g.N.length, g.P.length, name + ' normals');
  assert.ok(g.P.every(Number.isFinite) && g.N.every(Number.isFinite), name + ' numbers are finite');
  assert.equal(g.I.length % 3, 0, name + ' whole triangles');
  assert.ok(g.I.every(i => Number.isInteger(i) && i >= 0 && i < nv), name + ' indices in range');
  assert.ok(nv < 65536, name + ' fits 16-bit indices');
  if (withCards) {
    assert.equal(g.T.length, nv * 4, name + ' card coordinates');
    for (let i = 0; i < nv; i++) {
      const [u, v, layer, ao] = g.T.slice(i * 4, i * 4 + 4);
      assert.ok(u >= 0 && u <= 1 && v >= 0 && v <= 1, name + ' uv in 0..1');
      assert.ok(layer === 0 || layer === 1, name + ' card layer');
      assert.ok(ao > 0 && ao <= 1, name + ' occlusion');
    }
  }
}

test('every shape made in code is a valid mesh', () => {
  for (let s = 0; s < 4; s++) checkShape('rock ' + s, V.rock(11 + s * 7), false);
  for (const lod of [0, 1]) {
    const f = V.conifer(3, lod), o = V.broadleaf(5, lod);
    checkShape('fir bark ' + lod, f.bark, false); checkShape('fir needles ' + lod, f.fol, true);
    checkShape('oak bark ' + lod, o.bark, false); checkShape('oak leaves ' + lod, o.fol, true);
  }
  checkShape('dead tree', V.deadTree(7).bark, false);
  checkShape('bush', V.bush(9).fol, true);
  // the far version is much lighter than the near one
  assert.ok(V.conifer(3, 1).fol.I.length * 4 < V.conifer(3, 0).fol.I.length);
});

test('plants never stand where people play, and come out the same every time', () => {
  for (const key of Object.keys(JF.MAPS)) {
    const w = new JF.World({ map: key });
    const t = w.terrain;
    // outside the map, stand on a flat skirt at the edge height (the renderer uses its ring of hills)
    const h = (x, z) => t.height(Math.min(JF.SIZE, Math.max(0, x)), Math.min(JF.SIZE, Math.max(0, z)));
    const a = V.plant(w, h), b = V.plant(w, h);
    assert.deepEqual(a, b, key + ': deterministic');
    const veg = w.def.look.veg || {};
    if (veg.trees > 0) assert.ok(a.trees.length > 50, key + ': has trees (' + a.trees.length + ')');
    assert.ok(a.trees.length + a.bushes.length < 40000, key + ': not too many');
    for (const tr of a.trees) {
      const inside = tr.x > JF.AREA_MIN - 10 && tr.x < JF.AREA_MAX + 10 && tr.z > JF.AREA_MIN - 10 && tr.z < JF.AREA_MAX + 10;
      assert.ok(!inside, key + ': a tree in the mission area at ' + tr.x.toFixed(0) + ',' + tr.z.toFixed(0));
      assert.ok([tr.x, tr.y, tr.z, tr.s, tr.yaw].every(Number.isFinite), key + ': finite');
      assert.ok(['fir', 'oak', 'dead'].includes(tr.kind), key + ': kind ' + tr.kind);
      if (t.waterH != null && tr.x >= 0 && tr.x <= JF.SIZE && tr.z >= 0 && tr.z <= JF.SIZE) assert.ok(tr.y + 0.3 >= t.waterH + 1.5, key + ': a tree in the water');
      if (t.lavaH != null && tr.x >= 0 && tr.x <= JF.SIZE && tr.z >= 0 && tr.z <= JF.SIZE) assert.ok(tr.y + 0.3 >= t.lavaH + 3, key + ': a tree in the lava');
    }
    for (const bu of a.bushes) {
      for (const base of w.bases) assert.ok(Math.hypot(base.o.x - bu.x, base.o.z - bu.z) >= 70, key + ': a bush in a base');
      assert.ok(bu.s < 2.5, key + ': bushes stay low');
    }
  }
});

test('every texture a map or the renderer asks for was baked', () => {
  const dir = path.join(__dirname, '..', 'jetfall', 'tex');
  const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const names = man.materials.map(m => m.name);
  assert.ok(man.materials.length <= 16, 'the shaders hold 16 materials');
  for (const m of man.materials) {
    for (const k of ['_a', '_n', '_h']) assert.ok(fs.existsSync(path.join(dir, m.name + k + '.jpg')), m.name + k);
    assert.ok(m.scale > 0 && m.mean.every(v => v > 0.02 && v < 1), m.name + ' scale and mean');
  }
  for (const c of man.cards) assert.ok(fs.existsSync(path.join(dir, c + '.png')), c);
  // render.js: mesh materials and default layers
  const src = fs.readFileSync(path.join(__dirname, '..', 'jetfall', 'render.js'), 'utf8');
  for (const list of [/const MESH_MATS = \[([^\]]*)\]/, /const DEFAULT_LAYERS = \[([^\]]*)\]/]) {
    for (const n of src.match(list)[1].split(',').map(s => s.trim().replace(/'/g, ''))) assert.ok(names.includes(n), 'render.js wants ' + n);
  }
  for (const [key, def] of Object.entries(JF.MAPS)) {
    const mats = def.look.mats;
    assert.ok(Array.isArray(mats) && mats.length === 4, key + ' has four ground materials');
    for (const n of mats) assert.ok(names.includes(n), key + ' wants ' + n);
  }
});
