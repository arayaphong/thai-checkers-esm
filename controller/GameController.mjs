import { createGameState } from '../model/GameState.mjs';
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
//     already-completed human turn onto it (see
//     archived-plans/retire-ai-for-game-driver.md §1.4).
//
// reset()/startGame() fully discard and rebuild both `state` and `driver`,
// but a prior AI turn's delay -> aiThinking -> driver.playAiMove() ->
// hop replay chain can still be in flight when that happens. pendingAiAbort
// lets reset()/startGame() cancel that stale chain so it never applies hops
// computed against a driver/state pair that no longer exists.
// ============================================

const DIFFICULTY_DEPTH = { easy: 1, medium: 4, hard: 8 };

const delay = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      resolve();
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
  let isAIProcessing = false;
  let pendingAiAbort = null;
  let turnPath = [];
  let turnCaptured = [];
  const listeners = new Map();

  const resetTurnAccumulator = () => {
    turnPath = [];
    turnCaptured = [];
  };

  const emit = (type, data) => {
    const event = { type, state, data };
    (listeners.get(type) ?? []).forEach((l) => l(event));
    if (type !== 'stateChanged') {
      (listeners.get('stateChanged') ?? []).forEach((l) => l(event));
    }
  };

  const cancelPendingAi = () => {
    if (pendingAiAbort) {
      pendingAiAbort.abort();
      pendingAiAbort = null;
    }
  };

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
    if (!state.canSelectPiece(pos)) {
      if (!state.mustMovePiece) {
        selectedPiece = null;
        emit('pieceSelected', { selected: null });
      }
      return false;
    }
    selectedPiece = pos;
    emit('pieceSelected', { selected: pos, moves: state.getMovesForPiece(pos) });
    return true;
  };

  /** Deselect current piece */
  const deselect = () => {
    if (!state.mustMovePiece) {
      selectedPiece = null;
      emit('pieceSelected', { selected: null });
    }
  };

  /**
   * Apply exactly one model-shaped hop (a single walk, or a single jump of
   * a chain) to `state`, emitting the same events the old single-engine
   * executeMove() did. Shared by the human path and the AI hop-replay
   * loop. Returns whether this hop ended the turn -- callers decide what
   * to do next (sync driver, trigger next AI turn, etc.), since that
   * differs by source (see archived-plans/retire-ai-for-game-driver.md §1.4).
   */
  const applyHop = (move) => {
    const oldState = state;
    state = state.applyMove(move);

    const oldPiece = oldState.board[move.fromR][move.fromC];
    const newPiece = state.board[move.toR][move.toC];
    if (Math.abs(oldPiece) === 1 && Math.abs(newPiece) === 2) {
      emit('promotion', { at: { r: move.toR, c: move.toC } });
    }

    if (state.mustMovePiece) {
      selectedPiece = state.mustMovePiece;
      emit('multiCapture', { lockedPiece: state.mustMovePiece });
    } else {
      selectedPiece = null;
    }

    emit('moveMade', { move, wasCapture: move.isCapture });

    return { turnComplete: !state.mustMovePiece };
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
    if (state.currentPlayerIsAI) {
      await startAiTurn(320);
    }
  };

  /** Execute one hop of a human-driven turn (one click's worth). */
  const executeHumanHop = async (move) => {
    if (turnPath.length === 0) {
      turnPath.push({ r: move.fromR, c: move.fromC });
    }
    turnPath.push({ r: move.toR, c: move.toC });
    if (move.isCapture) {
      turnCaptured.push({ r: move.jumpedR, c: move.jumpedC });
    }

    const { turnComplete } = applyHop(move);
    if (!turnComplete) return;

    syncDriverForCompletedHumanTurn();
    resetTurnAccumulator();

    if (state.status !== 'playing') {
      emit('gameOver', { winner: state.status });
      return;
    }

    await maybeStartNextAiTurn();
  };

  /**
   * Let GameDriver decide and play a full AI turn (one atomic move, possibly
   * a whole multi-capture chain), then replay it onto `state` one hop at a
   * time so the existing per-hop event/animation pipeline is unchanged.
   * `driver` is already advanced by the time this returns from
   * driver.playAiMove(), so no post-loop driver sync is needed here.
   */
  const playAiTurn = async (signal) => {
    isAIProcessing = true;
    emit('aiThinking', { player: state.turn });

    const depth = DIFFICULTY_DEPTH[state.config.aiDifficulty] ?? DIFFICULTY_DEPTH.medium;

    let result;
    try {
      result = driver.playAiMove(depth);
    } catch (err) {
      isAIProcessing = false;
      console.error('AI error:', err);
      return;
    }

    if (signal.aborted) return;
    isAIProcessing = false;

    if (!result.played) return;

    emit('aiMoved', { move: result.move, difficulty: state.config.aiDifficulty, depth });

    const hops = expandDriverMoveToModelHops(result.move);
    for (let i = 0; i < hops.length; i++) {
      if (i > 0) {
        await delay(320, signal);
        if (signal.aborted) return;
      }
      applyHop(hops[i]);
    }

    if (state.status !== 'playing') {
      emit('gameOver', { winner: state.status });
      return;
    }

    await maybeStartNextAiTurn();
  };

  /** Start (and track) the delay -> AI-turn sequence following a move */
  const startAiTurn = async (delayMs) => {
    const abortController = new AbortController();
    pendingAiAbort = abortController;
    const { signal } = abortController;

    if (delayMs > 0) {
      await delay(delayMs, signal);
      if (signal.aborted) return;
    }

    await playAiTurn(signal);
  };

  /** Attempt a move (human input) */
  const attemptMove = async (pos) => {
    if (isAIProcessing) return false;

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
  const reset = async () => {
    cancelPendingAi();
    selectedPiece = null;
    isAIProcessing = false;
    resetTurnAccumulator();
    if (hasCustomBoard(initialParams)) {
      state = createGameState({ ...initialParams, config: state.config });
      driver = createDriverForModelBoard(initialParams.board, initialParams.turn ?? 1);
    } else {
      state = state.reset();
      driver = createStandardDriver();
    }
    emit('stateChanged', { action: 'reset' });

    if (state.currentPlayerIsAI) {
      await startAiTurn(400);
    }
  };

  /** Update config (e.g., toggle AI players) */
  const updateConfig = (newConfig) => {
    state = state.withConfig(newConfig);
    emit('stateChanged', { action: 'configUpdate' });
  };

  /** Start a new game with specific AI setup */
  const startGame = (newConfig) => {
    cancelPendingAi();
    selectedPiece = null;
    isAIProcessing = false;
    resetTurnAccumulator();
    state = createGameState({ config: newConfig });
    driver = createStandardDriver();
    emit('stateChanged', { action: 'newGame' });

    if (state.currentPlayerIsAI) {
      startAiTurn(0);
    }
  };

  /** Pause active AI processing */
  const pause = () => {
    cancelPendingAi();
    isAIProcessing = false;
  };

  /** Resume AI processing if active player is AI */
  const resume = async () => {
    cancelPendingAi();
    if (state.currentPlayerIsAI && state.status === 'playing') {
      await startAiTurn(0);
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
      return isAIProcessing;
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
  };
};
