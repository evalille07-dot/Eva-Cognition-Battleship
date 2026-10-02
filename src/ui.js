/**
 * src/ui.js — DOM rendering and event handling for Neon Battleship.
 *
 * This is the only module that touches the DOM. It renders the two boards,
 * runs the placement phase (hover preview / rotate / undo / two-tap on
 * touch), orchestrates the battle turns (600ms AI delay + click locking),
 * keeps the always-visible status line current, and shows the end overlay
 * with stats and PLAY AGAIN. Every rule decision is delegated to game.js;
 * every AI decision to ai.js; every random value comes from src/rng.js so a
 * `?seed=<n>` URL parameter reproduces a game exactly.
 */

import {
  BOARD_SIZE,
  FLEET,
  ROW_LABELS,
  createGame,
  placePlayerShip,
  undoPlayerShip,
  startBattle,
  fireAt,
  canPlaceShip,
  shipCells,
  inBounds,
  accuracyPercent,
} from './game.js';
import { createAI } from './ai.js';
import { createRng, seedFromUrl } from './rng.js';
import { play, sfxFor, isMuted, setMuted } from './sound.js';

/** Pause before the AI fires so its turn is easy to follow. */
const AI_TURN_DELAY_MS = 600;

const $ = (id) => document.getElementById(id);
const els = {
  status: $('status-line'),
  startScreen: $('start-screen'),
  gameScreen: $('game-screen'),
  startBtn: $('start-btn'),
  rotateBtn: $('rotate-btn'),
  undoBtn: $('undo-btn'),
  playerBoard: $('player-board'),
  enemyBoard: $('enemy-board'),
  playerFleet: $('player-fleet'),
  enemyFleet: $('enemy-fleet'),
  endOverlay: $('end-overlay'),
  endTitle: $('end-title'),
  endStats: $('end-stats'),
  playAgainBtn: $('play-again-btn'),
  soundBtn: $('sound-btn'),
};

// ---- mutable session state (fully rebuilt on PLAY AGAIN) ----
let game; // current game.js state
let ai; // current createAI() instance
let rng; // rng stream owned by the AI
let seed; // seed from ?seed= or generated once per page load
let orientation; // 'horizontal' | 'vertical' placement toggle
let aiThinking; // true between the player's shot and the AI's reply:
let aiTimer; // pending enemyTurn timeout id — cleared on reset so a stale
// AI reply from an abandoned game can't fire into a fresh one
// this flag is the UI half of the turn lock — enemy-board clicks landing
// while it is set are dropped before they can reach game.js.
let armedTapKey; // last touch-tapped cell ("r,c"); a second tap confirms
let previewKeys = new Set(); // cells currently showing a placement preview
let previewAnchor; // {row,col} the preview is anchored at — needed so a
// mid-hover ROTATE can repaint the preview for the new orientation

/** 10×10 button matrix per board, filled by buildBoard(). */
const cellEls = { player: [], enemy: [] };

const cellKey = (row, col) => `${row},${col}`;

/** Human coordinate for labels, e.g. (1, 6) -> "B7". */
function coordName(row, col) {
  return `${ROW_LABELS[row]}${col + 1}`;
}

/** @param {string} text - message shown on the status line. */
function setStatus(text) {
  els.status.textContent = text;
}

/* ================= BOARD CONSTRUCTION ================= */

/**
 * Builds a board's DOM once: an 11×11 grid whose first row/column are the
 * 1–10 / A–J coordinate labels, then 100 <button> cells. Every cell button
 * gets a descriptive aria-label ("Enemy grid B7, not fired") updated by the
 * render functions.
 * @param {HTMLElement} root - the .board container.
 * @param {'player'|'enemy'} side
 */
function buildBoard(root, side) {
  root.appendChild(document.createElement('div')).className = 'coord';
  for (let col = 0; col < BOARD_SIZE; col++) {
    const el = root.appendChild(document.createElement('div'));
    el.className = 'coord';
    el.textContent = String(col + 1);
  }
  for (let row = 0; row < BOARD_SIZE; row++) {
    const rowLabel = root.appendChild(document.createElement('div'));
    rowLabel.className = 'coord';
    rowLabel.textContent = ROW_LABELS[row];
    cellEls[side][row] = [];
    for (let col = 0; col < BOARD_SIZE; col++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cell';
      btn.dataset.row = String(row);
      btn.dataset.col = String(col);
      // pointerdown records the pointer type so click can distinguish a
      // mouse click (place immediately) from a touch tap (first tap shows
      // the preview, second tap on the same cell confirms).
      btn.addEventListener('pointerdown', (e) => {
        pointerWasTouch = e.pointerType === 'touch';
      });
      if (side === 'player') {
        btn.addEventListener('pointerenter', () => showPreview(row, col));
        btn.addEventListener('click', (e) => handlePlacementClick(row, col, e));
      } else {
        btn.addEventListener('click', () => handleFire(row, col));
      }
      cellEls[side][row][col] = btn;
      root.appendChild(btn);
    }
  }
}

