import { INITIAL_BOARD, DEFAULT_CONFIG } from './Types.mjs';
import { MoveEngine } from './MoveEngine.mjs';

// ============================================
// GameState - Immutable game state container
// All updates return new GameState instance
// ============================================

export class GameState {
  constructor(params = {}) {
    this.board = structuredClone(params.board ?? INITIAL_BOARD);
    this.turn = params.turn ?? 1;
    this.mustMovePiece = params.mustMovePiece ?? null;
    this.status = params.status ?? 'playing';
    this.moveCount = params.moveCount ?? 0;
    this.config = params.config ? { ...params.config } : { ...DEFAULT_CONFIG };
    this.lastMove = params.lastMove ?? null;
    this.captureCount = params.captureCount ? { ...params.captureCount } : { white: 0, black: 0 };
  }

  /** Get all valid moves for current player */
  get validMoves() {
    if (this.status !== 'playing') return [];
    return MoveEngine.getAllValidMoves(this.board, this.turn, this.mustMovePiece);
  }

  /** Get valid moves for a specific piece */
  getMovesForPiece(pos) {
    return this.validMoves.filter(m => m.fromR === pos.r && m.fromC === pos.c);
  }

  /** Check if a piece can be selected by current player */
  canSelectPiece(pos) {
    if (this.status !== 'playing') return false;
    if (this.board[pos.r][pos.c] === 0) return false;
    if (Math.sign(this.board[pos.r][pos.c]) !== this.turn) return false;
    if (this.mustMovePiece && (pos.r !== this.mustMovePiece.r || pos.c !== this.mustMovePiece.c)) return false;
    return this.validMoves.some(m => m.fromR === pos.r && m.fromC === pos.c);
  }

  /** Apply a move and return new GameState */
  applyMove(move) {
    if (this.status !== 'playing') return this;

    const result = MoveEngine.executeMove(this.board, move);
    let newStatus = 'playing';
    let newMustMove = null;
    let newTurn = this.turn;
    let newCaptureCount = { ...this.captureCount };

    // Update capture count
    if (move.isCapture) {
      const key = this.turn === 1 ? 'white' : 'black';
      newCaptureCount = { ...newCaptureCount, [key]: newCaptureCount[key] + 1 };
    }

    if (result.canContinue) {
      // Multi-capture: same player continues with locked piece
      newMustMove = result.positionAfter;
    } else {
      // End of turn: switch player
      newTurn = -this.turn;
      newMustMove = null;
    }

    const nextBoard = result.newBoard;

    // Check game over for the next player
    if (!MoveEngine.hasValidMoves(nextBoard, newTurn)) {
      newStatus = newTurn === 1 ? 'black_wins' : 'white_wins';
    }

    return new GameState({
      board: nextBoard,
      turn: newTurn,
      mustMovePiece: newMustMove,
      status: newStatus,
      moveCount: this.moveCount + 1,
      config: this.config,
      lastMove: move,
      captureCount: newCaptureCount
    });
  }

  /** Create a new game with current config */
  reset() {
    return new GameState({ config: this.config });
  }

  /** Update configuration */
  withConfig(config) {
    return new GameState({ ...this, config: { ...this.config, ...config } });
  }

  /** Check if current turn is AI */
  get currentPlayerIsAI() {
    return this.turn === 1 ? this.config.whiteIsAI : this.config.blackIsAI;
  }

  /** Get piece counts for display */
  get pieceCounts() {
    return {
      white: MoveEngine.countPieces(this.board, 1),
      black: MoveEngine.countPieces(this.board, -1)
    };
  }
}
