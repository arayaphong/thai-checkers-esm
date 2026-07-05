import { GameState } from '../model/GameState.mjs';
import { RandomAI } from '../ai/RandomAI.mjs';
import { GreedyAI } from '../ai/GreedyAI.mjs';
import { MinimaxAI } from '../ai/MinimaxAI.mjs';

// ============================================
// GameController - Orchestrates Model + AI + View
// Single source of truth for game flow
// Emits events for View to react to
// ============================================

export class GameController {
  #state;
  #listeners = new Map();
  #selectedPiece = null;
  #aiInstances = new Map();
  #isAIProcessing = false;

  constructor(config) {
    this.#state = new GameState(config ? { config } : undefined);
    this.#setupAI();
  }

  // ---- State Access ----

  get state() { return this.#state; }
  get selectedPiece() { return this.#selectedPiece; }
  get isAIProcessing() { return this.#isAIProcessing; }

  // ---- Event System ----

  on(event, listener) {
    if (!this.#listeners.has(event)) this.#listeners.set(event, []);
    this.#listeners.get(event).push(listener);
    return () => this.off(event, listener);
  }

  off(event, listener) {
    const list = this.#listeners.get(event);
    if (list) {
      this.#listeners.set(event, list.filter(l => l !== listener));
    }
  }

  #emit(type, data) {
    const event = { type, state: this.#state, data };
    (this.#listeners.get(type) ?? []).forEach(l => l(event));
    // Also emit to wildcard listeners via 'stateChanged'
    if (type !== 'stateChanged') {
      (this.#listeners.get('stateChanged') ?? []).forEach(l => l(event));
    }
  }

  // ---- AI Management ----

  #setupAI() {
    this.#aiInstances.set('random', new RandomAI());
    this.#aiInstances.set('greedy', new GreedyAI());
    this.#aiInstances.set('minimax', new MinimaxAI());
  }

  get availableAIs() {
    return Array.from(this.#aiInstances.keys());
  }

  /** Get AI instance by name */
  getAI(name) {
    return this.#aiInstances.get(name);
  }

  /** Register a custom AI */
  registerAI(ai) {
    this.#aiInstances.set(ai.name, ai);
  }

  // ---- Game Actions ----

  /** Select a piece (human input) */
  selectPiece(pos) {
    if (!this.#state.canSelectPiece(pos)) {
      if (!this.#state.mustMovePiece) {
        this.#selectedPiece = null;
        this.#emit('pieceSelected', { selected: null });
      }
      return false;
    }
    this.#selectedPiece = pos;
    this.#emit('pieceSelected', { selected: pos, moves: this.#state.getMovesForPiece(pos) });
    return true;
  }

  /** Deselect current piece */
  deselect() {
    if (!this.#state.mustMovePiece) {
      this.#selectedPiece = null;
      this.#emit('pieceSelected', { selected: null });
    }
  }

  /** Attempt a move (human input) */
  async attemptMove(pos) {
    if (this.#isAIProcessing) return false;

    // Check if clicking on a valid destination for selected piece
    if (this.#selectedPiece) {
      const move = this.#state.validMoves.find(
        m => m.fromR === this.#selectedPiece.r && m.fromC === this.#selectedPiece.c &&
             m.toR === pos.r && m.toC === pos.c
      );
      if (move) {
        await this.#executeMove(move);
        return true;
      }
    }

    // Try to select the piece at this position instead
    return this.selectPiece(pos);
  }

  /** Execute a move and trigger AI if needed */
  async #executeMove(move) {
    const wasCapture = move.isCapture;
    const oldState = this.#state;
    this.#state = this.#state.applyMove(move);

    // Check for promotion
    const oldPiece = oldState.board[move.fromR][move.fromC];
    const newPiece = this.#state.board[move.toR][move.toC];
    if (Math.abs(oldPiece) === 1 && Math.abs(newPiece) === 2) {
      this.#emit('promotion', { at: { r: move.toR, c: move.toC } });
    }

    if (this.#state.mustMovePiece) {
      // Multi-capture: keep piece selected
      this.#selectedPiece = this.#state.mustMovePiece;
      this.#emit('multiCapture', { lockedPiece: this.#state.mustMovePiece });
    } else {
      this.#selectedPiece = null;
    }

    this.#emit('moveMade', { move, wasCapture });

    if (this.#state.status !== 'playing') {
      this.#emit('gameOver', { winner: this.#state.status });
      return;
    }

    // Trigger AI if next player is AI
    // Delay to let the piece slide animation finish (320ms) before AI starts thinking
    if (this.#state.currentPlayerIsAI) {
      await this.#delay(320);
      await this.#triggerAI();
    }
  }

  /** Small delay helper */
  #delay(ms) {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(resolve, ms);
    return promise;
  }

  /** Let AI make a move */
  async #triggerAI() {
    this.#isAIProcessing = true;
    this.#emit('aiThinking', { player: this.#state.turn });

    // Select AI strategy based on config difficulty
    const diffMap = {
      easy: 'random',
      medium: 'greedy',
      hard: 'minimax',
    };
    const aiName = diffMap[this.#state.config.aiDifficulty] ?? 'greedy';
    const ai = this.#aiInstances.get(aiName);

    if (!ai) {
      this.#isAIProcessing = false;
      return;
    }

    try {
      const move = await ai.makeMove(this.#state);
      this.#isAIProcessing = false;
      this.#emit('aiMoved', { move, aiName: ai.name });
      await this.#executeMove(move);
    } catch (err) {
      this.#isAIProcessing = false;
      console.error('AI error:', err);
    }
  }

  /** Reset the game */
  async reset() {
    this.#selectedPiece = null;
    this.#isAIProcessing = false;
    this.#state = this.#state.reset();
    this.#emit('stateChanged', { action: 'reset' });

    // Trigger AI if white is AI (delay for board to render)
    if (this.#state.currentPlayerIsAI) {
      await this.#delay(400);
      await this.#triggerAI();
    }
  }

  /** Update config (e.g., toggle AI players) */
  updateConfig(config) {
    this.#state = this.#state.withConfig(config);
    this.#emit('stateChanged', { action: 'configUpdate' });
  }

  /** Start a new game with specific AI setup */
  startGame(config) {
    this.#selectedPiece = null;
    this.#isAIProcessing = false;
    this.#state = new GameState({ config });
    this.#emit('stateChanged', { action: 'newGame' });

    if (this.#state.currentPlayerIsAI) {
      this.#triggerAI();
    }
  }
}