/** Tracks the most recent pointer type; used by the two-tap placement rule. */
let pointerWasTouch = false;

/* ================= RENDERING ================= */

/**
 * Repaints the player's board: ship hulls, hits, misses, sunk cells.
 * @param {boolean} reveal - unused for the player board (always revealed).
 */
function renderPlayerBoard() {
  const board = game.playerBoard;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board.cells[row][col];
      const btn = cellEls.player[row][col];
      const hasShip = cell.shipId !== null;
      const ship = hasShip ? board.ships[cell.shipId] : null;
      btn.className =
        'cell' +
        (cell.state === 'hit' ? (ship && ship.sunk ? ' cell-sunk' : ' cell-hit') : '') +
        (cell.state === 'miss' ? ' cell-miss' : '') +
        (hasShip && cell.state === 'empty' ? ' cell-ship' : '');
      const what = hasShip ? ship.name : 'empty';
      const state = cell.state === 'empty' ? '' : `, ${cell.state}`;
      btn.setAttribute('aria-label', `Your grid ${coordName(row, col)}, ${what}${state}`);
      btn.setAttribute('aria-disabled', String(game.phase !== 'placement'));
    }
  }
}

/**
 * Repaints the enemy board. Enemy ships are only shown when sunk or when
 * `reveal` is set (end-of-game reveal of surviving ships) — their positions
 * are never exposed mid-game.
 * @param {boolean} [reveal=false]
 */
function renderEnemyBoard(reveal = false) {
  const board = game.enemyBoard;
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      const cell = board.cells[row][col];
      const btn = cellEls.enemy[row][col];
      const ship = cell.shipId !== null ? board.ships[cell.shipId] : null;
      let cls = 'cell';
      let label;
      if (cell.state === 'miss') {
        cls += ' cell-miss';
        label = 'miss';
      } else if (cell.state === 'hit') {
        cls += ship && ship.sunk ? ' cell-sunk' : ' cell-hit';
        label = ship && ship.sunk ? `${ship.name} sunk` : 'hit';
      } else if (reveal && ship) {
        cls += ' cell-revealed';
        label = `${ship.name}, not hit`;
      } else {
        label = 'not fired';
      }
      btn.className = cls;
      btn.setAttribute('aria-label', `Enemy grid ${coordName(row, col)}, ${label}`);
    }
  }
}

/**
 * Repaints one fleet roster: ship names, green while afloat, struck-through
 * red when sunk. Only names are listed — never positions.
 * @param {HTMLElement} list @param {object} board
 */
function renderFleetStatus(list, board) {
  list.textContent = '';
  for (const ship of board.ships) {
    const li = document.createElement('li');
    li.textContent = ship.name;
    li.className = ship.sunk ? 'sunk' : 'afloat';
    list.appendChild(li);
  }
}

/** Clears any placement preview classes left on the player's board. */
function clearPreview() {
  for (const k of previewKeys) {
    const [r, c] = k.split(',').map(Number);
    const btn = cellEls.player[r]?.[c];
    if (btn) btn.classList.remove('cell-preview-ok', 'cell-preview-bad');
  }
  previewKeys = new Set();
}

/**
 * Shows the placement preview anchored at (row, col): in-bounds candidate
 * cells glow green when the ship fits, red when it would overlap or leave
 * the grid. A no-op outside the placement phase.
 * @param {number} row @param {number} col
 */
function showPreview(row, col) {
  clearPreview();
  if (!game || game.phase !== 'placement') {
    previewAnchor = null;
    return;
  }
  previewAnchor = { row, col };
  const def = FLEET[game.placementIndex];
  const cells = shipCells(row, col, def.size, orientation);
  const valid = canPlaceShip(game.playerBoard, row, col, def.size, orientation);
  for (const c of cells) {
    if (!inBounds(c.row, c.col)) continue;
    const btn = cellEls.player[c.row][c.col];
    btn.classList.add(valid ? 'cell-preview-ok' : 'cell-preview-bad');
    previewKeys.add(cellKey(c.row, c.col));
  }
}

/* ================= GAME FLOW ================= */

