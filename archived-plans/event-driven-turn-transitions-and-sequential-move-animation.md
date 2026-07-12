# Make turn transitions wait for real animation completion; make move animation strictly sequential

## Context

`controller/GameController.mjs` currently starts the next AI turn from a
hardcoded 320 ms delay. The view's move animation has its own timing, so the
controller and view race and the "AI is thinking" status can appear while the
previous move is still visibly playing.

The first draft of this plan correctly replaced that controller delay with an
awaited `moveMade` listener, but a repository review found several related
correctness gaps that must be fixed at the same time:

- `GameView.showMoveMade()` does **not** currently represent the complete
  visual move: landing is fire-and-forget, and the slide timeout begins before
  the two `requestAnimationFrame` callbacks that actually start the slide.
- the next human's status and piece selection can advance during the previous
  move animation;
- the proposed human-only hop flag does not protect AI hop replay;
- pausing an AI multi-capture after `GameDriver` has atomically committed it
  can leave `driver` after the whole turn while the model is only after hop 1;
- a synchronous listener throw is not caught by `Promise.allSettled` when the
  listener is invoked directly inside `.map()`;
- reset-generation checks must protect the continuations _inside_ `applyHop`,
  and stale cleanup must not clear a newer operation's lock;
- a future Worker cannot receive or mutate the live `GameDriver` instance, and
  replacing one function body cannot by itself start search before the current
  controller calls that function.

This revision treats the work as one synchronization protocol across the DOM
motion surface, `GameView`, the binder, and the controller. It keeps the user's
confirmed visual sequence and timing goal:

1. no move-to-next-turn pacing timers in the controller;
2. strict visual order: **lift → slide → land → fade-captured**;
3. reuse the existing ripple as lift;
4. shorten the CSS effects so the final sequential animation remains close to
   today's feel;
5. reserve an honest, serializable analysis boundary for a future Web Worker,
   without claiming that concurrent search is implemented now.

The fresh-board 400 ms AI delay in `reset()` is a separate setup/UX delay. It
may remain, but it must be abortable and must never run while the game is paused
behind the setup screen. Both per-turn 320 ms delays are removed.

## Required invariants

The final implementation must satisfy all of these. Once a phase introduces
an invariant, every later phase must preserve it:

1. **Truthful view completion.** `GameView.showMoveMade()` resolves only after
   every frame, CSS transition/animation, landing tail, and non-aborted cleanup
   belonging to that move has finished.
2. **Browser motion is authoritative.** Motion promises resolve from the
   browser's animation/transition lifecycle, not from a second guessed timer.
   If an element has no active animation, the promise resolves immediately.
3. **One controller operation owns the turn boundary.** A human hop owns the
   lock through its complete animation and synchronization; an AI turn owns it
   through delay, analysis, authoritative driver commit, and every replayed
   model hop.
4. **AI commit is a one-way boundary.** Pause/abort may discard analysis before
   the authoritative driver is advanced. After commit, pause must let every
   model hop drain. Only reset/new-game may invalidate the replay, because they
   rebuild both representations together.
5. **Generation and lock ownership are separate.** Generation invalidates stale
   continuations; identity-owned tokens prevent an old `finally` block from
   clearing a newer operation.
6. **The next turn is neither displayed nor interactive early.** The binder
   defers post-move status/hints, and the controller blocks `selectPiece`,
   `attemptMove`, and `deselect` while an operation or pause is active.
7. **Listener failures do not strand the game.** Synchronous throws and rejected
   listener promises are logged; the emitter and controller operation settle.
8. **An aborted stale view run performs no late global DOM writes.** Lifecycle
   generation protects lifecycle state, not the DOM. Once run A is aborted and
   run B starts, A must not clear B's layer or render A's board.

Work remains split into independently testable, independently committable
phases. `npm test` must pass after every phase.

---

## Phase 1 — Make the current view promise mean real visual completion

This phase deliberately keeps the current mostly-concurrent visual behavior.
It first makes the public promise truthful so the controller can safely use it
as a barrier in Phase 2.

### 1.1 Replace motion-duration waits with browser completion

In `view/html/surfaces/HtmlMotionSurface.mjs`, replace
`abortableTimeout(...)` as the definition of visual completion with two small
helpers:

- an abort-aware `nextAnimationFrame(signal)` used twice by the slide;
- an abort-aware `waitForElementMotion(element, signal, { subtree })` that
  obtains the element's current animations with `element.getAnimations(...)`
  and awaits every `Animation.finished` promise with `Promise.allSettled`.

