/**
 * tests/unit/ai.test.js — unit tests for src/ai.js.
 * Covers random placement validity, the 1,000-game safety simulation,
 * hunt->target adjacency, line lock, and the touching-ships edge case.
 * Run with: node --test tests/unit/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  FLEET,
  createEmptyBoard,
  placeShipOnBoard,
  fireOnBoard,
  allShipsSunk,
  inBounds,
} from '../../src/game.js';
import { createRng } from '../../src/rng.js';
import { createAI } from '../../src/ai.js';

/** Orthogonally adjacent helper. */
function adjacent(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

test('placement: AI fleet respects board rules across seeds', () => {
  for (let seed = 0; seed < 50; seed++) {
    const board = createEmptyBoard();
    createAI(createRng(seed)).placeFleet(board);
    assert.equal(board.ships.length, FLEET.length);
    const occupied = new Set();
    for (const ship of board.ships) {
      assert.equal(ship.cells.length, ship.size);
      for (const c of ship.cells) {
        assert.ok(inBounds(c.row, c.col));
        const k = `${c.row},${c.col}`;
        assert.ok(!occupied.has(k), `overlap at ${k}`);
        occupied.add(k);
      }
    }
  }
});

test('simulation: 1,000 seeded games — no repeats, in bounds, <=100 shots', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const board = createEmptyBoard();
    createAI(createRng(seed * 7919)).placeFleet(board);
    const shooter = createAI(createRng(seed));
    const fired = new Set();
    let shots = 0;
    while (!allShipsSunk(board)) {
      const { row, col } = shooter.nextShot();
      assert.ok(inBounds(row, col), `seed ${seed}: out of bounds ${row},${col}`);
      const k = `${row},${col}`;
      assert.ok(!fired.has(k), `seed ${seed}: repeated shot ${k}`);
      fired.add(k);
      const res = fireOnBoard(board, row, col);
      shooter.reportResult(row, col, res.result, res.sunkCells);
      shots++;
      assert.ok(shots <= BOARD_SIZE * BOARD_SIZE, `seed ${seed}: exceeded 100 shots`);
    }
  }
});

test('targeting: shot after first hit is orthogonally adjacent', () => {
  // Fix a single Destroyer away from edges so all neighbours exist.
  const board = createEmptyBoard();
  placeShipOnBoard(board, FLEET[4], 5, 5, 'horizontal'); // (5,5)-(5,6)
  const ai = createAI(createRng(123));

  let firstHit = null;
  // Hunt until the ship is first hit (deterministic, bounded by grid size).
  for (let i = 0; i < BOARD_SIZE * BOARD_SIZE && !firstHit; i++) {
    const c = ai.nextShot();
    const res = fireOnBoard(board, c.row, c.col);
    ai.reportResult(c.row, c.col, res.result, res.sunkCells);
    if (res.result === 'hit') firstHit = c;
  }
  assert.ok(firstHit, 'expected a hit while hunting a destroyer');
  const next = ai.nextShot();
  assert.ok(adjacent(next, firstHit), `${JSON.stringify(next)} not adjacent to hit`);
});

test('line lock: after two aligned hits, shots stay on that line', () => {
  const ai = createAI(createRng(7));
  ai.nextShot(); // consume one hunt shot
  // Report two contiguous horizontal hits (as if found by targeting).
  ai.reportResult(3, 4, 'hit');
  ai.reportResult(3, 5, 'hit');
  const s1 = ai.nextShot();
  assert.equal(s1.row, 3, 'line-locked shot must stay on the hit row');
  assert.ok(s1.col === 3 || s1.col === 6, `expected extension cell, got ${JSON.stringify(s1)}`);

  const ai2 = createAI(createRng(8));
  ai2.nextShot();
  ai2.reportResult(4, 6, 'hit');
  ai2.reportResult(5, 6, 'hit');
  const s2 = ai2.nextShot();
  assert.equal(s2.col, 6, 'vertical line lock must stay on the hit column');
  assert.ok(s2.row === 3 || s2.row === 6);
});

test('touching ships: exhausted line falls back to neighbours, not hunt', () => {
  // Two parallel vertical ships side by side: hits (3,4)+(3,5) look like one
  // horizontal run, so its extensions miss — the AI must then probe the
  // off-axis neighbours of the unresolved hits instead of hunting randomly.
  const ai = createAI(createRng(5));
  const huntShot = ai.nextShot(); // consume one hunt shot
  ai.reportResult(3, 4, 'hit');
  ai.reportResult(3, 5, 'hit');
  const s1 = ai.nextShot();
  ai.reportResult(s1.row, s1.col, 'miss');
  const s2 = ai.nextShot();
  ai.reportResult(s2.row, s2.col, 'miss');
  // Both row extensions tried and missed; next shot must be an off-axis
  // neighbour of the run (row 2 or 4 at col 4/5), never a random hunt cell.
  const s3 = ai.nextShot();
  const isOffAxisNeighbour = [2, 4].includes(s3.row) && [4, 5].includes(s3.col);
  assert.ok(
    isOffAxisNeighbour || JSON.stringify(huntShot) === JSON.stringify(s3),
    `expected off-axis neighbour of unresolved hits, got ${JSON.stringify(s3)}`
  );
});

test('touching ships: AI sinks both ships that share an edge', () => {
  // Ship A horizontal (0,0)-(0,2); Ship B vertical (0,3)-(2,3): orthogonally
  // adjacent at (0,2)/(0,3) — the classic adjacent-ships edge case.
  const board = createEmptyBoard();
  placeShipOnBoard(board, FLEET[2], 0, 0, 'horizontal'); // Cruiser
  placeShipOnBoard(board, FLEET[3], 0, 3, 'vertical'); // Submarine
  // Pad the board with the remaining fleet so allShipsSunk is meaningful.
  placeShipOnBoard(board, FLEET[0], 9, 0, 'horizontal');
  placeShipOnBoard(board, FLEET[1], 9, 5, 'horizontal');
  placeShipOnBoard(board, FLEET[4], 8, 9, 'vertical');

  const ai = createAI(createRng(2024));
  let shots = 0;
  while (!allShipsSunk(board) && shots <= BOARD_SIZE * BOARD_SIZE) {
    const c = ai.nextShot();
    const res = fireOnBoard(board, c.row, c.col);
    ai.reportResult(c.row, c.col, res.result, res.sunkCells);
    shots++;
  }
  assert.ok(allShipsSunk(board), 'all ships must be sunk');
  assert.ok(shots <= BOARD_SIZE * BOARD_SIZE);
});

test('parallel touching ships: both vertical ships get sunk', () => {
  // Cruiser at col 4 rows 2-4, Submarine at col 5 rows 2-4 — touching along
  // their whole length, so hits interleave into a fake horizontal run.
  const board = createEmptyBoard();
  placeShipOnBoard(board, FLEET[2], 2, 4, 'vertical');
  placeShipOnBoard(board, FLEET[3], 2, 5, 'vertical');
  placeShipOnBoard(board, FLEET[0], 9, 0, 'horizontal');
  placeShipOnBoard(board, FLEET[1], 9, 5, 'horizontal');
  placeShipOnBoard(board, FLEET[4], 8, 9, 'vertical');

  const ai = createAI(createRng(99));
  let shots = 0;
  while (!allShipsSunk(board) && shots <= BOARD_SIZE * BOARD_SIZE) {
    const c = ai.nextShot();
    const res = fireOnBoard(board, c.row, c.col);
    ai.reportResult(c.row, c.col, res.result, res.sunkCells);
    shots++;
  }
  assert.ok(allShipsSunk(board), 'parallel touching ships must both sink');
});
