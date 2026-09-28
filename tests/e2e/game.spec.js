/**
 * tests/e2e/game.spec.js — Playwright e2e tests for Neon Battleship.
 *
 * The page is deterministic under ?seed=<n>: these specs import the same
 * rng/ai/game modules the app uses to predict the enemy fleet's cells and
 * the AI's shot outcomes for a given seed.
 */
import { test, expect } from '@playwright/test';
import { createRng } from '../../src/rng.js';
import { createAI } from '../../src/ai.js';
import { createEmptyBoard, fireOnBoard, placeShipOnBoard, FLEET } from '../../src/game.js';

const SEED = 42;

/** Collects console errors + page errors for a spec's whole run. */
function watchConsole(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

/** Returns the enemy fleet's cells for a seed, replicating ui.js rng usage. */
function enemyCellsFor(seed) {
  const rng = createRng(seed);
  const ai = createAI(rng);
  const board = createEmptyBoard();
  ai.placeFleet(board);
  return board.ships.flatMap((s) => s.cells);
}

/**
 * Simulates the AI's first `n` shots against the player's standard fleet
 * (horizontal rows 0-4) using the same rng stream position the real game
 * has after placement — used to predict enemy stats on the end screen.
 */
function simulateAiStats(seed, n) {
  const rng = createRng(seed);
  const ai = createAI(rng);
  ai.placeFleet(createEmptyBoard()); // identical rng consumption as ui.js
  // Same fleet shape placePlayerFleet() produces: rows 0-4, col 0, horizontal.
  const playerBoard = createEmptyBoard();
  FLEET.forEach((def, i) => placeShipOnBoard(playerBoard, def, i, 0, 'horizontal'));
  let hits = 0;
  for (let i = 0; i < n; i++) {
    const c = ai.nextShot();
    const res = fireOnBoard(playerBoard, c.row, c.col);
    ai.reportResult(c.row, c.col, res.result, res.sunkCells);
    if (res.result === 'hit' || res.result === 'sunk') hits++;
  }
  return { shots: n, hits };
}

/** Places all 5 ships horizontally at (row i, col 0) via real clicks. */
async function placePlayerFleet(page) {
  for (let row = 0; row < FLEET.length; row++) {
    await page.locator(`#player-board [data-row="${row}"][data-col="0"]`).click();
  }
  await expect(page.locator('#status-line')).toHaveText('Your turn: fire!');
}

/** Fires at an enemy cell and waits for the AI's return turn to finish. */
async function fireAndAwaitTurn(page, row, col) {
  await page.locator(`#enemy-board [data-row="${row}"][data-col="${col}"]`).click();
  await page.waitForFunction(() => {
    const s = document.getElementById('status-line').textContent;
    const over = !document.getElementById('end-overlay').hidden;
    return over || s.includes('Your turn');
  });
}

test('full game: place ships, fire until victory, stats, play again resets', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  // Start screen alone is visible until START; the game screen stays hidden.
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#game-screen')).toBeHidden();
  await page.getByRole('button', { name: 'START' }).click();
  await expect(page.locator('#start-screen')).toBeHidden();
  await placePlayerFleet(page);

  // Enemy fleet names are listed while positions stay hidden.
  const fleetItems = page.locator('#enemy-fleet li');
  await expect(fleetItems).toHaveCount(5);
  await expect(page.locator('#enemy-fleet li.sunk')).toHaveCount(0);

  // Fire exactly at the seeded enemy cells: player sinks the fleet in 17
  // shots (all hits), so the game ends in VICTORY.
  const targets = enemyCellsFor(SEED);
  for (const c of targets) {
    await fireAndAwaitTurn(page, c.row, c.col);
    if (await page.locator('#end-overlay').isVisible()) break;
  }

  await expect(page.locator('#end-overlay')).toBeVisible();
  await expect(page.locator('#end-title')).toHaveText('VICTORY');
  await expect(page.locator('[data-stat="player-shots"]')).toHaveText('17');
  await expect(page.locator('[data-stat="player-hits"]')).toHaveText('17');
  await expect(page.locator('[data-stat="player-accuracy"]')).toHaveText('100.0%');
  await expect(page.locator('[data-stat="enemy-shots"]')).toHaveText('16');
  const sim = simulateAiStats(SEED, 16);
  await expect(page.locator('[data-stat="enemy-hits"]')).toHaveText(String(sim.hits));
  await expect(page.locator('[data-stat="total-turns"]')).toHaveText('33');
  // Unsunk ships would be revealed; here all 5 are sunk so every enemy
  // roster entry is struck through.
  await expect(page.locator('#enemy-fleet li.sunk')).toHaveCount(5);

  await page.getByRole('button', { name: 'PLAY AGAIN' }).click();
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#status-line')).toHaveText('READY');
  // Clean reset: no fired or ship cells remain on either board.
  await expect(page.locator('#player-board .cell-ship, #player-board .cell-hit, #player-board .cell-miss')).toHaveCount(0);
  await expect(page.locator('#enemy-board .cell-hit, #enemy-board .cell-miss, #enemy-board .cell-sunk, #enemy-board .cell-revealed')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('battle input locking: clicks during AI turn and on fired cells are ignored', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await page.getByRole('button', { name: 'START' }).click();
  await placePlayerFleet(page);

  const first = page.locator('#enemy-board [data-row="9"][data-col="9"]');
  const second = page.locator('#enemy-board [data-row="9"][data-col="8"]');
  await first.click();
  await expect(page.locator('#status-line')).toContainText('Enemy is firing');

  // Click during the AI's turn: ignored — cell remains unfired.
  await second.click({ force: true });
  await expect(second).toHaveAttribute('aria-label', /not fired/);
  await page.waitForFunction(() =>
    document.getElementById('status-line').textContent.includes('Your turn')
  );
  await expect(second).toHaveAttribute('aria-label', /not fired/);

  // Click the already-fired cell again: nothing changes.
  const labelBefore = await first.getAttribute('aria-label');
  await first.click({ force: true });
  await expect(first).toHaveAttribute('aria-label', labelBefore);
  await expect(page.locator('#status-line')).toHaveText('Your turn: fire!');
  expect(errors).toEqual([]);
});

test('browser Back returns to the main menu from placement and battle', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await page.getByRole('button', { name: 'START' }).click();

  // Back during placement -> start screen, state reset.
  await page.locator('#player-board [data-row="0"][data-col="0"]').click();
  await page.goBack();
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#status-line')).toHaveText('READY');
  await expect(page.locator('#player-board .cell-ship')).toHaveCount(0);

  // Back during battle -> same clean reset.
  await page.getByRole('button', { name: 'START' }).click();
  await placePlayerFleet(page);
  await page.locator('#enemy-board [data-row="9"][data-col="9"]').click();
  await page.goBack();
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#status-line')).toHaveText('READY');
  await expect(page.locator('#enemy-board .cell-hit, #enemy-board .cell-miss')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Back after PLAY AGAIN + START still lands on the main menu', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await page.getByRole('button', { name: 'START' }).click();
  await placePlayerFleet(page);
  for (const c of enemyCellsFor(SEED)) {
    await fireAndAwaitTurn(page, c.row, c.col);
    if (await page.locator('#end-overlay').isVisible()) break;
  }
  await page.getByRole('button', { name: 'PLAY AGAIN' }).click();
  await page.getByRole('button', { name: 'START' }).click();
  await page.goBack();
  // Must reach the menu — not a fresh placement on the stale game entry.
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#status-line')).toHaveText('READY');
  expect(errors).toEqual([]);
});

test('Back after reload on a game entry still lands on the main menu', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await page.getByRole('button', { name: 'START' }).click();
  await page.reload(); // menu shows again on the old 'game' history entry
  await page.getByRole('button', { name: 'START' }).click();
  await page.goBack();
  await expect(page.locator('#start-screen')).toBeVisible();
  await expect(page.locator('#status-line')).toHaveText('READY');
  expect(errors).toEqual([]);
});

test('Back during the AI turn cancels its pending reply', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await page.getByRole('button', { name: 'START' }).click();
  await placePlayerFleet(page);
  // Fire, then Back within the 600ms AI delay — the timer must not leak
  // into the next game as an early/out-of-turn enemy shot.
  await page.locator('#enemy-board [data-row="9"][data-col="9"]').click();
  await page.goBack();
  await page.getByRole('button', { name: 'START' }).click();
  await placePlayerFleet(page);
  await page.locator('#enemy-board [data-row="8"][data-col="8"]').click();
  await page.waitForFunction(() =>
    document.getElementById('status-line').textContent.includes('Your turn')
  );
  // Exactly one AI reply on the player board — the abandoned game's timer
  // did not fire into this battle.
  await expect(page.locator('#player-board .cell-hit, #player-board .cell-miss')).toHaveCount(1);
  expect(errors).toEqual([]);
});

// Check the two narrowest common phone widths — 375px is the tight case.
for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test.describe(`mobile viewport ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true });

    test('boards stack vertically and cells are at least 32px', async ({ page }) => {
      const errors = watchConsole(page);
      await page.goto(`/?seed=${SEED}`);
      await page.getByRole('button', { name: 'START' }).tap();

      const playerBox = await page.locator('#player-board').boundingBox();
      const enemyBox = await page.locator('#enemy-board').boundingBox();
      expect(enemyBox.y).toBeGreaterThan(playerBox.y + playerBox.height - 1);

      const cellBox = await page.locator('#enemy-board .cell').first().boundingBox();
      expect(cellBox.width).toBeGreaterThanOrEqual(32);
      expect(cellBox.height).toBeGreaterThanOrEqual(32);
      expect(errors).toEqual([]);
    });
  });
}
