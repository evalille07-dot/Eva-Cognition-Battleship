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