The helper requirements are:

- an already-aborted signal resolves immediately;
- abort listeners and queued animation-frame callbacks are removed/cancelled;
- `Animation.finished` rejection caused by cancellation is treated as settled;
- no active animations means immediate completion;
- cleanup runs exactly once;
- there is no timer fallback used to advance the game.

`slidePiece` must include its two-frame startup in its returned promise:

```js
slidePiece: async ({ from, to, piece }, signal) => {
  const slide = createPieceElement(piece);
  // Set initial position, append, and expose the initial style to layout.
  // ...existing class/style construction...
  animLayer.append(slide);

  if (!(await nextAnimationFrame(signal))) return;
  if (!(await nextAnimationFrame(signal))) return;

  slide.style.top = `${to.r * SQUARE_PERCENT}%`;
  slide.style.left = `${to.c * SQUARE_PERCENT}%`;
  await waitForElementMotion(slide, signal);
},
```

Calling `getAnimations()` after the target styles are assigned forces the
browser to expose the actual CSS transition. The returned promise therefore
includes roughly two frames of startup _plus_ the transition itself; it no
longer resolves a transition-duration interval after method entry.

Apply the same contract to every effect:

- `showMoveRipple` waits for the ripple child's CSS animation (using
  `getAnimations({ subtree: true })` on its wrapper) and removes the wrapper
  on completion/abort;
- `showPieceLanding(position, signal)` adds the landing class, waits for its
  CSS animation, removes the class, and returns a promise;
- `fadeCapturedPiece(position, signal)` drops its internal slide-duration
  pre-wait and synthetic overlay, fades the normally rendered victim when
  `GameView` invokes it after `slideDone`, and waits for its
  opacity/transform transitions;
- every primitive responds to the same animation `AbortSignal`.

Abort cleanup for DOM-owned state is synchronous with `abort()`: ripple removes
its wrapper, landing removes its class, queued frames are cancelled, and
capture fade removes its inline `transition`, `opacity`, and `transform`
properties before the abort listener resolves the effect promise. This is
required even when a replacement render has the same board signature and the
board-surface cache would otherwise reuse the element.

The numeric `rippleDurationMs`, `slideDurationMs`,
`landAnimationDurationMs`, and `captureVictimFadeDelayMs` fields stop being
synchronization inputs and are removed from `motionClassMap.mjs`. Durations
remain only where they visually belong: CSS keyframes or transition strings.

Remove `captureVictimWrapper` from `motionClassMap.mjs`; Phase 1 no longer
creates a captured-piece overlay.

### 1.2 Make landing and capture fade use awaitable semantic APIs

In `view/components/board/BoardMoveAnimationView.mjs`:

```js
showPieceLanding: (position, signal) => surface.showPieceLanding(position, signal),
showCapturedPieceFading: (position, signal) =>
  surface.fadeCapturedPiece(position, signal),
```

Both methods now return `Promise<void>`. Update
`docs/view_class_diagram.md` in this phase so `BoardMoveAnimationView` and
`HtmlMotionSurface` show the new landing and capture-fade signatures, and so
its binder prose records that post-move status is deferred.

### 1.3 Enclose the current concurrent animation's complete tail

Keep the existing visual ordering for this phase, but change
`view/GameView.mjs` so:

- ripple and slide begin together as today;
- capture fade is chained from the _actual_ slide promise rather than an
  internal slide-duration timeout;
- the destination board is rendered with next-turn selection/hints cleared;
- landing is awaited;
- only after landing does the complete settled board (including next-turn
  hints) render;
- `markSettling()` moves after all visual motion;
- a non-aborted error restores the settled board before propagating;
- an aborted run performs no late global layer clear or board render.

Representative structure:

