/**
 * tests/e2e/audio.spec.js — Playwright e2e tests for the sound module.
 *
 * Verifies the mute button exists and toggles (button + M key), that the
 * mute choice persists across reloads, and that a full placement + firing
 * sequence still works with sound enabled (a real AudioContext runs in
 * headless Chromium, so the play() calls are exercised for real).
 */
import { test, expect } from '@playwright/test';
import { FLEET } from '../../src/game.js';

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

test('mute button exists, toggles aria-pressed, and persists across reload', async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);

  const muteBtn = page.locator('#mute-btn');
  await expect(muteBtn).toBeVisible();
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(muteBtn).toHaveText('SOUND: ON');

  await muteBtn.click();
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(muteBtn).toHaveText('SOUND: OFF');

  // The preference survives a reload.
  await page.reload();
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(muteBtn).toHaveText('SOUND: OFF');

  // M key toggles it back.
  await page.keyboard.press('m');
  await expect(muteBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(muteBtn).toHaveText('SOUND: ON');
  expect(errors).toEqual([]);
});

test('gameplay works with sound enabled: place fleet and take a turn', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto(`/?seed=${SEED}`);
  await expect(page.locator('#mute-btn')).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: 'START' }).click();

  // Place all 5 ships horizontally — exercises the 'place' sound.
  for (let row = 0; row < FLEET.length; row++) {
    await page.locator(`#player-board [data-row="${row}"][data-col="0"]`).click();
  }
  await expect(page.locator('#status-line')).toHaveText('Your turn: fire!');

  // Fire once — hit or miss sound, then the AI's quieter reply.
  await page.locator('#enemy-board [data-row="9"][data-col="9"]').click();
  await page.waitForFunction(() =>
    document.getElementById('status-line').textContent.includes('Your turn')
  );
  await expect(page.locator('#status-line')).toHaveText('Your turn: fire!');
  expect(errors).toEqual([]);
});
