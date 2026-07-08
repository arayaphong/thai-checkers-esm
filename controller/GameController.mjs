import { createGameState } from '../model/GameState.mjs';
import { RandomAI } from '../ai/RandomAI.mjs';
import { GreedyAI } from '../ai/GreedyAI.mjs';
import { MinimaxAI } from '../ai/MinimaxAI.mjs';

// ============================================
// GameController - Orchestrates Model + AI + View
// Single source of truth for game flow
// Emits events for View to react to
//
// reset()/startGame() fully discard the current state, but a prior
// executeMove()'s AI turn (delay -> aiThinking -> ai.makeMove() ->
// aiMoved -> executeMove()) can still be in flight when that happens.
// pendingAiAbort lets reset()/startGame() cancel that stale chain so
// it never calls executeMove() with a move computed against state
// that no longer exists -- the same stale-async-effect shape fixed for
// view/'s animations, applied here to the AI turn sequence.
// ============================================

const delay = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  return promise;
};

export const createGameController = (config) => {
  let state = createGameState(config ? { config } : undefined);
  let selectedPiece = null;
  let isAIProcessing = false;
  let pendingAiAbort = null;
  const listeners = new Map();
  const aiInstances = new Map([
    ['random', new RandomAI()],
    ['greedy', new GreedyAI()],
    ['minimax', new MinimaxAI()],
  ]);

  const emit = (type, data) => {
    const event = { type, state, data };
    (listeners.get(type) ?? []).forEach((l) => l(event));
    // Also emit to wildcard listeners via 'stateChanged'
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

  /** Let AI make a move */
  const triggerAI = async (signal) => {
    isAIProcessing = true;
    emit('aiThinking', { player: state.turn });

    // Select AI strategy based on config difficulty
    const diffMap = {
      easy: 'random',
      medium: 'greedy',
      hard: 'minimax',
    };
    const aiName = diffMap[state.config.aiDifficulty] ?? 'greedy';
    const ai = aiInstances.get(aiName);

    if (!ai) {
      isAIProcessing = false;
      return;
    }

    try {
      const move = await ai.makeMove(state);
      if (signal.aborted) return;
      isAIProcessing = false;
      emit('aiMoved', { move, aiName: ai.name });
      await executeMove(move);
    } catch (err) {
      if (signal.aborted) return;
      isAIProcessing = false;
      console.error('AI error:', err);
    }
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

    await triggerAI(signal);
  };

  /** Execute a move and trigger AI if needed */
  const executeMove = async (move) => {
    const wasCapture = move.isCapture;
    const oldState = state;
    state = state.applyMove(move);

    // Check for promotion
    const oldPiece = oldState.board[move.fromR][move.fromC];
    const newPiece = state.board[move.toR][move.toC];
    if (Math.abs(oldPiece) === 1 && Math.abs(newPiece) === 2) {
      emit('promotion', { at: { r: move.toR, c: move.toC } });
    }

    if (state.mustMovePiece) {
      // Multi-capture: keep piece selected
      selectedPiece = state.mustMovePiece;
      emit('multiCapture', { lockedPiece: state.mustMovePiece });
    } else {
      selectedPiece = null;
    }

    emit('moveMade', { move, wasCapture });

    if (state.status !== 'playing') {
      emit('gameOver', { winner: state.status });
      return;
    }

    // Trigger AI if next player is AI. Delay to let the piece slide
    // animation finish (320ms) before AI starts thinking.
    if (state.currentPlayerIsAI) {
      await startAiTurn(320);
    }
  };

  /** Attempt a move (human input) */
  const attemptMove = async (pos) => {
    if (isAIProcessing) return false;

    // Check if clicking on a valid destination for selected piece
    if (selectedPiece) {
      const move = state.validMoves.find(
        (m) => m.fromR === selectedPiece.r && m.fromC === selectedPiece.c &&
               m.toR === pos.r && m.toC === pos.c
      );
      if (move) {
        await executeMove(move);
        return true;
      }
    }

    // Try to select the piece at this position instead
    return selectPiece(pos);
  };

  /** Reset the game */
  const reset = async () => {
    cancelPendingAi();
    selectedPiece = null;
    isAIProcessing = false;
    state = state.reset();
    emit('stateChanged', { action: 'reset' });

    // Trigger AI if white is AI (delay for board to render)
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
    state = createGameState({ config: newConfig });
    emit('stateChanged', { action: 'newGame' });

    if (state.currentPlayerIsAI) {
      startAiTurn(0);
    }
  };

  return {
    // ---- State Access ----
    get state() { return state; },
    get selectedPiece() { return selectedPiece; },
    get isAIProcessing() { return isAIProcessing; },

    // ---- Event System ----
    on,
    off,

    // ---- AI Management ----
    get availableAIs() { return [...aiInstances.keys()]; },
    /** Get AI instance by name */
    getAI: (name) => aiInstances.get(name),
    /** Register a custom AI */
    registerAI: (ai) => aiInstances.set(ai.name, ai),

    // ---- Game Actions ----
    selectPiece,
    deselect,
    attemptMove,
    reset,
    updateConfig,
    startGame,
  };
};