```js
const withoutTurnHints = (board) => ({
  ...board,
  selectedPosition: null,
  mandatoryCapturePosition: null,
  moveablePositions: [],
  targetSquares: [],
  captureTargets: [],
});

const runMoveAnimation = async (moveDisplay, settledViewState, signal, markSettling) => {
  const { from, to, piece, victimPosition, victimDisplay } = moveDisplay;
  const animationBoard = withoutTurnHints(settledViewState.board);
  const victimEntry = victimPosition ? [{ position: victimPosition, ...victimDisplay }] : [];
  const inFlightBoard = {
    ...animationBoard,
    pieces: settledViewState.board.pieces
      .filter((p) => !(p.position.r === to.r && p.position.c === to.c))
      .concat(victimEntry),
  };

  try {
    applyBoardState(inFlightBoard);
    const rippleDone = animationView.showMoveRipple(from, signal);
    const slideDone = animationView.showPieceMoving({ from, to, piece }, signal);
    const effects = [rippleDone, slideDone];
    if (victimPosition) {
      effects.push(
        slideDone.then(() => {
          if (signal.aborted) return;
          return animationView.showCapturedPieceFading(victimPosition, signal);
        }),
      );
    }

    const settledEffects = await Promise.allSettled(effects);
    const failure = settledEffects.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
    if (signal.aborted) return;

    animationView.clearAnimationLayer();
    applyBoardState({ ...animationBoard, pieces: settledViewState.board.pieces });
    await animationView.showPieceLanding(to, signal);
    if (signal.aborted) return;

    markSettling();
  } finally {
    if (!signal.aborted) {
      try {
        animationView.clearAnimationLayer();
      } finally {
        applyBoardState(settledViewState.board);
      }
    }
  }
};
```

The `!signal.aborted` condition is load-bearing: `stopAnimation()` performs
cancellation cleanup synchronously. A stale aborted continuation must only
return, otherwise it can erase a newer animation.

### 1.4 Defer post-move status and hints in the binder

`view/GameViewBinder.mjs#handleMoveMade` must stop rendering the post-move
status before the animation. Give the binder its own render-generation guard;
controller generation protects controller state, but it cannot stop a stale
view handler from refreshing status over a newer move:

```js
let moveRenderGeneration = 0;

const invalidateMoveRender = () => {
  moveRenderGeneration += 1;
  gameView.stopAnimation();
};

const handleMoveMade = async (evt) => {
  const move = evt.data?.move;
  if (!move) return;

  // An earlier listener may have synchronously reset/replaced controller.state.
  // Do not let that stale event cancel the replacement animation.
  if (evt.state !== controller.state) return;

  const myRenderGeneration = ++moveRenderGeneration;
  gameView.stopAnimation();
  const moveDisplay = stateFactory.createMoveDisplay(controller, move);
  const settledViewState = currentViewState();

  try {
    await gameView.showMoveMade(moveDisplay, settledViewState);
  } finally {
    if (moveRenderGeneration === myRenderGeneration) {
      // Re-read here: same-generation config/state may have changed.
      gameView.refresh(currentViewState());
    }
  }
};
```

Delete the immediate `gameView.refreshStatus(settledViewState.status)` call.
The direct `stateChanged` handler (reset/new-game/config update) calls
`invalidateMoveRender()` before rendering its replacement state, and
`markGameStopped()` invalidates before showing setup. Starting move B likewise
increments the generation before aborting move A. Consequently A's late
`finally` cannot reveal B's status or clear B's animation.

An interior `multiCapture` may still announce continuation by the same player;
the next player's turn/status is not shown until the final move animation
settles.

### 1.5 Verification for this phase

- Update `tests/view/game-view.test.mjs` so landing has its own controllable
  promise. Resolve ripple/slide/fade while leaving landing pending and assert:
  - `showMoveMade()` is still pending;
  - `isAnimating()` remains true;
  - `refresh`/`refreshBoard` remain guarded;
  - next-turn hints have not rendered.
- Resolve landing and assert the settled board/hints render only then.
- Reject each current effect in turn and assert the layer is cleared, the
  settled board is restored, and the rejection remains observable.
- Abort while either animation frame or landing is pending; assert no queued
  callback later mutates the DOM or board.
- Add `tests/view/game-view-binder.test.mjs` proving post-move status is deferred until
  `showMoveMade()` resolves and that the binder's final refresh still runs if
  the view promise rejects.
- In the same binder test, cover stale move event after synchronous reset and
  cancel-A/start-B/late-A completion; A must neither cancel B nor render B's
  next-turn status early.
- `npm test`.

Phase 1 establishes the barrier contract but does not yet remove the
controller's 320 ms pacing. That happens in Phase 2.

---

## Phase 2 — Controller-wide turn synchronization and safe pause/reset

Phase 2 is the behavior fix. Once complete, both AI and human next-turn
transitions wait for Phase 1's full view promise, without per-move timers.

### 2.1 Make `emit` awaitable and genuinely never-rejecting

Listener invocation stays synchronous and ordered (type listeners first,
`stateChanged` listeners second), but each invocation gets its own
`try`/`catch` before `Promise.allSettled`:

```js
const invokeListener = (listener, event) => {
  try {
    return Promise.resolve(listener(event));
  } catch (error) {
    return Promise.reject(error);
  }
};

const emit = async (type, data, eventState = state) => {
  const event = { type, state: eventState, data };
  const pending = [];

  for (const listener of [...(listeners.get(type) ?? [])]) {
    pending.push(invokeListener(listener, event));
  }
  if (type !== 'stateChanged') {
    for (const listener of [...(listeners.get('stateChanged') ?? [])]) {
      pending.push(invokeListener(listener, event));
    }
  }

  const settled = await Promise.allSettled(pending);
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error(`GameController: '${type}' listener failed`, result.reason);
    }
  }
};
```

The explicit `try`/`catch` prevents a synchronous throw from skipping later
listeners or rejecting `emit`. Non-barrier call sites use `void emit(...)`;
turn sequencing call sites use `await emit(...)`.

### 2.2 Replace `isHopInFlight` with an owned operation token

A human-only boolean is insufficient. Use one controller-wide operation token:

```js
let generation = 0;
let isPaused = false;
let activeOperation = null; // { kind, generation, done, resolveDone }

const beginOperation = (kind) => {
  if (activeOperation) return null;
  const { promise: done, resolve: resolveDone } = Promise.withResolvers();
  const token = { kind, generation, done, resolveDone };
  activeOperation = token;
  return token;
};

const ownsOperation = (token) => activeOperation === token && generation === token.generation;

const finishOperation = (token) => {
  if (activeOperation === token) activeOperation = null;
  token.resolveDone();
};

const invalidateOperation = () => {
  const stale = activeOperation;
  activeOperation = null;
  stale?.resolveDone();
};

const waitForQuiescence = async () => {
  while (activeOperation) await activeOperation.done;
};
```

`finishOperation` clears only the token it owns. Reset may invalidate an old
token and start a new operation before the old continuation unwinds; the old
`finally` cannot clear the new token.

Derive `isAIProcessing` from `activeOperation?.kind === 'ai-turn'` instead of
maintaining a separately clobberable boolean. Block all human entry points:

```js
const humanInputBlocked = () =>
  isPaused || activeOperation !== null || state.currentPlayerIsAI || state.status !== 'playing';
```

`selectPiece`, `attemptMove`, and `deselect` all check this guard. Internal
controller state changes do not call those guarded public methods.

### 2.3 Snapshot a hop before its first await and guard every continuation

`applyHop(move, token)` computes the complete hop outcome from local immutable
states before emitting anything:

```js
const applyHop = async (move, token) => {
  const oldState = state;
  const nextState = oldState.applyMove(move);
  const promoted =
    Math.abs(oldState.board[move.fromR][move.fromC]) === 1 &&
    Math.abs(nextState.board[move.toR][move.toC]) === 2;
  const lockedPiece = nextState.mustMovePiece ? { ...nextState.mustMovePiece } : null;
  const turnComplete = lockedPiece === null;

  state = nextState;
  selectedPiece = lockedPiece;

  if (promoted) {
    await emit('promotion', { at: { r: move.toR, c: move.toC } }, nextState);
    if (!ownsOperation(token)) return { stale: true };
  }
  if (lockedPiece) {
    await emit('multiCapture', { lockedPiece }, nextState);
    if (!ownsOperation(token)) return { stale: true };
  }

  await emit('moveMade', { move, wasCapture: move.isCapture }, nextState);
  if (!ownsOperation(token)) return { stale: true };
  return { stale: false, turnComplete };
};
```

A reset from a promotion or multi-capture listener therefore prevents the
stale `moveMade` emission. A reset during `moveMade` prevents all caller work
after the barrier.

### 2.4 Human-hop ownership and next-turn gating

For a valid human move, acquire a `human-hop` token synchronously, append the
turn accumulators, then await `applyHop`.

- An interior capture releases the token only after that hop's full animation;
  the required continuation click is accepted afterward.
- A completed turn synchronizes the driver and clears the accumulators before
  releasing the token.
- A game-ending move awaits `gameOver` after `moveMade`; the game-over binder
  wait becomes a defensive no-op in the normal path.
- The token is released in an identity-safe `finally`.
- Only after release may `maybeStartNextAiTurn()` acquire an `ai-turn` token.
- `maybeStartNextAiTurn()` checks `isPaused` and uses no move-pacing delay.

The controller lock blocks the next human as well as the next AI. Combined with
Phase 1's deferred binder refresh, the next turn is neither interactive nor
visible early.

### 2.5 `AiMoveChannel` is a non-mutating serialized analysis boundary

Add `controller/AiMoveChannel.mjs`, but do not pass the live driver through a
future-Worker-shaped API. The channel receives a structured-clone-safe session,
runs analysis on a scratch driver, and returns a choice DTO:

```js
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';

export const requestAiMove = async ({ session, depth, signal }) => {
  if (signal?.aborted) return { played: false, aborted: true };

  const scratch = new GameDriver(session);
  const result = scratch.playAiMove(depth);

  if (signal?.aborted) return { played: false, aborted: true };
  if (!result.played) return { played: false };

  return {
    played: true,
    matchIndex: result.matchIndex,
    moveKey: moveKey(result.move),
    score: result.score,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
};
```

`signal` controls the local request and is not part of a Worker message. A
future channel implementation maps it to a request ID/cancel message. Today's
synchronous analysis cannot be interrupted after it enters the analyzer, and
normal UI work cannot abort between `scratch.playAiMove()` and the immediately
following signal check in the same task. The second check documents the async
channel contract for a future Worker; today's directly testable channel
cancellation case is pre-abort. Analysis still mutates only the scratch driver,
so the authoritative driver remains safe.

In `GameController`:

1. capture `requestDriver = driver`, `requestGeneration`, and
   `session = requestDriver.toJSON()`;
2. await `requestAiMove({ session, depth, signal })`;
3. before commit, require: token still owned, same generation, same driver
   object, not paused, not aborted;
4. retrieve `requestDriver.getMoves()[matchIndex]` and validate its `moveKey`;
5. capture that authoritative move, then call
   `requestDriver.playMoveIndex(matchIndex)` exactly once.

Only step 5 is the authoritative AI commit.

This phase does **not** overlap AI search with the human animation. A future
Worker can replace the channel's local transport while retaining the DTO
interface, but concurrency also needs a later controller change: synchronize
the completed human turn to `driver`, start the snapshot request before the
final hop's first awaited event (`promotion` or `moveMade`), keep AI-thinking
UI hidden until the animation settles, then validate/commit or discard the
result. The channel body alone cannot move its own invocation earlier.

### 2.6 AI replay is non-cancellable after authoritative commit

An `ai-turn` token spans the optional reset delay, analysis, commit, and every
model hop. Before commit, pause/abort may return without changing the
authoritative driver. After `playMoveIndex`:

- `await emit('aiMoved', ...)`, then return immediately unless the token is
  still owned;
- before every call into `applyHop`, recheck token ownership, then replay that
  hop with `await applyHop(hop, token)`;
- do **not** exit because `signal.aborted` or `isPaused` changed;
- only `!ownsOperation(token)` may stop replay, because reset/new-game bumped
  generation and rebuilt both model and driver;
- keep the AI token owned until the final hop animation and `gameOver` listener
  settle;
- release by identity, then start at most one following AI turn if the game is
  still playing, the next player is AI, and the controller is not paused.

Use one owned runner/loop for AI-vs-AI chaining rather than recursively
starting a second AI task while the first token is still active. The existing
per-hop `delay(320, signal)` is deleted.

### 2.7 Pause waits for a safe boundary; reset invalidates immediately

`pause()` keeps a synchronous prefix:

```js
const pause = () => {
  isPaused = true;
  cancelPendingAi(); // cancels reset delay or pre-commit analysis
};
```

It does **not** clear the active token. `waitForQuiescence()` lets the binder
wait for an already-applied human hop or a committed AI replay to finish.

Revise `markSetupExpanded` so the visible screen flags change only at the safe
boundary. Give asynchronous binder navigation its own generation, separate
from move-render generation and controller generation:

```js
let navigationGeneration = 0;

markSetupExpanded: async () => {
  const myNavigationGeneration = ++navigationGeneration;
  const nextBackupConfig = { ...controller.state.config };
  controller.pause();
  await controller.waitForQuiescence();
  if (navigationGeneration !== myNavigationGeneration) return;

  if (gameView.isAnimating()) await gameView.waitForAnimation();
  if (navigationGeneration !== myNavigationGeneration) return;

  backupConfig = nextBackupConfig;
  gameStarted = false;
  isAIThinking = false;
  gameView.showSetupScreen(currentViewState());
},
```

Delaying `gameStarted = false` prevents later hops of a committed AI capture
from building their settled view states as setup-screen states.
`markGameStarted`, `markSetupCollapsed`, `markGameStopped`, a newer setup
expansion, and a direct replacement `stateChanged` event all increment
`navigationGeneration`. Thus Restart/reset while an older expansion is waiting
cannot let that stale continuation restore an old `backupConfig`, make the new
setup cancelable, or repaint over the replacement screen.

