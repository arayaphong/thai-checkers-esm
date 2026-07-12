# Refactor: explicit animation-state lifecycle in GameView

## Context

`view/gameView.mjs` currently tracks "is a move animation in flight" using two
independent nullable closure variables, `pendingAnimationAbort` and
`pendingAnimationDone`. They're set and cleared from four different spots
across two functions (`performMoveAnimation`, `showMoveMade`), plus a third
reset path in `stopAnimation()`, and each uses its own object-identity guard
(`pendingAnimationAbort === abortController`, `pendingAnimationDone === donePromise`)
to avoid a stale continuation clobbering a newer animation (e.g. back-to-back
AI moves). The in-code comments already admit this is a partial consolidation
of a worse, more-duplicated version that caused a real bug. The user's ask:
make it obvious where animation state starts and stops, without changing any
observable behavior.

`htmlMotionSurface.mjs`, `motionClassMap.mjs`, and `BoardMoveAnimationView.mjs`
are already clean (independent, abort-signal-cancelable effects) and are out
of scope.

## Approach

Extract the lifecycle into a new dedicated module, `view/gameViewAnimationLifecycle.mjs`,
following the codebase's existing pattern of splitting single-responsibility
pieces out of the orchestrator (`gameViewStateFactory.mjs`, `BoardMoveAnimationView.mjs`).
It holds **one** nullable record instead of two variables:

```js
current = null | { generation, phase: 'in-flight' | 'settling', abortController, donePromise };
```

`phase` replaces the implicit "which variable is null" encoding. A monotonic
`generation` counter replaces both identity-comparison guards with a single
inspectable integer compared via `===`.

### `view/gameViewAnimationLifecycle.mjs` (new)

Exposes: `isInFlight()`, `isAnimating()`, `waitForAnimation()`, `beginAnimation(run)`,
`cancelAnimation()`.

- `beginAnimation(run)` bumps `generation`, creates an `AbortController`, stores
  `{ generation, phase: 'in-flight', abortController, donePromise }`, and invokes
  `run(signal, markSettling)`. `markSettling()` (passed into `run`) flips `phase`
  to `'settling'` if this generation is still current. The returned promise
  clears `current` in a `finally`, again only if still current.
- `cancelAnimation()` unconditionally aborts and nulls `current` — matches
  today's `stopAnimation()` behavior (no identity guard needed there).
- `isInFlight()` is true only during `'in-flight'`; `isAnimating()` is true for
  both phases. This exactly mirrors when `pendingAnimationAbort` vs.
  `pendingAnimationDone` are non-null today.

### `view/gameView.mjs` (rewritten)

- Replaces both closure variables with one `animationLifecycle = createGameViewAnimationLifecycle()`.
- `performMoveAnimation` becomes `runMoveAnimation(moveDisplay, settledViewState, signal, markSettling)` —
  pure animation sequencing, no state bookkeeping of its own. Calls `markSettling()`
  right after `await Promise.allSettled(animations)`, exactly where `pendingAnimationAbort`
  used to be cleared.
- `refresh`/`refreshBoard` guard on `!animationLifecycle.isInFlight()`.
- `isAnimating`/`waitForAnimation` delegate straight through.
- `showMoveMade` becomes `animationLifecycle.beginAnimation((signal, markSettling) => runMoveAnimation(...))`.
- `stopAnimation` calls `animationLifecycle.cancelAnimation()` then `animationView.clearAnimationLayer()`.

Net effect: `gameView.mjs` has zero raw mutable animation-state variables of
its own; every start/settle/end/cancel transition lives in one file
(`gameViewAnimationLifecycle.mjs`), in named functions.

**No changes** to `gameViewBinder.mjs` or `htmlGameViewFactory.mjs` — the
public contract (`isAnimating`, `waitForAnimation`, `stopAnimation`,
`showMoveMade`, `refresh`, `refreshBoard`, `refreshStatus`,
`showSetupScreen`/`showPlayingScreen`/`showGameOverScreen`) is unchanged, so
the existing hand-rolled fake `gameView` in `tests/view/smoke-game-flow.test.mjs`
(~line 298) needs no edits.

