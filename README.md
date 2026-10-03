# NEON BATTLESHIP

Single-player Battleship against a medium-difficulty AI ("hunt and target"
with line lock), rendered in a retro neon-arcade style. Plain HTML, CSS, and
vanilla JavaScript ES modules — no build step, no backend.

## Run the game

Any static file server works from the repo root:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open the printed URL (e.g. `http://localhost:8000`).

### Deterministic mode

Append `?seed=<number>` to the URL (e.g. `?seed=42`) to make the AI's fleet
placement and every shot it takes repeatable — used by the e2e tests and
handy for reproducing a specific game.

## How to play

1. Place your 5 ships on your grid (click; hover shows a green/red preview).
2. Take turns firing at the enemy grid.
3. Sink all 5 enemy ships to win.
4. Press **R** or tap **ROTATE** to turn a ship; **UNDO** removes the last one.
5. On touch screens, tap a cell to place the ship; invalid spots flash red.

## Run the tests

```bash
npm install            # once: installs @playwright/test and serve
npx playwright install chromium   # once: installs the test browser
npm test               # unit tests + e2e tests
npm run test:unit      # node --test only
npm run test:e2e       # Playwright only
```

## Project layout

| File | Role |
| --- | --- |
| `index.html` | Page markup (start screen, boards, end overlay). |
| `styles.css` | All styling: neon theme, scanlines, responsive rules. |
| `src/game.js` | Pure game logic: board, placement, firing, sinking, win check, stats. No DOM. |
| `src/ai.js` | AI fleet placement and hunt-and-target shot selection. No DOM. |
| `src/ui.js` | DOM rendering and event handling only. |
| `src/rng.js` | Seedable RNG (mulberry32); all randomness goes through it. |
| `tests/unit/` | `node:test` unit tests, incl. a 1,000-game AI simulation. |
| `tests/e2e/` | Playwright tests (full game, input locking, mobile viewport). |
| `BUGS_AND_FIXES.md` | Log of real bugs found during development. |

For each deploy, bump the `?v=` query on `styles.css` and `src/ui.js` in
`index.html`; the host sends no cache headers.

## AI behavior (medium)

- **Hunt**: fires at a random untried cell.
- **Target**: after a hit, queues the untried orthogonal neighbours.
- **Line lock**: once two hits line up, fires only along that line in both
  directions until the ship sinks.
- **After a sink**: drops the sunk ship's cells from its pending-hit list;
  if other unresolved hits remain (ships were touching) it keeps targeting
  them, otherwise it returns to hunt mode.
- The AI never fires the same cell twice or off the grid.
