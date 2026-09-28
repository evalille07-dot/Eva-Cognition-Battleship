/**
 * tests/unit/game.test.js — unit tests for src/game.js (pure logic).
 * Covers placement rejection, firing outcomes, win detection, and stats.
 * Run with: node --test tests/unit/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_SIZE,
  FLEET,
  createGame,
  createEmptyBoard,
  canPlaceShip,
  placeShipOnBoard,
  placePlayerShip,
  undoPlayerShip,
  startBattle,
  fireAt,
  fireOnBoard,
  allShipsSunk,
  accuracyPercent,
} from '../../src/game.js';

/** Places a standard fleet on a board (all horizontal, rows 0-4). */
function placeStandardFleet(board) {
  FLEET.forEach((def, i) => {
    assert.equal(placeShipOnBoard(board, def, i, 0, 'horizontal').ok, true);
  });
}

/** Builds a battle-ready game: player + enemy fleets placed, phase=battle. */
function battleGame() {
  const game = createGame();
  placeStandardFleet(game.playerBoard);
  placeStandardFleet(game.enemyBoard);
  game.placementIndex = FLEET.length;
  assert.equal(startBattle(game).ok, true);
  return game;
}

test('placement: valid placements succeed and mark cells', () => {
  const board = createEmptyBoard();
  const res = placeShipOnBoard(board, FLEET[4], 9, 8, 'horizontal'); // Destroyer
  assert.equal(res.ok, true);
  assert.equal(board.cells[9][8].shipId, 0);
  assert.equal(board.cells[9][9].shipId, 0);
});

test('placement: rejects overlap', () => {
  const board = createEmptyBoard();
  placeShipOnBoard(board, FLEET[0], 0, 0, 'horizontal'); // Carrier row 0
  assert.equal(canPlaceShip(board, 0, 4, 3, 'horizontal'), false);
  assert.equal(placeShipOnBoard(board, FLEET[2], 0, 4, 'horizontal').ok, false);
  // crossing an occupied cell vertically is also an overlap
  assert.equal(canPlaceShip(board, 0, 2, 3, 'vertical'), false);
});

test('placement: rejects out-of-bounds at every edge, both orientations', () => {
  const board = createEmptyBoard();
  const size = 4;
  // off the right edge / bottom edge
  assert.equal(canPlaceShip(board, 0, BOARD_SIZE - size + 1, size, 'horizontal'), false);
  assert.equal(canPlaceShip(board, BOARD_SIZE - size + 1, 0, size, 'vertical'), false);
  // negative origin
  assert.equal(canPlaceShip(board, 0, -1, size, 'horizontal'), false);
  assert.equal(canPlaceShip(board, -1, 0, size, 'vertical'), false);
  // every anchor on the last row/col fails for a ship longer than 1
  for (let i = 0; i < BOARD_SIZE; i++) {
    assert.equal(canPlaceShip(board, BOARD_SIZE - 1, i, 2, 'vertical'), false);
    assert.equal(canPlaceShip(board, i, BOARD_SIZE - 1, 2, 'horizontal'), false);
  }
  // edge-hugging valid anchors still work
  assert.equal(canPlaceShip(board, 0, BOARD_SIZE - size, size, 'horizontal'), true);
  assert.equal(canPlaceShip(board, BOARD_SIZE - size, 0, size, 'vertical'), true);
});

test('placement: player places in fleet order and undo removes last ship', () => {
  const game = createGame();
  assert.equal(placePlayerShip(game, 0, 0, 'horizontal').ok, true); // Carrier
  // wrong-order impossible by construction; invalid spot rejected
  assert.equal(placePlayerShip(game, 0, 0, 'horizontal').ok, false);
  const undo = undoPlayerShip(game);
  assert.equal(undo.ok, true);
  assert.equal(undo.ship.name, 'Carrier');
  assert.equal(game.placementIndex, 0);
  assert.equal(game.playerBoard.cells[0][0].shipId, null);
  assert.equal(undoPlayerShip(game).ok, false);
});