/** Wires a new seeded game state; called on load and on PLAY AGAIN. */
function resetGame() {
  rng = createRng(seed);
  ai = createAI(rng);
  game = createGame();
  orientation = 'horizontal';
  aiThinking = false;
  clearTimeout(aiTimer);
  aiTimer = undefined;
  armedTapKey = null;
  previewAnchor = null;
  previewKeys = new Set();
  clearPreview();
  els.rotateBtn.textContent = 'ROTATE: H';
  renderPlayerBoard();
  renderEnemyBoard();
  renderFleetStatus(els.playerFleet, game.playerBoard);
  renderFleetStatus(els.enemyFleet, game.enemyBoard);
  els.rotateBtn.removeAttribute('aria-disabled');
  els.undoBtn.removeAttribute('aria-disabled');
  els.endOverlay.hidden = true;
  els.gameScreen.hidden = true;
  els.startScreen.hidden = false;
  setStatus('READY');
}

/**
 * START button: leaves the start screen and begins placement.
 * Pushes a 'game' history entry so the browser Back button can return to
 * the main menu — the game is a single static page, so without this entry
 * Back is a no-op. `push` is false when we arrive via history navigation
 * itself (Forward): the entry already exists, so its state is re-stamped
 * to keep the invariant that the current entry mirrors the visible screen.
 * @param {{push?:boolean}} [opts]
 */
function handleStart({ push = true } = {}) {
  if (push) history.pushState({ screen: 'game' }, '');
  else history.replaceState({ screen: 'game' }, '');
  play('start');
  els.startScreen.hidden = true;
  els.gameScreen.hidden = false;
  const def = FLEET[0];
  setStatus(`Place your ${def.name} (${def.size})`);
}

/** ROTATE button / R key: toggles ship orientation and repaints the
 * preview at its current anchor so it never shows the old orientation. */
function handleRotate() {
  play('rotate');
  orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  els.rotateBtn.textContent = `ROTATE: ${orientation === 'horizontal' ? 'H' : 'V'}`;
  if (previewAnchor) showPreview(previewAnchor.row, previewAnchor.col);
}

/** UNDO button: removes the most recently placed ship. */
function handleUndo() {
  const res = undoPlayerShip(game);
  if (!res.ok) return;
  play('undo');
  clearPreview();
  armedTapKey = null;
  // Drop the preview anchor too — otherwise a later ROTATE repaints a
  // preview at a cell the player abandoned by undoing.
  previewAnchor = null;
  renderPlayerBoard();
  const def = FLEET[game.placementIndex];
  setStatus(`Place your ${def.name} (${def.size})`);
}

/**
 * Player-board click during placement. Touch taps arm a preview first and
 * confirm on the second tap of the same cell; mouse clicks place directly
 * (the hover preview is already visible).
 * @param {number} row @param {number} col
 * @param {MouseEvent} e - the click; `e.detail === 0` marks a
 *   keyboard-generated activation (Tab+Enter), which must place immediately
 *   regardless of the last pointer type.
 */
function handlePlacementClick(row, col, e) {
  if (!game || game.phase !== 'placement') return;
  const k = cellKey(row, col);
  if (e.detail !== 0 && pointerWasTouch && armedTapKey !== k) {
    armedTapKey = k;
    showPreview(row, col);
    return;
  }
  armedTapKey = null;
  const res = placePlayerShip(game, row, col, orientation);
  if (!res.ok) {
    // Invalid spot: flash the preview red rather than placing.
    play('denied');
    showPreview(row, col);
    return;
  }
  play('place');
  previewAnchor = null;
  clearPreview();
  renderPlayerBoard();
  if (res.done) {
    beginBattle();
  } else {
    const next = FLEET[game.placementIndex];
    setStatus(`Place your ${next.name} (${next.size})`);
  }
}

/** All 5 player ships placed: the AI deploys and the battle begins. */
function beginBattle() {
  ai.placeFleet(game.enemyBoard);
  startBattle(game);
  els.rotateBtn.setAttribute('aria-disabled', 'true');
  els.undoBtn.setAttribute('aria-disabled', 'true');
  renderEnemyBoard();
  renderFleetStatus(els.playerFleet, game.playerBoard);
  renderFleetStatus(els.enemyFleet, game.enemyBoard);
  setStatus('Your turn: fire!');
}

/**
 * Enemy-board click: the player's shot. Ignored while the AI is thinking
 * (turn lock) and silently ignored on already-fired cells — no error, no
 * turn consumed.
 * @param {number} row @param {number} col
 */
