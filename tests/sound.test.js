'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Sound = require('../shared/sound.js');

test('settings from storage are always usable', () => {
  assert.deepEqual(Sound.cleanSettings(null), Sound.DEFAULTS);
  assert.deepEqual(Sound.cleanSettings(undefined), Sound.DEFAULTS);
  assert.deepEqual(Sound.cleanSettings('not json'), Sound.DEFAULTS);
  assert.deepEqual(Sound.cleanSettings([]), Sound.DEFAULTS);
  assert.deepEqual(Sound.cleanSettings(7), Sound.DEFAULTS);
  assert.deepEqual(Sound.cleanSettings('{"sfx":false,"music":true,"volume":0.25}'), { sfx: false, music: true, volume: 0.25 });
  assert.equal(Sound.cleanSettings({ volume: 9 }).volume, 1, 'volume is clamped');
  assert.equal(Sound.cleanSettings({ volume: -3 }).volume, 0);
  assert.equal(Sound.cleanSettings({ volume: NaN }).volume, Sound.DEFAULTS.volume);
  assert.equal(Sound.cleanSettings({ volume: '0.9' }).volume, Sound.DEFAULTS.volume, 'text is not a number');
  assert.equal(Sound.cleanSettings({ sfx: 'yes' }).sfx, true, 'effects stay on unless switched off on purpose');
  assert.equal(Sound.cleanSettings({ music: 1 }).music, false, 'music is only ever on if it was switched on on purpose');
  assert.equal(Sound.cleanSettings({ music: 'true' }).music, false);
});

test('music is off by default and effects are on', () => {
  assert.equal(Sound.DEFAULTS.music, false);
  assert.equal(Sound.DEFAULTS.sfx, true);
});

test('with no audio support, nothing throws and nothing plays', () => {
  const s = Object.create(Sound);
  s.settings = { ...Sound.DEFAULTS }; s.ctx = null; s.eng = null; s.last = {};
  assert.equal(s.play('turn'), false);
  assert.equal(s.ensure(), null, 'no AudioContext in node');
  assert.doesNotThrow(() => s.unlock());
  assert.doesNotThrow(() => s.applyMusic());
});

test('a sound that is switched off does not play, and a burst of one sound plays once', () => {
  let played = 0;
  const s = Object.create(Sound);
  s.ctx = { state: 'running' }; s.eng = { play() { played++; return true; } }; s.last = {};
  s.settings = { sfx: false, music: false, volume: 0.5 };
  assert.equal(s.play('turn'), false); assert.equal(played, 0);
  s.settings.sfx = true;
  assert.equal(s.play('turn'), true);
  assert.equal(s.play('turn'), false, 'the same sound twice in a few milliseconds is one sound');
  assert.equal(s.play('join'), true, 'a different sound still plays');
  assert.equal(played, 2);
  s.ctx.state = 'suspended';
  s.last = {};
  assert.equal(s.play('turn'), false, 'nothing plays until the browser has allowed sound');
});