Restart is different: `markGameStopped()` may pause, stop the view animation,
and reset immediately because reset rebuilds both engines. In `reset()` and
`startGame()`:

- increment `generation` first;
- abort pending pre-commit work;
- invalidate/resolve the old operation token;
- reset selection/accumulators;
- rebuild both model and driver;
- await/log `stateChanged` without allowing a stale continuation to schedule
  an AI turn.

`GameViewBinder.markGameStopped()` also sets `isAIThinking = false`
synchronously before it shows setup, so a later human-only game cannot inherit
the old UI input gate.

Distinguish Start from Restart in `UiIntentDispatcher`:

```js
if (intent.isStartGame()) controller.reset({ paused: false });
if (intent.isRestartGame()) controller.reset({ paused: true });
```

`reset({ paused = isPaused } = {})` sets the requested state and starts the
400 ms fresh-board AI delay only when `paused === false`. `startGame`, if kept,
is explicitly active and clears pause. `resume()` clears pause, waits/rechecks
any active operation, then starts at most one AI turn.

### 2.8 Verification for this phase

Add `tests/controller/GameControllerTurnPacing.test.mjs` and cover:

1. a synchronous throwing listener and an asynchronously rejecting listener
   are both logged; later type listeners, `stateChanged`, and the animation
   listener still run; the controller operation resolves;
2. human → AI: `aiThinking` cannot fire until controllable `moveMade` and
   landing promises resolve;
3. human → human: next-player status is not rendered and direct
   `selectPiece`/`attemptMove`/`deselect` cannot mutate state while the final
   hop animation is pending;
4. a second interior human-capture click is rejected during the first hop and
   accepted after its animation;
5. an AI multi-capture paused during hop 1 still replays hop 2, blocks input
   throughout, keeps `waitForQuiescence()` pending, ends with equivalent model
   and driver state, and does not start another AI while paused;
6. reset from each `promotion`, `multiCapture`, `moveMade`, and `aiMoved` await
   boundary emits no stale later event/replay and performs no stale driver
   sync;
7. old hop pending → reset → new hop pending → old hop resolves: the old
   `finally` cannot release the new operation lock;
8. pause during a completed human animation still synchronizes the driver and
   starts the next AI only after resume;
9. Restart with White AI starts no hidden search/move; a later explicit Start
   clears pause and starts it once;
10. setup expansion pending → Restart/reset → old expansion settles: the stale
    expansion cannot restore backup config or repaint the replacement setup;
11. listener/view rejection cannot strand the operation token.

Add `tests/controller/AiMoveChannel.test.mjs` and assert:

- input/output are structured-clone-safe DTOs;
- the authoritative driver history is unchanged by analysis;
- a pre-aborted request returns an aborted result without constructing or
  running a scratch search;
- controller validation rejects a stale index/key pair;
- a valid choice commits the authoritative driver exactly once.

Update relevant binder/intent smoke tests for deferred status,
`waitForQuiescence`, and the distinct Start/Restart reset options. Run
`npm test`.

Update README's controller tree in this phase to list `AiMoveChannel.mjs` as
the serializable, non-mutating AI analysis boundary.

At the end of Phase 2, the reported overlap and next-human transition bugs are
fixed, and AI multi-hop replay is atomic with respect to pause.

---

## Phase 3 — Rewrite the move animation as a strict sequential chain

### 3.1 `GameView.runMoveAnimation`

`settledViewState.board` already has the origin and captured squares empty.
Synthesize the origin and victim into intermediate renders, clear next-turn
hints throughout motion, and use rejection-safe cleanup:

```js
const runMoveAnimation = async (moveDisplay, settledViewState, signal) => {
  const { from, to, piece, victimPosition, victimDisplay } = moveDisplay;
  const victimEntry = victimPosition ? [{ position: victimPosition, ...victimDisplay }] : [];
  const originEntry = [{ position: from, ...piece }];
  const animationBoard = withoutTurnHints(settledViewState.board);
  const basePieces = settledViewState.board.pieces.filter(
    (p) => !(p.position.r === to.r && p.position.c === to.c),
  );
  const renderPieces = (pieces) => applyBoardState({ ...animationBoard, pieces });

  try {
    // 1. Lift: keep the real origin piece visible under the ripple.
    renderPieces(basePieces.concat(originEntry, victimEntry));
    await animationView.showMoveRipple(from, signal);
    if (signal.aborted) return;

    // 2. Slide: remove the synthesized origin and hand off to the clone.
    renderPieces(basePieces.concat(victimEntry));
    await animationView.showPieceMoving({ from, to, piece }, signal);
    if (signal.aborted) return;

    // 3. Land: replace the clone with the real destination piece.
    animationView.clearAnimationLayer();
    renderPieces(settledViewState.board.pieces.concat(victimEntry));
    await animationView.showPieceLanding(to, signal);
    if (signal.aborted) return;

    // 4. Fade-captured: the victim remains real through landing.
    if (victimPosition) {
      await animationView.showCapturedPieceFading(victimPosition, signal);
      if (signal.aborted) return;
    }
  } finally {
    if (!signal.aborted) {
      try {
        animationView.clearAnimationLayer();
      } finally {
        applyBoardState(settledViewState.board);
      }
    }
  }
};
```

