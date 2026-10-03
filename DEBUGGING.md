# Debugging Neon Battleship

## 1. Overview

Neon Battleship is a single-player browser Battleship game built with plain
HTML, CSS, and JavaScript ES modules. Its responsibilities are split across
five modules:

| Module | Responsibility |
| --- | --- |
| `src/game.js` | Board state, ship placement, firing, turns, win detection, and statistics. |
| `src/ai.js` | Enemy fleet placement and hunt-and-target shot selection, including line lock. |
| `src/ui.js` | DOM rendering, input handling, screen transitions, and the delayed AI reply. |
| `src/audio.js` | Retro arcade sound effects synthesized with Web Audio and mute handling. |
| `src/rng.js` | Seedable randomness for repeatable fleet placement and AI shots. |

The project uses `node --test` unit tests in `tests/unit/` and Playwright e2e
tests in `tests/e2e/`. Unit tests exercise game rules and AI targeting; e2e
tests exercise the rendered game, input locking, mobile layout, and browser
navigation. The `?seed=<number>` URL parameter makes games reproducible,
and `tests/e2e/game.spec.js` imports the same game, AI, and RNG modules to
predict fleet positions and shot outcomes.

This write-up reorganizes the eleven entries in [BUGS_AND_FIXES.md](BUGS_AND_FIXES.md)
by root cause. Bug numbers and abbreviated commit hashes refer to that log;
the original log remains the record of how each issue was found and fixed.

## 2. How bugs were found

The detection channels covered different kinds of failures. Initial discovery
and later regression coverage are distinguished below.

| Channel | What it found or checked |
| --- | --- |
| **Playwright e2e tests** | The mobile test caught bug 2 when a cell's width was below 32px. It later covered bug 7 at both 390×844 and 375×667. Screen-visibility assertions guard bug 1, and Back-button tests guard bugs 10 and 11, including reset during a pending AI reply. The Back-button issues were initially found through manual play and review, respectively. |
| **`node --test` unit tests** | The win-detection test caught bug 3: its final shot had no `winner`. Investigation showed that the test's own repeated enemy shots had broken turn alternation, rather than exposing a win-detection defect in the game. |
| **Devin Review PR flags** | Review on PR #1 flagged bugs 4–8: AI targeting, rotation preview, keyboard/touch classification, smaller-phone layout, and the stale ROTATE label. A follow-up on PR #2 flagged bug 9, fixed via PR #3. Review on PR #5 flagged bug 11's history and timer edge cases. |
| **Manual playthroughs and screenshots** | A development screenshot exposed bug 1's overlapping screens. Eva's manual playthrough exposed bug 10's ineffective Back button. The log also records manual checks for bug 5's rotated preview and bug 8's reset label. |

## 3. Bug case studies

### A. CSS and `hidden` attribute specificity — bug 1

**Symptom and cause.** The boards and placement controls appeared beneath the
START screen, and the start content remained visible after START. Toggling
`hidden` in `src/ui.js` did not hide those elements because
`.screen { display: flex }` in `styles.css` overrode the attribute's default
`display: none` behavior.

**Fix and regression check.** Commit `0033967` added
`[hidden] { display: none !important; }` to `styles.css`.
The full-game test in `tests/e2e/game.spec.js` asserts that `#game-screen` is
hidden before START and `#start-screen` is hidden afterward. This checks the
rendered result, rather than assuming that a DOM attribute guarantees it.

### B. Layout math for the 32px touch target — bugs 2 and 7

**Bug 2: the first mobile width failed.** At 390×844, cells measured about
31.1px. The original 92vw board budget was consumed by padding, gaps, and
the label column:

```text
(358.8 − 8 padding − 20 gaps − 18 label) / 10 ≈ 31.1px
```

The mobile e2e assertion `cellBox.width >= 32` failed. Commit `0033967`
raised the mobile board width to 94vw and reduced the label column to 14px,
giving cells about 33px at a 390px viewport.

