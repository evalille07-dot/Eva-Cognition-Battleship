/**
 * src/audio.js — retro arcade sound effects for Neon Battleship.
 *
 * Synthesizes every sound with Web Audio oscillators — no audio files.
 * The AudioContext is created lazily by initAudio(), which must be called
 * from a user gesture (the START button click) so browsers allow it to
 * run. Before init, or while muted, every function is a safe no-op.
 *
 * The mute preference persists in localStorage under MUTE_KEY.
 */

const MUTE_KEY = 'neon-battleship-muted';

let ctx = null;
let master = null;
let muted = false;

try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  // Storage blocked (private mode etc.) — default to sound on.
  muted = false;
}

/**
 * Creates/resumes the AudioContext. Call from a user gesture.
 * Safe to call repeatedly; a no-op once running.
 */
export function initAudio() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 1;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
    master = null;
  }
}

/** @param {boolean} value */
export function setMuted(value) {
  muted = Boolean(value);
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage blocked — mute still works for this session */
  }
}

export function isMuted() {
  return muted;
}

/**
 * Schedules one oscillator blip into `dest`. Every sound is built from
 * these.
 * @param {AudioNode} dest - per-play gain bus
 * @param {object} o
 * @param {number} o.freq - start frequency (Hz)
 * @param {number} [o.end] - glide target frequency (Hz); omitted = steady
 * @param {number} [o.at=0] - start offset in seconds from now
 * @param {number} [o.dur=0.1] - duration in seconds
 * @param {OscillatorType} [o.type='square']
 * @param {number} [o.gain=0.15] - peak gain (kept low: 0.1–0.2 range)
 */
function blip(dest, { freq, end, at = 0, dur = 0.1, type = 'square', gain = 0.15 }) {
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (end !== undefined) osc.frequency.exponentialRampToValueAtTime(end, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008); // tiny attack to avoid clicks
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  // Short blip on ship placement.
  place: (d) => blip(d, { freq: 660, end: 880, dur: 0.08, gain: 0.12 }),
  // Low error buzz on illegal placement.
  invalid: (d) => blip(d, { freq: 140, dur: 0.2, type: 'sawtooth', gain: 0.12 }),
  // Zap on a hit.
  hit: (d) => blip(d, { freq: 900, end: 220, dur: 0.18, type: 'sawtooth', gain: 0.16 }),
  // Soft descending tone on a miss.
  miss: (d) => blip(d, { freq: 420, end: 240, dur: 0.22, type: 'sine', gain: 0.1 }),
  // Bigger descending arpeggio when a ship sinks (either side).
  sunk: (d) => {
    for (const [i, f] of [660, 520, 390, 260].entries()) {
      blip(d, { freq: f, at: i * 0.09, dur: 0.12, type: 'square', gain: 0.14 });
    }
  },
  // Rising fanfare on victory.
  victory: (d) => {
    for (const [i, f] of [392, 494, 587, 784, 1047].entries()) {
      blip(d, { freq: f, at: i * 0.12, dur: 0.22, type: 'square', gain: 0.13 });
    }
  },
  // Falling sting on defeat.
  defeat: (d) => {
    for (const [i, f] of [523, 392, 311, 196].entries()) {
      blip(d, { freq: f, at: i * 0.16, dur: 0.3, type: 'triangle', gain: 0.14 });
    }
  },
};

/**
 * Plays a named sound. `volume` < 1 plays it quieter (e.g. the AI's reply
 * shots). No-op when muted, before initAudio(), or for unknown names.
 * @param {keyof typeof SOUNDS} name
 * @param {number} [volume=1] - multiplier on the sound's base gain
 */
export function play(name, volume = 1) {
  if (muted || !ctx || !master || ctx.state !== 'running') return;
  const fn = SOUNDS[name];
  if (!fn) return;
  const bus = ctx.createGain();
  bus.gain.value = Math.max(0, Math.min(1, volume));
  bus.connect(master);
  fn(bus);
  setTimeout(() => bus.disconnect(), 2000);
}
