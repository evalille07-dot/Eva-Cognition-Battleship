/**
 * src/ai.js — enemy fleet placement and medium-difficulty "hunt and target"
 * shot selection for Neon Battleship.
 *
 * Hunt mode: fire at a random untried cell.
 * Target mode: after a hit, queue untried orthogonal neighbours.
 * Line lock: once two hits line up on a row or column, extend only along
 * that line in both directions until the ship sinks.
 * After a sink the sunk ship's cells are removed from the pending-hit list;
 * if other unresolved hits remain (the adjacent-ships edge case, where two
 * ships touch), targeting continues on those instead of reverting to hunt.
 *
 * Hard rule: the AI never fires the same cell twice and never fires off the
 * grid — every candidate is filtered through `tried` and `inBounds`.
 *
 * No DOM access; randomness comes from the injected rng (src/rng.js) so a
 * seeded game is fully deterministic.
 */

import {
  BOARD_SIZE,
  FLEET,
  inBounds,
  canPlaceShip,
  placeShipOnBoard,
} from './game.js';
import { randInt } from './rng.js';

/** Cell key used in the `tried` set: row-major index, 0-99. */
function key(row, col) {
  return row * BOARD_SIZE + col;
}

/**
 * Rebuilds the target queue from the unresolved-hit list.
 *
 * Hits are grouped into "line segments": maximal runs of hits that share a
 * row (or column) and are contiguous. A run of length >= 2 is a confirmed
 * line lock, so only the cells extending the run's two ends are queued —
 * never cells off the line. Hits that form no run (including hits belonging
 * to a different, touching ship) contribute their four orthogonal
 * neighbours. Line candidates come first so a locked line is always
 * finished before isolated hits are probed.
 *
 * @param {{row:number,col:number}[]} pendingHits - hits on ships not yet sunk.
 * @param {Set<number>} tried - keys of cells already fired at.
 * @returns {{row:number,col:number}[]} ordered candidate cells.
 */
function computeTargets(pendingHits, tried) {
  const lineCandidates = [];
  const neighbourCandidates = [];
  const seen = new Set();
  const push = (list, row, col) => {
    const k = key(row, col);
    // inBounds + tried filtering here is what guarantees the hard rule:
    // nothing off-grid or already fired can ever enter the queue.
    if (!inBounds(row, col) || tried.has(k) || seen.has(k)) return;
    seen.add(k);
    list.push({ row, col });
  };

  const visited = new Set();
  const hitsByRow = new Map();
  const hitsByCol = new Map();
  for (const h of pendingHits) {
    (hitsByRow.get(h.row) ?? hitsByRow.set(h.row, []).get(h.row)).push(h);
    (hitsByCol.get(h.col) ?? hitsByCol.set(h.col, []).get(h.col)).push(h);
  }

  /**
   * Returns the maximal contiguous run of hits containing h along `axis`
   * ('row' scans columns sharing h.row; 'col' scans rows sharing h.col).
   * Contiguity matters: two hits on the same row separated by a miss
   * belong to different ships and must not be treated as one line.
   */
  function contiguousRun(h, axis) {
    const fixed = axis === 'row' ? h.row : h.col;
    const group = (axis === 'row' ? hitsByRow : hitsByCol).get(fixed) ?? [h];
    const coords = new Set(group.map((c) => (axis === 'row' ? c.col : c.row)));
    const start = axis === 'row' ? h.col : h.row;
    const run = [start];
    for (let v = start - 1; coords.has(v); v--) run.unshift(v);
    for (let v = start + 1; coords.has(v); v++) run.push(v);
    return run;
  }

  for (const h of pendingHits) {
    const hk = key(h.row, h.col);
    if (visited.has(hk)) continue;
    const rowRun = contiguousRun(h, 'row');
    const colRun = contiguousRun(h, 'col');
    if (rowRun.length >= 2) {
      // Line lock on this row: fire only at the two extension cells.
      for (const c of rowRun) visited.add(key(h.row, c));
      push(lineCandidates, h.row, rowRun[0] - 1);
      push(lineCandidates, h.row, rowRun[rowRun.length - 1] + 1);
    } else if (colRun.length >= 2) {
      for (const r of colRun) visited.add(key(r, h.col));
      push(lineCandidates, colRun[0] - 1, h.col);
      push(lineCandidates, colRun[colRun.length - 1] + 1, h.col);
    } else {
      // Isolated hit: probe all four orthogonal neighbours.
      visited.add(hk);
      push(neighbourCandidates, h.row - 1, h.col);
      push(neighbourCandidates, h.row + 1, h.col);
      push(neighbourCandidates, h.row, h.col - 1);
      push(neighbourCandidates, h.row, h.col + 1);
    }
  }
  return [...lineCandidates, ...neighbourCandidates];
}

/**
 * Creates an AI player bound to a given rng stream.
 * @param {() => number} rng - createRng() function; consumed identically for
 *   placement and shots so a seed reproduces the whole game.
 * @returns {{placeFleet:Function, nextShot:Function, reportResult:Function}}
 */
export function createAI(rng) {
  const tried = new Set();
  let pendingHits = [];
  let queue = [];

  /**
   * Places the full fleet randomly, retrying random anchor cells until each
   * ship fits. The loop always terminates because occupancy is low.
   * @param {object} board - board to fill (mutated).
   */
  function placeFleet(board) {
    for (const shipDef of FLEET) {
      let placed = false;
      while (!placed) {
        const orientation = rng() < 0.5 ? 'horizontal' : 'vertical';
        const row = randInt(rng, 0, BOARD_SIZE);
        const col = randInt(rng, 0, BOARD_SIZE);
        placed = placeShipOnBoard(board, shipDef, row, col, orientation).ok;
      }
    }
  }

  /**
   * Chooses the next cell to fire at. Drains the target queue first
   * (skipping anything already tried since queue entries can go stale),
   * then falls back to hunt mode: a uniform pick among untried cells.
   * The chosen cell is marked tried immediately so a repeat is impossible
   * even if reportResult is never called.
   * @returns {{row:number,col:number}}
   */
  function nextShot() {
    while (queue.length > 0) {
      const c = queue.shift();
      if (!tried.has(key(c.row, c.col))) {
        tried.add(key(c.row, c.col));
        return c;
      }
    }
    const open = [];
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        if (!tried.has(key(row, col))) open.push({ row, col });
      }
    }
    const c = open[randInt(rng, 0, open.length)];
    tried.add(key(c.row, c.col));
    return c;
  }

  /**
   * Feeds back the outcome of the last shot so targeting state stays in
   * sync. `sunkCells` (the sunk ship's cells, from fireOnBoard) lets the AI
   * drop exactly that ship's hits while keeping hits that belong to a
   * touching ship — the adjacent-ships edge case.
   * Also marks the cell tried so test harnesses can report results for
   * cells not obtained via nextShot().
   * @param {number} row @param {number} col
   * @param {'miss'|'hit'|'sunk'} result
   * @param {{row:number,col:number}[]} [sunkCells]
   */
  function reportResult(row, col, result, sunkCells) {
    tried.add(key(row, col));
    if (result === 'hit') {
      pendingHits.push({ row, col });
    } else if (result === 'sunk') {
      const sunk = new Set((sunkCells ?? []).map((c) => key(c.row, c.col)));
      pendingHits = pendingHits.filter((h) => !sunk.has(key(h.row, h.col)));
    } else {
      return; // miss: queue was already drained by nextShot
    }
    queue = computeTargets(pendingHits, tried);
  }

  return { placeFleet, nextShot, reportResult };
}