test('placement: startBattle requires all 5 ships', () => {
  const game = createGame();
  placePlayerShip(game, 0, 0, 'horizontal');
  assert.equal(startBattle(game).ok, false);
});

test('firing: miss, hit, sunk, already-fired reported correctly', () => {
  const board = createEmptyBoard();
  placeShipOnBoard(board, FLEET[4], 0, 0, 'horizontal'); // Destroyer at (0,0)-(0,1)
  board.ships.push(...[]); // fleet completeness not needed for fireOnBoard

  assert.equal(fireOnBoard(board, 5, 5).result, 'miss');
  assert.equal(fireOnBoard(board, 0, 0).result, 'hit');
  assert.equal(fireOnBoard(board, 0, 0).result, 'already-fired');
  assert.equal(fireOnBoard(board, 5, 5).result, 'already-fired');
  const sunk = fireOnBoard(board, 0, 1);
  assert.equal(sunk.result, 'sunk');
  assert.equal(sunk.ship.name, 'Destroyer');
  assert.equal(sunk.sunkCells.length, 2);
  assert.equal(fireOnBoard(board, 99, 0).result, 'invalid');
});

test('turns: strict alternation, hit grants no extra turn, out-of-turn rejected', () => {
  const game = battleGame();
  assert.equal(fireAt(game, 'enemy', 9, 9).result, 'invalid'); // enemy can't go first
  assert.equal(fireAt(game, 'player', 0, 0).result, 'hit'); // Carrier row 0
  assert.equal(game.currentTurn, 'enemy'); // hit does not keep the turn
  assert.equal(fireAt(game, 'player', 0, 1).result, 'invalid'); // locked while enemy's turn
  assert.equal(fireAt(game, 'enemy', 9, 9).result, 'miss');
  assert.equal(game.currentTurn, 'player');
});

test('win detection: game ends only when every ship cell is hit', () => {
  const game = battleGame();
  // Enemy burn shots: walk distinct cells in rows 5-9, which hold no player
  // ships under placeStandardFleet, so every shot is a unique miss.
  let burnCell = BOARD_SIZE * 5;
  const enemyBurn = () => {
    const res = fireAt(game, 'enemy', Math.floor(burnCell / BOARD_SIZE), burnCell % BOARD_SIZE);
    assert.equal(res.result, 'miss');
    burnCell++;
  };
  // sink the whole enemy fleet, one ship at a time
  for (let row = 0; row < FLEET.length; row++) {
    for (let col = 0; col < FLEET[row].size; col++) {
      const res = fireAt(game, 'player', row, col);
      const isLast = row === FLEET.length - 1 && col === FLEET[row].size - 1;
      if (isLast) {
        assert.equal(res.winner, 'player');
        assert.equal(game.phase, 'over');
      } else {
        assert.notEqual(game.phase, 'over');
        enemyBurn();
      }
    }
  }
  assert.equal(allShipsSunk(game.enemyBoard), true);
  // firing after the game ends is rejected
  assert.equal(fireAt(game, 'enemy', 8, 8).result, 'invalid');
});

test('stats: shots, hits, accuracy incl. zero-shot case', () => {
  assert.equal(accuracyPercent(0, 0), 0);
  assert.equal(accuracyPercent(3, 1), 33.3);
  assert.equal(accuracyPercent(10, 10), 100);

  const game = battleGame();
  fireAt(game, 'player', 0, 0); // hit
  fireAt(game, 'enemy', 9, 9); // miss
  fireAt(game, 'player', 8, 8); // miss
  assert.deepEqual(game.stats.player, { shots: 2, hits: 1 });
  assert.deepEqual(game.stats.enemy, { shots: 1, hits: 0 });
  assert.equal(accuracyPercent(game.stats.player.shots, game.stats.player.hits), 50);
  assert.equal(game.turnCount, 3);
});
