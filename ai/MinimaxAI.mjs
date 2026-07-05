import { AIInterface } from './AIInterface.mjs';
import { Heuristic } from './Heuristic.mjs';
import { MoveEngine } from '../model/MoveEngine.mjs';

// ============================================
// MinimaxAI v2 - Optimized Alpha-Beta Pruning
// Faster evaluation, better move ordering
// Hard difficulty
// ============================================

export class MinimaxAI extends AIInterface {
  #heuristic;
  #maxDepth;
  #nodesSearched = 0;

  constructor() {
    super('MinimaxAI', { difficulty: 'hard', thinkTimeMs: 600 });
    this.#heuristic = new Heuristic();
    this.#maxDepth = 4; // 4-ply lookahead (my move + opponent + my response + opponent)
  }

  async makeMove(state) {
    const moves = state.validMoves;
    if (moves.length === 0) throw new Error('No valid moves');
    if (moves.length === 1) return moves[0];

    this.#nodesSearched = 0;

    // Move ordering: evaluate captures first (they're usually better)
    const orderedMoves = this.#orderMoves(state.board, moves, state.turn);

    let bestMove = orderedMoves[0];
    let bestScore = -Infinity;

    for (const move of orderedMoves) {
      const result = MoveEngine.executeMove(state.board, move);
      const score = this.#minimize(result.newBoard, state.turn, this.#maxDepth - 1, -Infinity, Infinity);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    return bestMove;
  }

  #minimize(board, originalPlayer, depth, alpha, beta) {
    this.#nodesSearched++;

    const currentPlayer = -originalPlayer;
    const moves = MoveEngine.getAllValidMoves(board, currentPlayer);

    if (moves.length === 0) return 50000 + depth;
    if (depth <= 0) return this.#heuristic.evaluate(board, originalPlayer);

    let minScore = Infinity;
    for (const move of moves) {
      const result = MoveEngine.executeMove(board, move);
      const score = this.#maximize(result.newBoard, originalPlayer, depth - 1, alpha, beta);
      minScore = Math.min(minScore, score);
      beta = Math.min(beta, score);
      if (beta <= alpha) break; // Alpha cutoff
    }
    return minScore;
  }

  #maximize(board, originalPlayer, depth, alpha, beta) {
    this.#nodesSearched++;

    const moves = MoveEngine.getAllValidMoves(board, originalPlayer);

    if (moves.length === 0) return -50000 - depth;
    if (depth <= 0) return this.#heuristic.evaluate(board, originalPlayer);

    let maxScore = -Infinity;
    for (const move of moves) {
      const result = MoveEngine.executeMove(board, move);
      const score = this.#minimize(result.newBoard, originalPlayer, depth - 1, alpha, beta);
      maxScore = Math.max(maxScore, score);
      alpha = Math.max(alpha, score);
      if (beta <= alpha) break; // Beta cutoff
    }
    return maxScore;
  }

  #orderMoves(board, moves, player) {
    return moves.toSorted((a, b) => {
      if (a.isCapture && !b.isCapture) return -1;
      if (!a.isCapture && b.isCapture) return 1;
      return this.#quickScore(board, b, player) - this.#quickScore(board, a, player);
    });
  }

  #quickScore(board, move, player) {
    return this.#heuristic.evaluate(MoveEngine.executeMove(board, move).newBoard, player);
  }

  get description() {
    return `MinimaxAI v2: Alpha-beta depth ${this.#maxDepth}, move ordering. Hard difficulty.`;
  }
}
