/**
 * tests/unit/sound.test.js — unit tests for src/sound.js.
 *
 * Web Audio doesn't exist under Node, so these cover the pure parts:
 * the fireAt-result → sound-name mapping and the mute flag. play()'s
 * no-op path (no AudioContext) is exercised too — it must never throw.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMuted, setMuted, sfxFor, play } from '../../src/sound.js';

test('sfxFor maps fire results to sound names', () => {
  assert.equal(sfxFor('hit'), 'hit');
  assert.equal(sfxFor('miss'), 'miss');
  assert.equal(sfxFor('sunk'), 'sunk');
});

test('sfxFor stays silent on non-state-changing results', () => {
  assert.equal(sfxFor('invalid'), null);
  assert.equal(sfxFor('already-fired'), null);
  assert.equal(sfxFor('bogus'), null);
  assert.equal(sfxFor(undefined), null);
});

test('mute flag toggles', () => {
  setMuted(false);
  assert.equal(isMuted(), false);
  setMuted(true);
  assert.equal(isMuted(), true);
  setMuted(false);
});

test('play() is a safe no-op without Web Audio', () => {
  assert.equal(play('hit'), false); // no AudioContext under Node
  assert.equal(play(null), false);
  assert.equal(play('nope'), false);
  setMuted(true);
  assert.equal(play('hit'), false);
  setMuted(false);
});