On a non-aborted failure, the original failure propagates so the controller
emitter can report it, but the board is restored first. On abort, this run
performs no global cleanup; `stopAnimation()` and the replacement/current
render own that work.

### 3.2 Reuse Phase 1's real-victim fade after landing

Phase 1 already changed `fadeCapturedPiece(position, signal)` to operate on the
normally rendered victim and to synchronously remove its inline styles on
abort. Phase 3 changes only its position in the orchestration: the strict
caller invokes it after landing rather than after slide. A successful final
settled render removes the now-transparent victim.

### 3.3 Binder and documentation consistency

Update the `gameOver` comment in `GameViewBinder.mjs`: because the controller
awaits `moveMade`, its animation wait is now a defensive safety net rather than
the normal sequencing mechanism.

Update `docs/view_class_diagram.md` prose to describe the strict four-stage
sequence. The landing/fade signatures and deferred binder status were already
updated in Phase 1.

### 3.4 Verification for this phase

Rewrite the fake animation view in `tests/view/game-view.test.mjs` so each stage
is independently resolvable. Assert exact render/call order:

1. origin + victim during lift;
2. victim only during slide;
3. destination + victim during land;
4. victim remains until fade finishes;
5. only the settled board/hints remain afterward.

Also assert:

- refresh guards remain active through all four stages;
- rejection at each stage restores the settled board, clears the layer, clears
  lifecycle state, skips later stages, and remains observable;
- abort at each stage performs no stale settled render;
- after cancel A/start B, a late A completion neither clears B's layer nor
  overwrites B's board.

Run `npm test`.

---

## Phase 4 — Collapse the view animation lifecycle to one phase

After Phases 1–3, every asynchronous DOM tail is inside the one
`showMoveMade()` promise and every primitive uses the same abort signal. The
two-phase `in-flight`/`settling` distinction is no longer useful.

### 4.1 `GameViewAnimationLifecycle.mjs`

Collapse the record to `{ generation, abortController, donePromise }` and
expose only `isAnimating`, `waitForAnimation`, `beginAnimation`, and
`cancelAnimation`:

```js
export const createGameViewAnimationLifecycle = () => {
  let generation = 0;
  let current = null;

  const isCurrent = (myGeneration) => current !== null && current.generation === myGeneration;
  const isAnimating = () => current !== null;
  const waitForAnimation = () =>
    current ? current.donePromise.catch(() => {}) : Promise.resolve();

  const beginAnimation = (run) => {
    generation += 1;
    const myGeneration = generation;
    const abortController = new AbortController();
    const entry = {
      generation: myGeneration,
      abortController,
      donePromise: null,
    };
    current = entry;

    const donePromise = (async () => {
      try {
        return await run(abortController.signal);
      } finally {
        if (isCurrent(myGeneration)) current = null;
      }
    })();

    entry.donePromise = donePromise;
    return donePromise;
  };

  const cancelAnimation = () => {
    if (current) current.abortController.abort();
    current = null;
  };

  return { isAnimating, waitForAnimation, beginAnimation, cancelAnimation };
};
```

Generation only prevents stale lifecycle-state cleanup. The Phase 1/3 rule
that aborted runs perform no late global DOM writes remains independently
required.

### 4.2 `GameView.mjs` and docs

- `refresh`/`refreshBoard` guard on `!isAnimating()` for the entire promise;
- remove `markSettling` from `showMoveMade`/`runMoveAnimation`;
- update the lifecycle top comments;
- update `docs/view_class_diagram.md` to remove `phase`, `isInFlight`, and
  `markSettling` descriptions;
- update README's lifecycle entry to “Tracks active move animation
  (begin/wait/cancel)”;
- retain the `AiMoveChannel.mjs` controller-tree entry added in Phase 2.

The archived plan remains a historical record and is not edited.

### 4.3 Verification for this phase

