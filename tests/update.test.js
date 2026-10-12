'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Updater = require('../shared/update.js');

test('an update is only announced for a real, different version', () => {
  assert.equal(Updater.decide('abc123', { version: 'def456' }), 'update');
  assert.equal(Updater.decide('abc123', '{"version":"def456","built":"x"}'), 'update');
  assert.equal(Updater.decide('abc123', { version: 'abc123' }), 'none', 'same version');
  assert.equal(Updater.decide('dev', { version: 'def456' }), 'none', 'a local copy never asks');
  assert.equal(Updater.decide('', { version: 'def456' }), 'none');
  assert.equal(Updater.decide(undefined, { version: 'def456' }), 'none');
  for (const bad of [null, undefined, 5, [], {}, { version: 5 }, { version: '' }, { version: '<script>' }, { version: 'x'.repeat(100) }, 'not json', '{"version":', '[]']) {
    assert.equal(Updater.decide('abc123', bad), 'none', JSON.stringify(bad));
  }
});

test('no checks without a real version, and nothing throws without a page', () => {
  assert.equal(Updater.start({ current: 'dev' }), null);
  assert.equal(Updater.start({ current: undefined }), null);
  assert.equal(Updater.start({ current: 'abc123' }), null, 'no document in node');
});
