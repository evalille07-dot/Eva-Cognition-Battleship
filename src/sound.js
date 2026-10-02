/**
 * src/sound.js — synthesized retro sound effects for Neon Battleship.
 *
 * All audio is generated with the Web Audio API (oscillator + gain
 * envelope per note), so the game stays a pure static site with no audio
 * files to ship. ui.js calls play() at game events and sfxFor() to map a
 * fireAt result to a sound name. This module never touches the DOM and is
 * importable under Node for unit tests: the AudioContext is created
 * lazily inside play(), which no-ops when the API is absent.
 */

/** @type {AudioContext|null} Created on first play — browsers require a user gesture first. */
let ctx = null;

/** Master mute flag; toggled by the SOUND button in ui.js. */
let muted = false;

/** @returns {boolean} whether sounds are currently muted. */
export function isMuted() {
  return muted;
}

/**
 * Enables or disables all playback.
 * @param {boolean} value
 */
export function setMuted(value) {
  muted = value;
}

/**
 * Maps a game.js fireAt() result name to the effect to play.
 * 'invalid' and 'already-fired' deliberately map to null: those clicks
 * change no game state, so they stay silent.
 * @param {string} result - 'hit' | 'miss' | 'sunk' | 'invalid' | 'already-fired'
 * @returns {string|null} an SFX key, or null for silence
 */
export function sfxFor(result) {
  switch (result) {
    case 'hit':
      return 'hit';
    case 'miss':
      return 'miss';
    case 'sunk':
      return 'sunk';
    default:
      return null;
  }
}

/**
 * Note tables: each sound is a short sequence of {f Hz, d seconds,
 * type oscillator, vol gain} played back-to-back — the classic
 * square/sawtooth palette of arcade machines.
 */
const SFX = {
  start: [
    { f: 440, d: 0.07 },
    { f: 880, d: 0.1 },
  ],
  place: [{ f: 660, d: 0.06 }],
  rotate: [{ f: 520, d: 0.05 }],
  undo: [{ f: 220, d: 0.08 }],
  denied: [{ f: 120, d: 0.1, type: 'sawtooth' }],
  hit: [
    { f: 880, d: 0.05, type: 'sawtooth' },
    { f: 660, d: 0.08, type: 'sawtooth' },
  ],
  miss: [{ f: 160, d: 0.12, type: 'sine' }],
  sunk: [
    { f: 523, d: 0.08 },
    { f: 659, d: 0.08 },
    { f: 784, d: 0.15 },
  ],
  victory: [
    { f: 523, d: 0.09 },
    { f: 659, d: 0.09 },
    { f: 784, d: 0.09 },
    { f: 1046, d: 0.22 },
  ],
  defeat: [
    { f: 392, d: 0.12 },
    { f: 330, d: 0.12 },
    { f: 262, d: 0.25 },
  ],
};

/** Resolves the AudioContext constructor for this browser, or null. */
function audioCtor() {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/**
 * Plays a named effect. Safe to call anywhere: it silently no-ops when
 * muted, the name is unknown, or Web Audio is unavailable (e.g. Node).
 * @param {string|null} name - an SFX key; null/undefined = silence
 * @returns {boolean} whether audio was actually scheduled
 */
export function play(name) {
  if (muted || !name || !SFX[name]) return false;
  const Ctor = audioCtor();
  if (!Ctor) return false;
  if (!ctx) ctx = new Ctor();
  // Autoplay policy suspends the context until a gesture; resume() is a
  // no-op once running.
  if (ctx.state === 'suspended') ctx.resume();
  let t = ctx.currentTime;
  for (const n of SFX[name]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = n.type || 'square';
    osc.frequency.value = n.f;
    // Short attack then exponential decay keeps each blip crisp and
    // avoids clicks at the note edges.
    gain.gain.setValueAtTime(n.vol ?? 0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + n.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + n.d);
    t += n.d;
  }
  return true;
}