**Bug 7: the same budget failed on a smaller phone.** Review found that at
375px, cells were still about 30.9px. A 94vw board with a 14px label column
and 2px gaps could not reserve 32px per cell below about 383px.
Commit `b13a121` made the minimum explicit with
`repeat(10, minmax(32px, 1fr))`, a 12px label column, 1px gaps, and 2px padding
in `styles.css`. The board wrapper scrolls horizontally on narrower screens
instead of shrinking cells below the target.

**Regression check.** The test “boards stack vertically and cells are at
least 32px” in `tests/e2e/game.spec.js` now runs at both 390×844 and 375×667,
asserting cell width and height are at least 32px. The second fix turns a
viewport-dependent success into an explicit layout constraint.

### C. Stale or unfinished state resets — bugs 5, 8, and 9

These bugs involved related pieces of UI state being updated separately in
`src/ui.js`.

- **Bug 5 — rotation kept the old preview.** Pressing R while hovering
  changed the placement orientation but left the old highlight painted. A
  green preview could therefore disagree with the next click's placement.
  `handleRotate` did not repaint, and no anchor cell was tracked. Commit
  `b13a121` made `showPreview` record `previewAnchor` and made
  `handleRotate` repaint at that anchor. The logged manual check is to hover
  a horizontal anchor near the bottom row, press R, and confirm the preview
  turns red.
- **Bug 8 — PLAY AGAIN kept the old ROTATE label.** Resetting after a game
  with vertical orientation restored horizontal placement, but the button
  still read `ROTATE: V`. Commit `b13a121` made `resetGame` restore the
  button text to `ROTATE: H` along with `orientation`. The log records a
  manual rotate/reset label check.
- **Bug 9 — undo left an anchor that rotation could revive.** After placing
  a ship, hovering another cell, and pressing UNDO, the painted preview
  disappeared but `previewAnchor` remained. A later ROTATE could repaint the
  abandoned preview. Commit `e1a4b72` made `handleUndo` null
  `previewAnchor`; undo now clears the anchor, `armedTapKey`, and painted
  cells together. The log records code review as the prevention check.

The dependency between bugs 5 and 9 is instructive: tracking an anchor fixed
rotation, but that anchor also had to participate in undo's cleanup.

### D. Input classification: touch versus keyboard — bug 6

**Symptom and cause.** After a touch tap, Tab+Enter on a placement cell only
armed its preview; another Enter was needed to place the ship. The global
`pointerWasTouch` retained the last `pointerdown` classification, so a
keyboard-generated click inherited the touch two-tap rule.

**Fix and prevention check.** Commit `b13a121` made
`handlePlacementClick` in `src/ui.js` receive the click event. It treats
`e.detail === 0` as keyboard activation and places immediately, regardless
of the previous pointer type. The two-tap branch requires `e.detail !== 0`.
The log records code review of this per-event classification as prevention;
it does not record a dedicated automated keyboard-after-touch test.

### E. A test-authored bug — bug 3

**Symptom and cause.** The unit test “game ends only when every ship cell is
hit” never reached `winner === 'player'`; the final shot's `res.winner` was
`undefined`. Its enemy “burn shots” used `(row * 10 + col) % 10` and repeated
cells. In `src/game.js`, an `already-fired` result correctly consumes no
turn. The next player shot was therefore out of turn, and the test loop
became desynchronized.

**Fix and regression check.** Commit `c9ab6a6` corrected the test in
`tests/unit/game.test.js` to walk distinct, guaranteed-miss cells in rows
5–9. Each enemy burn shot now asserts `res.result === 'miss'`, so invalid
test setup fails at the point of the mistake. The game logic did not need
to be changed to satisfy this test.

### F. AI algorithm edge case: parallel touching ships — bug 4

**Symptom and cause.** Two vertical ships placed side by side can yield
hits that resemble one horizontal run. The AI locked onto that apparent
row; after both extensions missed, it returned to random hunting despite
unresolved hits. In `src/ai.js`, `computeTargets` queued only the run's
extensions and omitted off-axis neighbors of its cells.

