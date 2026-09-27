/**
 * src/rng.js — seedable pseudo-random number generator.
 *
 * All randomness in the game flows through createRng() so that a `?seed=<n>`
 * URL parameter makes AI placement and shots fully repeatable (used by the
 * e2e tests). game.js itself never calls the RNG; ai.js and ui.js do.
 */

/**
 * Creates a mulberry32 PRNG: fast, deterministic, good enough for gameplay.
 * @param {number} seed - any integer; coerced to uint32.
 * @returns {() => number} a function returning floats in [0, 1).
 */
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Parses the `seed` query parameter out of a URL query string.
 * @param {string} search - e.g. location.search ("?seed=42&x=1").
 * @returns {number|null} the numeric seed, or null when absent/invalid.
 */
export function seedFromUrl(search) {
  const params = new URLSearchParams(search);
  const raw = params.get('seed');
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(Math.abs(n)) : null;
}

/**
 * Picks a random integer in [minInclusive, maxExclusive).
 * @param {() => number} rng - a createRng() function.
 * @param {number} minInclusive
 * @param {number} maxExclusive
 * @returns {number}
 */
export function randInt(rng, minInclusive, maxExclusive) {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}
