import { createGameState } from '../model/GameState.mjs';
import { moveKey } from '../cli/GameDriver.mjs';
import { requestAiMove } from './AiMoveChannel.mjs';
import {
  createStandardDriver,
  createDriverForModelBoard,
  expandDriverMoveToModelHops,
  playHumanTurnOnDriver,
  squareOfModelPos,
} from './GameDriverBridge.mjs';

// ============================================
// GameController - Orchestrates Model (view-facing state) + GameDriver
// (AI decisions, atomic per-turn) + View
//
// Two live representations of the same game are kept in lockstep:
//   - `state` (model/GameState): drives the view, per-step moves.
//   - `driver` (GameDriver over core/): decides AI turns, atomic per-turn
//     moves. Advanced either directly (AI's own turn) or by replaying an
//     already-completed human turn onto it.
//
// A single controller-wide operation token owns the turn boundary:
//   - a human hop owns the lock through its complete animation;
//   - an AI turn owns it from delay/analysis through authoritative commit
//     and every replayed model hop.
//
// Pause/abort may discard analysis before the authoritative driver is
// advanced. After commit, the model hops must drain; only reset/new-game
// may invalidate the replay, because they rebuild both representations.
// ============================================

const DIFFICULTY_DEPTH = { easy: 1, medium: 4, hard: 8 };

const delay = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers();
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      finish();
    },
    { once: true },
  );
  return promise;
};

const hasCustomBoard = (params) => !!(params && (params.board || params.turn !== undefined));

