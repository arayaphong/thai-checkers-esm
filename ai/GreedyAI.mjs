import { AIInterface } from './AIInterface.mjs';
import { Heuristic } from './Heuristic.mjs';
import { MoveEngine } from '../model/MoveEngine.mjs';

// ============================================
// GreedyAI v3 - Fast 1-ply + opponent response sampling
// Evaluates our move + samples opponent's best replies
// Medium difficulty - balanced speed and strength
// ============================================

export class GreedyAI extends AIInterface {
  #heuristic;

  constructor() {
    super('GreedyAI', { difficulty: 'medium', thinkTimeMs: 200 });
    this.#heuristic = new Heuristic();
  }

  async makeMove(state) {
    await this.think();
    const moves = state.validMoves;
    if (moves.length === 0) throw new Error('No valid moves');
    if (moves.length === 1) return moves[0];

    const { capture: captures = [], walk: nonCaptures = [] } =
      Object.groupBy(moves, ({ isCapture }) => isCapture ? 'capture' : 'walk');

    if (captures.length > 0) return this.#pickBest(captures, state);
    return this.#pickBestWithOpponentCheck(nonCaptures, state);
  }

  #pickBest(moves, state) {
    let best = moves[0];
    let bestScore = -Infinity;

    for (const move of moves) {
      const result = MoveEngine.executeMove(state.board, move);
      let finalBoard = result.newBoard;
      if (result.canContinue) {
        finalBoard = this.#resolveChain(result.newBoard, state.turn, result.positionAfter);
      }
      const score = this.#heuristic.evaluate(finalBoard, state.turn);
      if (score > bestScore) {
        bestScore = score;
        best = move;
      }
    }
    return best;
  }

  #pickBestWithOpponentCheck(moves, state) {
    const opponent = -state.turn;

    const scored = moves
      .map(move => {
        const result = MoveEngine.executeMove(state.board, move);
        const afterOurMove = this.#heuristic.evaluate(result.newBoard, state.turn);

        const oppCaptures = MoveEngine.getAllValidMoves(result.newBoard, opponent)
          .filter(m => m.isCapture);

        if (oppCaptures.length > 0) {
          return { move, score: afterOurMove - 30 * oppCaptures.length };
        }

        return { move, score: afterOurMove };
      })
      .toSorted((a, b) => b.score - a.score);

    const candidates = scored.slice(0, Math.min(3, scored.length));
    let bestMove = candidates[0].move;
    let bestWorstScore = -Infinity;

    for (const { move } of candidates) {
      const result = MoveEngine.executeMove(state.board, move);
      const oppMoves = MoveEngine.getAllValidMoves(result.newBoard, opponent);

      if (oppMoves.length === 0) return move;

      let worstScore = Infinity;
      const topOppMoves = oppMoves.slice(0, Math.min(3, oppMoves.length));
      for (const oppMove of topOppMoves) {
        const oppResult = MoveEngine.executeMove(result.newBoard, oppMove);
        const scoreAfterOpp = this.#heuristic.evaluate(oppResult.newBoard, state.turn);
        if (scoreAfterOpp < worstScore) worstScore = scoreAfterOpp;
      }

      if (worstScore > bestWorstScore) {
        bestWorstScore = worstScore;
        bestMove = move;
      }
    }

    return bestMove;
  }

  #resolveChain(board, player, pos) {
    let currentBoard = board;
    let currentPos = pos;
    const MAX_CHAIN = 8;
    for (let i = 0; i < MAX_CHAIN; i++) {
      const { captures } = MoveEngine.getMovesForPiece(currentBoard, currentPos.r, currentPos.c);
      if (captures.length === 0) break;
      let bestCap = captures[0];
      let bestScore = -Infinity;
      for (const cap of captures) {
        const result = MoveEngine.executeMove(currentBoard, cap);
        const score = this.#heuristic.evaluate(result.newBoard, player);
        if (score > bestScore) { bestScore = score; bestCap = cap; }
      }
      const result = MoveEngine.executeMove(currentBoard, bestCap);
      currentBoard = result.newBoard;
      currentPos = result.positionAfter;
    }
    return currentBoard;
  }

  get description() {
    return 'GreedyAI v3: 1-ply + opponent reply check. Fast and smart medium AI.';
  }
}