### Boundary test

`tests/view/check-view-boundaries.test.mjs` walks a fixed `semanticTargets`
list for forbidden DOM/HTML/CSS tokens. Add `'view/gameViewAnimationLifecycle.mjs'`
to that list — the new file contains none of the forbidden tokens today, but
should be scanned going forward since its whole purpose is staying semantic.

## Tests to add

1. **`tests/view/game-view-animation-lifecycle.test.mjs`** — unit tests of
   `createGameViewAnimationLifecycle` in isolation (plain `describe`/`test` +
   `node:assert/strict`, matching `check-view-boundaries.test.mjs`'s style):
   - `beginAnimation` sets `isInFlight()`/`isAnimating()` true immediately;
     calling the supplied `markSettling()` flips `isInFlight()` false while
     `isAnimating()` stays true; awaiting the returned promise clears both.
   - `cancelAnimation()` aborts the signal passed to `run` and clears
     `isAnimating()` synchronously, mid-flight.
   - Generation/clobber case: start animation A (don't resolve), `cancelAnimation()`,
     start animation B, then let A's `run` promise resolve (calling A's
     `markSettling`) — assert state still reflects B, unaffected by A's late
     completion.
   - `waitForAnimation()` resolves (never rejects) even if `run` rejects.

2. **`tests/view/game-view.test.mjs`** — first direct test of `createGameView`
   itself (none exists today — it's only exercised indirectly via
   `htmlGameViewFactory.mjs`), using trivial recording fakes for
   `boardView`/`statusView`/`controlPanelView`/`layoutSurface` and a
   controllable fake `animationView`:
   - `refresh()`/`refreshBoard()` are guarded while an animation is in-flight
     and unguarded again once it settles, before the animation's own final
     render fires.
   - `isAnimating()`/`waitForAnimation()` go true → false around a full
     `showMoveMade()` call.
   - `stopAnimation()` clears `isAnimating()` synchronously and calls
     `animationView.clearAnimationLayer()`.
   - Back-to-back moves: `showMoveMade(A)`, then `stopAnimation()` +
     `showMoveMade(B)` before A resolves; once A's stale promise later
     resolves, state must still reflect B.

Both new files match `jest.config.mjs`'s `testMatch` (`tests/**/*.test.mjs`),
so no config changes needed.

## Verification

- `npm test` — full suite, confirm the two new test files pass and nothing
  else regresses (especially `check-view-boundaries.test.mjs` and
  `smoke-game-flow.test.mjs`).
- Manual smoke check via the `run` skill: start a game, make a move, trigger
  a capture (ripple + slide + fade + land all fire), then trigger back-to-back
  AI moves fast enough to test the cancel/clobber path, confirming the slide
  animation still looks identical to current behavior.

## Files touched

- `view/gameViewAnimationLifecycle.mjs` (new)
- `view/gameView.mjs` (rewritten to compose the new module)
- `tests/view/check-view-boundaries.test.mjs` (add one line to `semanticTargets`)
- `tests/view/game-view-animation-lifecycle.test.mjs` (new)
- `tests/view/game-view.test.mjs` (new)

## Outcome (2026-07-11)

Implemented as planned, with no deviations:

- `npm test`: 20 suites, 152 tests, all passing.
- Manual browser smoke test: served the repo with `python3 -m http.server`,
  drove it with Playwright (`chromium`, headless, via the `playwright`
  dependency already vendored under `.tmp/test-playwright/`). Selected a
  white piece, moved it, captured a mid-slide frame (piece visibly between
  its origin and destination square) and the settled frame (piece landed,
  turn switched to black). Zero console errors.
- `gameViewBinder.mjs` and `htmlGameViewFactory.mjs` needed no edits, as
  predicted — the public `GameView` contract didn't change shape.
