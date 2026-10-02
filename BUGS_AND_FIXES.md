# Bugs and fixes

Real bugs found during development (not planned work).

## 1. Start screen and game screen rendered on top of each other

- **Bug:** The placement controls and both boards were visible underneath
  the START screen, and after clicking START the start-screen content stayed
  on the page above the boards.
- **How found:** Manual screenshot of the start screen during development —
  the boards were plainly visible below the "How to play" panel.
- **Root cause:** `.screen { display: flex }` overrides the `hidden`
  attribute's default `display: none`, so toggling `hidden` in ui.js had no
  visual effect.
- **Fix:** Added `[hidden] { display: none !important; }` in `styles.css`
  (commit `0033967`).
- **Prevention:** The full-game e2e test now asserts `#game-screen` is
  hidden before START and `#start-screen` is hidden after it
  (`tests/e2e/game.spec.js`).

## 2. Mobile grid cells were below the 32px tap target

- **Bug:** At a 390×844 viewport, cells measured ~31.1px — under the
  required 32px minimum for touch.
- **How found:** The mobile e2e test ("boards stack vertically and cells are
  at least 32px") failed on `cellBox.width >= 32`.
- **Root cause:** The board was capped at `92vw` with an 18px label column
  and 2px gaps: (358.8 − 8 padding − 20 gaps − 18 label) / 10 ≈ 31.1px.
- **Fix:** Board width raised to `94vw` on mobile, label column narrowed to
  14px (commit `0033967`). Cells now measure ~33px at 390px.
- **Prevention:** Same e2e test keeps asserting cell width and height ≥ 32px.

## 3. Win-detection unit test stalled: winner never reached

- **Bug:** The "game ends only when every ship cell is hit" test never saw
  `winner === 'player'` even though all enemy ships were sunk on schedule.
- **How found:** `node --test` failure — `res.winner` was `undefined` on the
  final shot.
- **Root cause:** Test-authored bug, not game logic. The "enemy burn shots"
  used `(row * 10 + col) % 10` and produced duplicate cells; a duplicate shot
  returns `already-fired` and correctly does **not** consume a turn, so the
  next player shot was rejected as out-of-turn and the loop fell out of sync.
- **Fix:** Burn shots now walk distinct guaranteed-miss cells (rows 5–9)
  (commit `c9ab6a6`).
- **Prevention:** The corrected test itself — it now asserts every burn
  shot is a `miss`, so a repeated cell fails loudly instead of silently
  desynchronising the turn order.

## 4. AI abandoned unresolved hits on parallel touching ships

- **Bug:** Two vertical ships side by side produce hits that look like one
  horizontal run; the AI line-locked on the fake row, and once both
  extensions missed it fell back to random hunting while hits were still
  unresolved.
- **How found:** Devin Review on PR #1.
- **Root cause:** `computeTargets` queued only the line extensions for a
  run — the off-axis neighbours of run cells were never candidates.
- **Fix:** Line-run cells now also contribute their off-axis neighbours,
  queued behind the line extensions so line lock still takes priority
  (commit `b13a121`).
- **Prevention:** `ai.test.js` gained "exhausted line falls back to
  neighbours, not hunt" and a "parallel touching ships" full sim.

## 5. Rotating left a stale placement preview

- **Bug:** Pressing R while hovering kept the old-orientation preview
  painted; the click then used the new orientation, so the highlight could
  show green where the ship no longer fit.
- **How found:** Devin Review on PR #1.
- **Root cause:** `handleRotate` never repainted the preview; the anchor
  cell wasn't tracked.
- **Fix:** `showPreview` now records `previewAnchor` and `handleRotate`
  repaints at that anchor (commit `b13a121`).
- **Prevention:** Manual playthrough — hover a horizontal anchor near the
  bottom row, press R, confirm the preview turns red.

## 6. Keyboard placement inherited the touch two-tap rule

- **Bug:** After any touch tap, a keyboard Tab+Enter on a cell only armed a
  preview; a second Enter was needed to place.
- **How found:** Devin Review on PR #1.
- **Root cause:** `pointerWasTouch` was global state from the last
  `pointerdown`, so keyboard-generated clicks were misclassified as taps.
- **Fix:** `handlePlacementClick` now receives the event and treats
  `e.detail === 0` (keyboard activation) as an immediate placement
  (commit `b13a121`).
- **Prevention:** Code review — the input classification is per-event now.

## 7. Grid cells under 32px on 375px phones

- **Bug:** At a 375px viewport cells measured ~30.9px — under the 32px tap
  target (the earlier fix only reached ~33px at 390px).
- **How found:** Devin Review on PR #1.
- **Root cause:** 94vw board + 14px label column + 2px gaps didn't leave
  32px per cell below ~383px.
- **Fix:** Mobile grid uses `repeat(10, minmax(32px, 1fr))` with a 12px
  label column, 1px gaps, 2px padding, and horizontal scroll on the wrap for
  narrower screens (commit `b13a121`).
- **Prevention:** The mobile e2e test now runs at both 390×844 and
  375×667 asserting cell size ≥ 32px.

## 8. PLAY AGAIN left a stale ROTATE label

- **Bug:** After finishing a game rotated to vertical, PLAY AGAIN reset the
  placement orientation to horizontal but the button still read `ROTATE: V`.
- **How found:** Devin Review on PR #1.
- **Root cause:** `resetGame` restored `orientation` but not the button
  text set by `handleRotate`.
- **Fix:** `resetGame` now sets the label back to `ROTATE: H`
  (commit `b13a121`).
- **Prevention:** Manual check — rotate, PLAY AGAIN, verify the label.

## 9. Undo resurrected the cleared placement preview on rotate

- **Bug:** After placing a ship, hovering a new cell, then pressing UNDO,
  the preview was cleared — but a later ROTATE repainted a preview at the
  abandoned anchor cell even though the pointer had moved on.
- **How found:** Devin Review follow-up flag on PR #2 (fixed via PR #3).
- **Root cause:** `handleUndo` cleared the painted preview but left
  `previewAnchor` set, so `handleRotate` repainted the stale anchor.
- **Fix:** `handleUndo` now nulls `previewAnchor` (commit `e1a4b72`).
- **Prevention:** Code review — undo now resets all preview state
  (`armedTapKey`, `previewAnchor`, painted cells) together.

## 10. Browser Back button did nothing

- **Bug:** Clicking the browser Back button during a game did not return to
  the main menu — nothing happened.
- **How found:** Manual playthrough reported by Eva.
- **Root cause:** The game is a single static page; screens are toggled with
  `hidden`, and no history entries were ever pushed, so the browser had
  nowhere to go Back to.
- **Fix:** `handleStart` now `history.pushState({ screen: 'game' })`, and a
  `popstate` listener returns to the main menu (full `resetGame`) on Back,
  or re-enters a fresh placement on Forward (commit `6effb9c`).
- **Prevention:** E2E test "browser Back returns to the main menu from
  placement and battle" asserts a clean reset from both screens
  (`tests/e2e/game.spec.js`).

## 11. Back button edge cases: stale game entries and a leaking AI timer

- **Bug:** Three follow-up defects in the bug-10 fix: (a) PLAY AGAIN then
  START then Back reopened a fresh placement instead of the menu, because
  PLAY AGAIN left history on the old game entry; (b) reloading mid-game
  made START push a second game entry, so Back landed on the stale one;
  (c) pressing Back during the AI's 600ms reply delay let its timer fire
  into the next game as an early/out-of-turn shot.
- **How found:** Devin Review on PR #5.
- **Root cause:** History state was written only on START, so it could drift
  from the screen actually shown (menu rendered over a 'game' entry after
  PLAY AGAIN or a reload), and the AI reply `setTimeout` was never tracked,
  so `resetGame` could not cancel it.
- **Fix:** History state now always mirrors the visible screen — init and
  PLAY AGAIN `replaceState({screen:'menu'})`, and the Forward path
  re-stamps `({screen:'game'})`. The AI reply timer is stored in `aiTimer`
  and cleared in `resetGame` (commit `c94b282`).
- **Prevention:** Three e2e tests in `tests/e2e/game.spec.js`: "Back after
  PLAY AGAIN + START still lands on the main menu", "Back after reload on a
  game entry still lands on the main menu", and "Back during the AI turn
  cancels its pending reply".

## 12. Browser Forward from the menu did nothing

- **Bug:** After Back reached the main menu, the browser Forward button was
  a no-op — it never re-entered the game.
- **How found:** E2E sanity check of navigation during the sound-effects
  testing session.
- **Root cause:** The `popstate` guard meant to skip redundant handling
  while already in-game checked `!els.startScreen.hidden` — true whenever
  the *menu* was showing — so the Forward branch returned early on exactly
  the state it was meant to handle.
- **Fix:** The guard now checks `!els.gameScreen.hidden`, i.e. "already on
  the game screen" (commit `f16abc1`).
- **Prevention:** E2E test "browser Forward re-enters placement after Back"
  in `tests/e2e/game.spec.js`.

## 13. SOUND button was blocked by the end overlay

- **Bug:** The SOUND button could not be clicked on the end screen, when the
  victory or game-over jingle was playing.
- **How found:** Live-site investigation of a user report that SOUND wouldn't
  toggle — `elementFromPoint` showed `#end-overlay` covering the button.
- **Root cause:** `#end-overlay` has `z-index: 60`, while the header's mute
  button had no stacking level above it.
- **Fix:** Positioned `#mute-btn` at `z-index: 61` (commit `d7ec5ae`).
- **Prevention:** E2E test "SOUND button stays clickable over the end
  overlay" toggles sound both ways with plain clicks and checks console errors.
