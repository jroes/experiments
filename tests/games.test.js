'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Library, MAX_GAMES, INDEX_KEY } = require('../sectordominion/games.js');

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); }, _m: m }; };

test('a fresh device has no games, and added games are kept in order, newest open', () => {
  const st = memory(), lib = new Library(st).load();
  assert.deepEqual(lib.list, []);
  assert.equal(lib.active, null);
  const a = lib.add('solo'), b = lib.add('online');
  assert.notEqual(a, b);
  assert.equal(lib.active, b);
  lib.write(a, { turn: 3 }); lib.write(b, { room: 'x' });
  const again = new Library(st).load();
  assert.deepEqual(again.list.map(g => g.kind), ['solo', 'online']);
  assert.equal(again.active, b);
  assert.deepEqual(again.read(a), { turn: 3 });
});

test('removing a game forgets its data, and the open game falls back to the newest left', () => {
  const st = memory(), lib = new Library(st).load();
  const [a, b, c] = ['solo', 'online', 'solo'].map(k => { const id = lib.add(k); lib.write(id, { k }); return id; });
  assert.equal(lib.remove(c), b);
  assert.equal(st.getItem('sectordominion-g-' + c), null);
  assert.equal(lib.remove(a), b, 'removing one that is not open keeps the open one');
  assert.equal(lib.remove(b), null);
  assert.deepEqual(lib.list, []);
  assert.equal(lib.remove('nonexistent'), null);
});

test('the games from the one-game version are kept: the old app opened the game with friends first', () => {
  const st = memory();
  st.setItem('sectordominion-save-v1', JSON.stringify({ version: 2, turn: 5 }));
  st.setItem('sectordominion-online-v1', JSON.stringify({ v: 2, game: {} }));
  const lib = new Library(st).load();
  assert.deepEqual(lib.list.map(g => g.kind), ['solo', 'online']);
  assert.equal(lib.kind(lib.active), 'online');
  assert.deepEqual(lib.read(lib.list[0].id), { version: 2, turn: 5 });
  assert.equal(st.getItem('sectordominion-save-v1'), null);
  assert.equal(st.getItem('sectordominion-online-v1'), null);
  // loading again does not migrate twice
  assert.equal(new Library(st).load().list.length, 2);
  // only a solo game
  const st2 = memory(); st2.setItem('sectordominion-save-v1', '{"version":2}');
  const l2 = new Library(st2).load();
  assert.deepEqual(l2.list.map(g => g.kind), ['solo']);
  assert.equal(l2.active, l2.list[0].id);
});

test('a damaged or hostile index is repaired, not trusted', () => {
  for (const junk of ['', 'null', '[]', '{"list":5}', '{"list":[null,1,"x",{"id":"../../etc","kind":"solo"},{"id":"abcdefgh","kind":"weird"}]}', 'not json']) {
    const st = memory(); st.setItem(INDEX_KEY, junk);
    const lib = new Library(st).load();
    assert.deepEqual(lib.list, [], junk);
    assert.equal(lib.active, null);
  }
  // a game whose data has gone missing is dropped from the list, and a duplicate id is listed once
  const st = memory(), lib = new Library(st).load();
  const a = lib.add('solo'); lib.write(a, { x: 1 });
  const b = lib.add('solo'); lib.write(b, { x: 2 });
  st.removeItem('sectordominion-g-' + b);
  st.setItem(INDEX_KEY, JSON.stringify({ v: 2, active: b, list: [{ id: a, kind: 'solo' }, { id: a, kind: 'solo' }, { id: b, kind: 'solo' }] }));
  const fixed = new Library(st).load();
  assert.deepEqual(fixed.list.map(g => g.id), [a]);
  assert.equal(fixed.active, a);
  // corrupt data for a listed game reads as nothing instead of throwing
  st.setItem('sectordominion-g-' + a, '{oops');
  assert.equal(fixed.read(a), null);
});

test('there is a limit on how many games, and storage that throws never breaks the list', () => {
  const lib = new Library(memory()).load();
  for (let i = 0; i < MAX_GAMES; i++) lib.add('solo');
  assert.equal(lib.full, true);
  assert.throws(() => lib.add('solo'), /Delete one first/);
  assert.throws(() => lib.add('chess'), /Unknown kind/);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const b = new Library(broken).load();
  const id = b.add('solo');
  assert.equal(b.write(id, { a: 1 }), false, 'a failed write is reported, not thrown');
  assert.equal(b.read(id), null);
  assert.doesNotThrow(() => b.remove(id));
});
