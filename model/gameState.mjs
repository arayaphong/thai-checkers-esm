import { INITIAL_BOARD, DEFAULT_CONFIG } from './types.mjs';
import { MoveEngine } from './moveEngine.mjs';

// ============================================
// GameState - Immutable game state container
// All updates return new GameState instance
// ============================================

export const createGameState = (params = {}) => {
  const board = structuredClone(params.board ?? INITIAL_BOARD);
  const turn = params.turn ?? 1;
  const mustMovePiece = params.mustMovePiece ?? null;
  const status = params.status ?? 'PLAYING';
  const moveCount = params.moveCount ?? 0;
  const config = params.config ? { ...params.config } : { ...DEFAULT_CONFIG };
  const lastMove = params.lastMove ?? null;

  /** Get all valid moves for current player */
  const getValidMoves = () => {
    if (status !== 'PLAYING') return [];
    return MoveEngine.getAllValidMoves(board, turn, mustMovePiece);
  };

  /** Get valid moves for a specific piece */
  const getMovesForPiece = (pos) => {
    const groups = Object.groupBy(getValidMoves(), (m) => `${m.fromR},${m.fromC}`);
    return groups[`${pos.r},${pos.c}`] ?? [];
  };

  /** Check if a piece can be selected by current player */
  const canSelectPiece = (pos) => {
    if (status !== 'PLAYING') return false;
    if (board[pos.r][pos.c] === 0) return false;
    if (Math.sign(board[pos.r][pos.c]) !== turn) return false;
    if (mustMovePiece && (pos.r !== mustMovePiece.r || pos.c !== mustMovePiece.c)) return false;
    return getValidMoves().some((m) => m.fromR === pos.r && m.fromC === pos.c);
  };

  /** Apply a move and return new GameState */
  const applyMove = (move) => {
    if (status !== 'PLAYING') return gameState;

    const result = MoveEngine.executeMove(board, move);
    let newStatus = 'PLAYING';
    let newMustMove = null;
    let newTurn = turn;

    if (result.canContinue) {
      // Multi-capture: same player continues with locked piece
      newMustMove = result.positionAfter;
    } else {
      // End of turn: switch player
      newTurn = -turn;
      newMustMove = null;
    }

    const nextBoard = result.newBoard;

    // Check game over for the next player
    if (!MoveEngine.hasValidMoves(nextBoard, newTurn)) {
      newStatus = newTurn === 1 ? 'BLACK_WINS' : 'WHITE_WINS';
    }

    return createGameState({
      board: nextBoard,
      turn: newTurn,
      mustMovePiece: newMustMove,
      status: newStatus,
      moveCount: moveCount + 1,
      config,
      lastMove: move,
    });
  };

  /** Create a new game with current config */
  const reset = () => createGameState({ config });

  /** Update configuration */
  const withConfig = (newConfig) =>
    createGameState({
      board,
      turn,
      mustMovePiece,
      status,
      moveCount,
      lastMove,
      config: { ...config, ...newConfig },
    });

  const gameState = {
    board,
    turn,
    mustMovePiece,
    status,
    moveCount,
    config,
    lastMove,

    /** Get all valid moves for current player */
    get validMoves() {
      return getValidMoves();
    },

    getMovesForPiece,
    canSelectPiece,
    applyMove,
    reset,
    withConfig,

    /** Check if current turn is AI */
    get currentPlayerIsAI() {
      return turn === 1 ? config.whiteIsAI : config.blackIsAI;
    },

    /** Get piece counts for display */
    get pieceCounts() {
      return {
        white: MoveEngine.countPieces(board, 1),
        black: MoveEngine.countPieces(board, -1),
      };
    },
  };

  return gameState;
};