function handleFire(row, col) {
  if (!game || game.phase !== 'battle' || aiThinking) return;
  const res = fireAt(game, 'player', row, col);
  if (res.result === 'invalid' || res.result === 'already-fired') return;
  renderEnemyBoard();
  renderFleetStatus(els.enemyFleet, game.enemyBoard);
  if (res.winner) {
    endGame();
    return;
  }
  play(sfxFor(res.result));
  aiThinking = true;
  setStatus(
    res.result === 'sunk'
      ? `You sunk their ${res.ship.name}! Enemy is firing...`
      : 'Enemy is firing...'
  );
  aiTimer = setTimeout(enemyTurn, AI_TURN_DELAY_MS);
}

/** The AI's delayed reply shot; then control returns to the player. */
function enemyTurn() {
  if (game.phase !== 'battle') return; // game was reset meanwhile
  const shot = ai.nextShot();
  const res = fireAt(game, 'enemy', shot.row, shot.col);
  ai.reportResult(shot.row, shot.col, res.result, res.sunkCells);
  renderPlayerBoard();
  renderFleetStatus(els.playerFleet, game.playerBoard);
  aiThinking = false;
  if (res.winner) {
    endGame();
    return;
  }
  play(sfxFor(res.result));
  setStatus(
    res.result === 'sunk' ? `They sunk your ${res.ship.name}! Your turn: fire!` : 'Your turn: fire!'
  );
}

/** Ends the game: reveals the enemy fleet, fills stats, shows the overlay. */
function endGame() {
  renderEnemyBoard(true); // reveal any unsunk enemy ships
  const won = game.winner === 'player';
  els.endTitle.textContent = won ? 'VICTORY' : 'GAME OVER';
  els.endTitle.className = won ? 'victory' : 'defeat';
  setStatus(won ? 'VICTORY' : 'GAME OVER');

  const p = game.stats.player;
  const e = game.stats.enemy;
  els.endStats.innerHTML =
    '<thead><tr><th></th><th>YOU</th><th>ENEMY</th></tr></thead>' +
    '<tbody>' +
    `<tr><th>SHOTS FIRED</th><td data-stat="player-shots">${p.shots}</td>` +
    `<td data-stat="enemy-shots">${e.shots}</td></tr>` +
    `<tr><th>HITS</th><td data-stat="player-hits">${p.hits}</td>` +
    `<td data-stat="enemy-hits">${e.hits}</td></tr>` +
    `<tr><th>ACCURACY</th><td data-stat="player-accuracy">${accuracyPercent(p.shots, p.hits).toFixed(1)}%</td>` +
    `<td data-stat="enemy-accuracy">${accuracyPercent(e.shots, e.hits).toFixed(1)}%</td></tr>` +
    `<tr><th>TOTAL TURNS</th><td colspan="2" data-stat="total-turns">${game.turnCount}</td></tr>` +
    '</tbody>';
  play(won ? 'victory' : 'defeat');
  els.endOverlay.hidden = false;
  els.playAgainBtn.focus();
}

/* ================= WIRING ================= */

seed = seedFromUrl(window.location.search) ?? Math.floor(Math.random() * 2 ** 31);
buildBoard(els.playerBoard, 'player');
buildBoard(els.enemyBoard, 'enemy');
resetGame();
// A reload may have restored a 'game' entry while the menu is on screen;
// re-stamp it 'menu' so START pushes a fresh entry and Back can't land on
// the stale one.
history.replaceState({ screen: 'menu' }, '');

els.startBtn.addEventListener('click', handleStart);
els.rotateBtn.addEventListener('click', handleRotate);
els.undoBtn.addEventListener('click', handleUndo);
els.soundBtn.addEventListener('click', () => {
  setMuted(!isMuted());
  els.soundBtn.textContent = `SOUND: ${isMuted() ? 'OFF' : 'ON'}`;
  els.soundBtn.setAttribute('aria-pressed', String(isMuted()));
});
els.playAgainBtn.addEventListener('click', () => {
  resetGame();
  // PLAY AGAIN shows the menu while history still sits on the game entry;
  // re-stamp it as 'menu' or a later Back from the next game would land on
  // this stale entry and reopen placement instead of the menu.
  history.replaceState({ screen: 'menu' }, '');
});
// Browser Back/Forward: Back from any game screen pops the 'game' entry and
// lands on the main menu — resetGame abandons the run and shows the start
// screen. Forward back into the game starts a fresh placement.
window.addEventListener('popstate', (e) => {
  if (e.state && e.state.screen === 'game') {
    if (!els.startScreen.hidden) return; // already on the game screen
    resetGame();
    handleStart({ push: false });
  } else if (els.startScreen.hidden || !els.endOverlay.hidden) {
    resetGame();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') handleRotate();
});
