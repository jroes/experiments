/*
 * Draws a room's background for an HD-2D game off the main thread, so walking never waits for it (see HD2D.backdrop in hd2d-gl.js).
 * It loads the engine, hd2d.js and the game's own file, keeps its own copy of the game, and on each request draws the background
 * for the state it was sent, then hands the pixels back. Buffers go back and forth instead of being copied or thrown away.
 */
'use strict';
let def = null, game = null, scene = null;
const spare = [];
self.onmessage = e => {
  const m = e.data;
  if (m.type === 'init') {
    importScripts.apply(null, m.scripts);
    def = self[m.name];
    game = self.Adventure.create(def);
    scene = new self.HD2D.Scene(self.HD2D.LOOKS.hd2d);
    return;
  }
  if (m.type === 'recycle') { spare.push(m.snap); return; }
  if (m.type === 'draw' && def) {
    const state = self.Adventure.cleanState(def, m.state);
    if (!state) return self.postMessage({ type: 'skip', key: m.key });
    game.state = state; game.step = m.step;
    self.HD2D.background(def, game, m.t, scene);
    const snap = scene.snapshot(spare.pop());
    self.postMessage({ type: 'back', key: m.key, t: m.t, snap }, [snap.col.buffer, snap.emit.buffer, snap.depth.buffer, snap.stamp.buffer]);
  }
};
