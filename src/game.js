/**
 * src/game.js — pure game logic for Neon Battleship.
 *
 * Owns the board model, ship-placement rules, firing resolution
 * (hit / miss / sunk / already-fired), win detection, and per-side stats.
 * No DOM access and no randomness: ui.js renders this state and ai.js reads
 * boards to choose its shots. All coordinates are { row: 0-9, col: 0-9 }.
 */

export const BOARD_SIZE = 10;

/** Fleet order is also the player's required placement order. */
export const FLEET = [
  { name: 'Carrier', size: 5 },
  { name: 'Battleship', size: 4 },
  { name: 'Cruiser', size: 3 },
  { name: 'Submarine', size: 3 },
  { name: 'Destroyer', size: 2 },
];

export const ORIENTATIONS = ['horizontal', 'vertical'];

/** Row labels A–J used for display and accessibility labels. */
export const ROW_LABELS = 'ABCDEFGHIJ';

/**
 * Creates an empty 10×10 board.
 * Each cell is { shipId: number|null, state: 'empty'|'miss'|'hit' }.
 * ships[] entries: { id, name, size, cells: [{row,col}], hits, sunk }.
 * @returns {{size:number, cells:object[][], ships:object[]}}
 */
export function createEmptyBoard() {
  const cells = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => ({ shipId: null, state: 'empty' }))
  );
  return { size: BOARD_SIZE, cells, ships: [] };
}

/**
 * Creates a fresh game in the 'placement' phase.
 * phases: 'placement' -> 'battle' -> 'over'.
 * @returns {object} the game state mutated by the functions below.
 */
export function createGame() {
  return {
    phase: 'placement',
    placementIndex: 0, // index into FLEET of the ship the player places next
    orientation: 'horizontal', // current player placement orientation (UI-owned mirror)
    playerBoard: createEmptyBoard(),
    enemyBoard: createEmptyBoard(),
    currentTurn: 'player', // 'player' fires first per the rules
    winner: null,
    turnCount: 0,
    stats: {
      player: { shots: 0, hits: 0 },
      enemy: { shots: 0, hits: 0 },
    },
  };
}

/**
 * Returns true when (row, col) is inside the grid.
 * @param {number} row @param {number} col @returns {boolean}
 */
export function inBounds(row, col) {
  return row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE;
}

/**
 * Computes the cells a ship of `size` would occupy anchored at (row, col).
 * @param {number} row @param {number} col @param {number} size
 * @param {string} orientation - 'horizontal' | 'vertical'
 * @returns {{row:number,col:number}[]} cells (may be out of bounds).
 */
export function shipCells(row, col, size, orientation) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    cells.push(orientation === 'horizontal' ? { row, col: col + i } : { row: row + i, col });
  }
  return cells;
}

/**
 * Placement rule: in bounds and no overlap. Adjacent ships are allowed.
 * @param {object} board @param {number} row @param {number} col
 * @param {number} size @param {string} orientation
 * @returns {boolean}
 */
export function canPlaceShip(board, row, col, size, orientation) {
  return shipCells(row, col, size, orientation).every(
    (c) => inBounds(c.row, c.col) && board.cells[c.row][c.col].shipId === null
  );
}

/**
 * Places a ship definition on a board. Shared by the player (manual) and the
 * AI (random retry loop in ai.js).
 * @param {object} board
 * @param {{name:string,size:number}} shipDef
 * @param {number} row @param {number} col @param {string} orientation
 * @returns {{ok:boolean, ship?:object, reason?:string}}
 */
export function placeShipOnBoard(board, shipDef, row, col, orientation) {
  if (!ORIENTATIONS.includes(orientation)) return { ok: false, reason: 'bad-orientation' };
  if (!canPlaceShip(board, row, col, shipDef.size, orientation)) {
    return { ok: false, reason: 'invalid-position' };
  }
  const cells = shipCells(row, col, shipDef.size, orientation);
  const ship = { id: board.ships.length, name: shipDef.name, size: shipDef.size, cells, hits: 0, sunk: false };
  board.ships.push(ship);
  for (const c of cells) board.cells[c.row][c.col].shipId = ship.id;
  return { ok: true, ship };
}