export const createGameController = (configOrParams) => {
  const initialParams = configOrParams;
  let state = hasCustomBoard(configOrParams)
    ? createGameState(configOrParams)
    : createGameState(configOrParams ? { config: configOrParams } : undefined);
  let driver = hasCustomBoard(configOrParams)
    ? createDriverForModelBoard(configOrParams.board, configOrParams.turn ?? 1)
    : createStandardDriver();

  let selectedPiece = null;
  let isPaused = false;
  let pendingAiAbort = null;
  let turnPath = [];
  let turnCaptured = [];
  const listeners = new Map();

  // Controller generation invalidates stale continuations; activeOperation
  // ownership prevents an old finally block from clearing a newer operation.
  let generation = 0;
  let activeOperation = null;

  const resetTurnAccumulator = () => {
    turnPath = [];
    turnCaptured = [];
  };

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

  const cancelPendingAi = () => {
    if (pendingAiAbort) {
      pendingAiAbort.abort();
      pendingAiAbort = null;
    }
  };

  const clearPendingAi = (abortController) => {
    if (pendingAiAbort === abortController) {
      pendingAiAbort = null;
    }
  };

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

  const humanInputBlocked = () =>
    isPaused || activeOperation !== null || state.currentPlayerIsAI || state.status !== 'playing';

  const off = (event, listener) => {
    const list = listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) {
      listeners.set(event, list.toSpliced(idx, 1));
    }
  };

  const on = (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(listener);
    return () => off(event, listener);
  };

  /** Select a piece (human input) */
  const selectPiece = (pos) => {
    if (humanInputBlocked()) return false;

    if (!state.canSelectPiece(pos)) {
      if (!state.mustMovePiece) {
        selectedPiece = null;
        void emit('pieceSelected', { selected: null });
      }
      return false;
    }
    selectedPiece = pos;
    void emit('pieceSelected', { selected: pos, moves: state.getMovesForPiece(pos) });
    return true;
  };

  /** Deselect current piece */
  const deselect = () => {
    if (humanInputBlocked()) return;

    if (!state.mustMovePiece) {
      selectedPiece = null;
      void emit('pieceSelected', { selected: null });
    }
  };

  /**
   * Apply exactly one model-shaped hop. The outcome is computed before any
   * awaited event, and every continuation checks operation ownership so a
   * reset from inside a listener cannot emit stale later events.
   */
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

  /** Replay the just-completed human turn onto `driver` so it stays in
   *  lockstep and is ready the next time either side needs an AI move. */
  const syncDriverForCompletedHumanTurn = () => {
    const fromSquare = squareOfModelPos(turnPath[0]);
    const toSquare = squareOfModelPos(turnPath[turnPath.length - 1]);
    const capturedSquares = turnCaptured.map(squareOfModelPos);
    playHumanTurnOnDriver(driver, { fromSquare, toSquare, capturedSquares });
  };

  const maybeStartNextAiTurn = async () => {
    if (!isPaused && state.status === 'playing' && state.currentPlayerIsAI) {
      await startAiTurn(0);
    }
  };

  /** Execute one hop of a human-driven turn (one click's worth). */
  const executeHumanHop = async (move) => {
    const token = beginOperation('human-hop');
    if (!token) return false;

    try {
      if (turnPath.length === 0) {
        turnPath.push({ r: move.fromR, c: move.fromC });
      }
      turnPath.push({ r: move.toR, c: move.toC });
      if (move.isCapture) {
        turnCaptured.push({ r: move.jumpedR, c: move.jumpedC });
      }

      const result = await applyHop(move, token);
      if (result.stale) return;
      if (!result.turnComplete) return;

      syncDriverForCompletedHumanTurn();
      resetTurnAccumulator();

      if (state.status !== 'playing') {
        await emit('gameOver', { winner: state.status });
        return;
      }
    } finally {
      finishOperation(token);
    }

    // Release the human-hop token before allowing the next AI turn to
    // acquire its own operation token.
    await maybeStartNextAiTurn();
  };

  /**
   * Let GameDriver decide and play one full AI turn, then replay it onto
   * `state` one hop at a time. Returns whether the next player is also AI so
   * startAiTurn() can continue in its iterative runner without recursion.
   * The authoritative driver advance happens exactly once after validation;
   * after that, only reset/new-game may stop the hop replay.
   */
  const playAiTurn = async (token, signal) => {
    const depth = DIFFICULTY_DEPTH[state.config.aiDifficulty] ?? DIFFICULTY_DEPTH.medium;

    const requestDriver = driver;
    const requestGeneration = generation;
    const session = await requestDriver.toJSON();

    // Give the view an explicit, awaited boundary at the start of every AI
    // turn. In a browser the binder uses this to render the new player's
    // legal-piece hints and let them reach a paint before synchronous AI work
    // can replace them with the move-animation board.
    await emit('turnReady', { player: state.turn });
    if (!ownsOperation(token) || isPaused || signal.aborted) return;

    await emit('aiThinking', { player: state.turn });
    if (!ownsOperation(token)) return;

    let choice;
    try {
      choice = await requestAiMove({ session, depth, signal });
    } catch (error) {
      console.error('AI error:', error);
      return;
    }

    if (
      !ownsOperation(token) ||
      generation !== requestGeneration ||
      driver !== requestDriver ||
      isPaused ||
      signal.aborted
    ) {
      return;
    }

    if (!choice.played) return;

    const moves = await requestDriver.getMoves();
    const authoritativeMove = moves[choice.matchIndex];
    if (!authoritativeMove || moveKey(authoritativeMove) !== choice.moveKey) {
      console.error('GameController: AI choice validation failed');
      return;
    }

    await requestDriver.playMoveIndex(choice.matchIndex);
    if (!ownsOperation(token)) return;

    await emit('aiMoved', {
      move: authoritativeMove,
      difficulty: state.config.aiDifficulty,
      depth,
    });
    if (!ownsOperation(token)) return;

    const hops = expandDriverMoveToModelHops(authoritativeMove);
    for (const hop of hops) {
      if (!ownsOperation(token)) return;
      const result = await applyHop(hop, token);
      if (result.stale) return;
    }

    if (state.status !== 'playing') {
      await emit('gameOver', { winner: state.status });
      return false;
    }

    return ownsOperation(token) && !isPaused && state.currentPlayerIsAI;
  };

  /** Start (and track) the delay -> consecutive AI-turn sequence. */
  const startAiTurn = async (delayMs) => {
    const token = beginOperation('ai-turn');
    if (!token) return;

    const abortController = new AbortController();
    pendingAiAbort = abortController;
    const { signal } = abortController;

    try {
      if (delayMs > 0) {
        await delay(delayMs, signal);
        if (signal.aborted || !ownsOperation(token)) return;
      }

      let shouldContinue = true;
      while (shouldContinue && ownsOperation(token)) {
        shouldContinue = await playAiTurn(token, signal);
      }
    } finally {
      // This operation may have been invalidated by reset/startGame, which can
      // install a newer AbortController before this stale continuation runs.
      // Clear only the controller owned by this operation; never abort the
      // newer AI task from an old finally block.
      clearPendingAi(abortController);
      finishOperation(token);
    }
  };

  /** Attempt a move (human input) */
  const attemptMove = async (pos) => {
    if (humanInputBlocked()) return false;

    if (selectedPiece) {
      const move = state.validMoves.find(
        (m) =>
          m.fromR === selectedPiece.r &&
          m.fromC === selectedPiece.c &&
          m.toR === pos.r &&
          m.toC === pos.c,
      );
      if (move) {
        await executeHumanHop(move);
        return true;
      }
    }

    return selectPiece(pos);
  };

  /** Reset the game */
  const reset = async ({ paused = isPaused } = {}) => {
    generation += 1;
    const myGeneration = generation;
    cancelPendingAi();
    invalidateOperation();
    selectedPiece = null;
    isPaused = paused;
    resetTurnAccumulator();
    if (hasCustomBoard(initialParams)) {
      state = createGameState({ ...initialParams, config: state.config });
      driver = createDriverForModelBoard(initialParams.board, initialParams.turn ?? 1);
    } else {
      state = state.reset();
      driver = createStandardDriver();
    }
    await emit('stateChanged', { action: 'reset' }, state);
    if (generation !== myGeneration) return;

    if (!isPaused && state.currentPlayerIsAI) {
      await startAiTurn(400);
    }
  };

  /** Update config (e.g., toggle AI players) */
  const updateConfig = (newConfig) => {
    state = state.withConfig(newConfig);
    void emit('stateChanged', { action: 'configUpdate' });
  };

  /** Start a new game with specific AI setup */
  const startGame = async (newConfig) => {
    generation += 1;
    const myGeneration = generation;
    cancelPendingAi();
    invalidateOperation();
    selectedPiece = null;
    isPaused = false;
    resetTurnAccumulator();
    state = createGameState({ config: newConfig });
    driver = createStandardDriver();
    await emit('stateChanged', { action: 'newGame' }, state);
    if (generation !== myGeneration) return;

    if (state.currentPlayerIsAI) {
      await startAiTurn(0);
    }
  };

  /** Pause active AI processing */
  const pause = () => {
    isPaused = true;
    cancelPendingAi();
  };

  /** Resume AI processing if active player is AI */
  const resume = async () => {
    cancelPendingAi();
    isPaused = false;
    await waitForQuiescence();
    if (!isPaused && state.currentPlayerIsAI && state.status === 'playing') {
      await maybeStartNextAiTurn();
    }
  };

  return {
    // ---- State Access ----
    get state() {
      return state;
    },
    get selectedPiece() {
      return selectedPiece;
    },
    get isAIProcessing() {
      return activeOperation?.kind === 'ai-turn';
    },
    get driver() {
      return driver;
    },

    // ---- Event System ----
    on,
    off,

    // ---- Game Actions ----
    selectPiece,
    deselect,
    attemptMove,
    reset,
    updateConfig,
    startGame,
    pause,
    resume,
    waitForQuiescence,
  };
};