- Update `tests/view/game-view-animation-lifecycle.test.mjs` to assert the
  single `isAnimating()` state, cancellation, never-rejecting wait, and
  generation ownership.
- In `tests/view/game-view.test.mjs`, retain the cancel-A/start-B late-settle
  case and assert both lifecycle state and DOM/render calls still belong to B.
- `npm test`.

---

## Phase 5 — Tune CSS durations for the sequential sequence

Completion is browser-driven, so these values affect visual feel only; they do
not decide when the controller may advance.

### 5.1 CSS/transition values

Use:

```text
ripple animation: 130ms       (was 300ms CSS / 350ms JS wait)
slide transition: 220ms       (was 280ms)
landing animation: 150ms      (was 250ms)
capture fade transition: 120ms (was 150ms)
```

Update:

- `view/css/game.css` for ripple and landing keyframes;
- `view/html/styles/motionClassMap.mjs` for slide and fade transition strings.

There are no parallel JS duration constants to synchronize. Approximate
visible totals are about 130 + two animation frames + 220 + 150 ≈ 530 ms for a
walk and another 120 ms for a capture. Browser completion, not this arithmetic,
is the actual barrier.

### 5.2 Verification for this phase

- `npm test` (tests do not assert literal visual durations);
- manual browser feel check in Phase 6.

---

## Phase 6 — Full regression pass

- `npm test` — every suite green.
- `npm run lint` — no new lint violations.
- Manual browser smoke test with a static server and Playwright:
  - non-capture: lift → slide → land, with status changing only afterward;
  - capture: victim remains through lift/slide/land and fades last;
  - human → AI: “AI is thinking” appears only after landing/fade completes;
  - human → human: the next player cannot preselect and is not displayed
    before completion;
  - AI multi-capture: every hop finishes before the next begins;
  - expand setup during AI hop 1: committed replay drains, setup appears only
    at quiescence, and model/driver remain equivalent;
  - restart with White AI: no hidden AI move occurs behind setup;
  - cancel/restart mid-lift, slide, land, and fade: no stale layer, inline
    style, board render, or status remains;
  - no console errors.

---

## Implementation order

1. Phase 1 — truthful browser-driven view promise and deferred binder status;
   `npm test` green.
2. Phase 2 — awaitable controller events, operation ownership, atomic AI
   replay, safe pause/reset, and serialized AI analysis boundary; `npm test`
   green. This fixes the reported turn-overlap bug.
3. Phase 3 — strict lift → slide → land → fade chain with rejection-safe
   cleanup; `npm test` green.
4. Phase 4 — collapse the lifecycle to one phase and update lifecycle docs;
   `npm test` green.
5. Phase 5 — CSS-only duration tuning; `npm test` green.
6. Phase 6 — full automated and browser regression pass.

## Files touched by phase

- **Phase 1:**
  - `view/GameView.mjs`
  - `view/GameViewBinder.mjs`
  - `view/html/surfaces/HtmlMotionSurface.mjs`
  - `view/html/styles/motionClassMap.mjs`
  - `view/components/board/BoardMoveAnimationView.mjs`
  - `docs/view_class_diagram.md`
  - `tests/view/game-view.test.mjs`
  - `tests/view/game-view-binder.test.mjs` (new)
  - binder/view smoke tests as needed
- **Phase 2:**
  - `controller/GameController.mjs`
  - `controller/AiMoveChannel.mjs` (new)
  - `view/GameViewBinder.mjs`
  - `view/intent/UiIntentDispatcher.mjs`
  - `README.md`
  - `tests/controller/GameControllerTurnPacing.test.mjs` (new)
  - `tests/controller/AiMoveChannel.test.mjs` (new)
  - relevant controller-driver, binder, and intent smoke tests
- **Phase 3:**
  - `view/GameView.mjs`
  - `view/GameViewBinder.mjs` (comment)
  - `docs/view_class_diagram.md`
  - `tests/view/game-view.test.mjs`
- **Phase 4:**
  - `view/GameViewAnimationLifecycle.mjs`
  - `view/GameView.mjs`
  - `docs/view_class_diagram.md`
  - `README.md`
  - `tests/view/game-view-animation-lifecycle.test.mjs`
  - `tests/view/game-view.test.mjs`
- **Phase 5:**
  - `view/css/game.css`
  - `view/html/styles/motionClassMap.mjs`

This ordering keeps every intermediate commit executable and tested while
making the synchronization boundary explicit: the browser owns motion
completion, the view owns the complete move promise, and the controller owns
turn progression.