/**
 * Places the player's next ship (FLEET order) during 'placement'.
 * @param {object} game @param {number} row @param {number} col @param {string} orientation
 * @returns {{ok:boolean, ship?:object, done?:boolean, reason?:string}} done=true when all 5 placed.
 */
export function placePlayerShip(game, row, col, orientation) {
  if (game.phase !== 'placement') return { ok: false, reason: 'wrong-phase' };
  const shipDef = FLEET[game.placementIndex];
  const res = placeShipOnBoard(game.playerBoard, shipDef, row, col, orientation);
  if (!res.ok) return res;
  game.placementIndex++;
  return { ok: true, ship: res.ship, done: game.placementIndex === FLEET.length };
}

/**
 * Removes the player's most recently placed ship (undo).
 * @param {object} game
 * @returns {{ok:boolean, ship?:object, reason?:string}}
 */
export function undoPlayerShip(game) {
  if (game.phase !== 'placement' || game.placementIndex === 0) {
    return { ok: false, reason: 'nothing-to-undo' };
  }
  const ship = game.playerBoard.ships.pop();
  for (const c of ship.cells) game.playerBoard.cells[c.row][c.col].shipId = null;
  game.placementIndex--;
  return { ok: true, ship };
}

/**
 * Moves the game to 'battle' once the player fleet is fully placed.
 * Callers must have placed the enemy fleet first (ai.js does this).
 * @param {object} game
 * @returns {{ok:boolean, reason?:string}}
 */
export function startBattle(game) {
  if (game.phase !== 'placement' || game.placementIndex !== FLEET.length) {
    return { ok: false, reason: 'not-ready' };
  }
  game.phase = 'battle';
  game.currentTurn = 'player';
  return { ok: true };
}

/** @param {object} board @returns {boolean} true when every ship on the board is sunk. */
export function allShipsSunk(board) {
  return board.ships.length === FLEET.length && board.ships.every((s) => s.sunk);
}

/**
 * Low-level firing against a board. Does not touch turns or stats.
 * @param {object} board @param {number} row @param {number} col
 * @returns {{result:'invalid'|'already-fired'|'miss'|'hit'|'sunk', ship?:object, sunkCells?:object[]}}
 */
export function fireOnBoard(board, row, col) {
  if (!inBounds(row, col)) return { result: 'invalid' };
  const cell = board.cells[row][col];
  if (cell.state !== 'empty') return { result: 'already-fired' };
  if (cell.shipId === null) {
    cell.state = 'miss';
    return { result: 'miss' };
  }
  const ship = board.ships[cell.shipId];
  cell.state = 'hit';
  ship.hits++;
  if (ship.hits === ship.size) {
    ship.sunk = true;
    return { result: 'sunk', ship, sunkCells: ship.cells };
  }
  return { result: 'hit', ship };
}

/**
 * Fires a shot for `attacker` ('player' shoots enemyBoard, 'enemy' shoots
 * playerBoard). Enforces strict alternation: a shot made out of turn is
 * rejected with 'invalid' — this is the hard turn lock behind the UI's
 * "clicks during the AI turn are ignored" rule.
 * A hit does NOT grant an extra turn; turns always alternate.
 * @param {object} game @param {'player'|'enemy'} attacker @param {number} row @param {number} col
 * @returns {{result:string, ship?:object, sunkCells?:object[], winner?:string}}
 */
export function fireAt(game, attacker, row, col) {
  if (game.phase !== 'battle' || game.currentTurn !== attacker) {
    return { result: 'invalid' };
  }
  const board = attacker === 'player' ? game.enemyBoard : game.playerBoard;
  const res = fireOnBoard(board, row, col);
  if (res.result === 'invalid' || res.result === 'already-fired') return res;

  const side = game.stats[attacker];
  side.shots++;
  if (res.result === 'hit' || res.result === 'sunk') side.hits++;
  game.turnCount++;

  if (allShipsSunk(board)) {
    game.phase = 'over';
    game.winner = attacker;
    return { ...res, winner: attacker };
  }
  game.currentTurn = attacker === 'player' ? 'enemy' : 'player';
  return res;
}

/**
 * Accuracy as a percentage rounded to 1 decimal; 0 when no shots were fired.
 * @param {number} shots @param {number} hits @returns {number}
 */
export function accuracyPercent(shots, hits) {
  if (shots === 0) return 0;
  return Math.round((hits / shots) * 1000) / 10;
}