**Fix and regression checks.** Commit `b13a121` added those off-axis
neighbors behind the line-extension candidates. Line lock still has
priority, but exhausting it leaves useful targets instead of abandoning
the hits. `tests/unit/ai.test.js` covers this with “exhausted line falls
back to neighbours, not hunt” and a full simulation of parallel touching
ships. The placement rules in `src/game.js` allow adjacent ships, so this
was a legal board configuration the targeting algorithm had to handle.

### G. Browser history integration and a timer leak — bugs 10 and 11

**Bug 10: screens changed without history entries.** Eva reported that Back
during a game did not return to the main menu. The game is a single static
page, and toggling screens with `hidden` had created no history entries.
Commit `6effb9c` added `history.pushState({ screen: 'game' })` in
`handleStart` and a `popstate` listener in `src/ui.js`. Back performs a full
`resetGame`; Forward enters a fresh placement. The e2e test “browser Back
returns to the main menu from placement and battle” in
`tests/e2e/game.spec.js` checks clean resets from both phases.

**Bug 11: history and asynchronous work outlived the visible game.** Review
of the Back-button fix found three follow-up defects:

1. PLAY AGAIN showed the menu while leaving the current entry marked as a
   game. START followed by Back could reopen placement instead of the menu.
2. Reloading on a game entry showed the menu, but START pushed another game
   entry; Back then landed on the stale one.
3. Back during the AI's 600ms reply delay left a timer that could fire into
   the next game as an early or out-of-turn shot.

History state had only been written on START, and the reply `setTimeout`
was not tracked. Commit `c94b282` made initialization and PLAY AGAIN use
`replaceState({ screen: 'menu' })`, while the Forward path re-stamps the
game entry. It also stored the reply timer in `aiTimer` and cleared it in
`resetGame`.

Three tests in `tests/e2e/game.spec.js` preserve the repro sequences:

- “Back after PLAY AGAIN + START still lands on the main menu”;
- “Back after reload on a game entry still lands on the main menu”;
- “Back during the AI turn cancels its pending reply”.

The timer test starts another battle and checks that exactly one AI reply
appears, testing cleanup across games rather than only checking that the
menu is visible.

## 4. Lessons / prevention

- **Make “every fix ships with a regression test” the prevention rule.**
  The recurring pattern in the log is a fix paired with a prevention check.
  Bugs 1–4, 7, 10, and 11 have automated unit or e2e coverage recorded;
  bugs 5 and 8 record manual checks, and bugs 6 and 9 record code review.
  Those distinctions matter: the log does not establish that all eleven
  fixes shipped with automated regression tests. Preserve the exact failing
  sequence when turning the remaining checks into tests.
- **Reset paired state together.** Orientation and its label, or a preview's
  painted cells, anchor, and armed touch key, must stay consistent. Bugs 5,
  8, and 9 show that clearing only the visible part leaves later handlers
  able to revive stale state.
- **Classify the current activation.** In this UI, `e.detail === 0` identifies
  a keyboard-generated click. Handle it directly instead of applying a rule
  inherited from the last touch event (bug 6).
- **Assert rendered constraints.** Check screen visibility as well as
  `hidden` attributes, and account for labels, gaps, and padding when
  enforcing the 32px minimum. Test both recorded phone widths (bugs 1, 2,
  and 7).
- **Check the test's setup actions.** The win test's `miss` assertion catches
  turn-order drift where it begins. A failing final assertion can originate
  in the test's earlier moves (bug 3).
- **Keep alternatives when a targeting assumption fails.** Adjacent hits
  need not belong to one ship. Prioritize line extensions while retaining
  off-axis candidates for unresolved hits (bug 4).
- **Keep history state in sync with the visible screen.** START, PLAY AGAIN,
  reload initialization, and Forward must agree on whether the current
  entry represents the menu or game. Cover navigation sequences, not just
  one Back action (bugs 10 and 11).
- **Cancel pending timers on reset.** Track the AI reply in `aiTimer` and
  clear it before another game can receive the abandoned callback. The
  regression check must cross the reset boundary into a new battle (bug 11).
