import { MoveEngine } from '../model/MoveEngine.mjs';

// ============================================
// Heuristic v2 - Stronger board evaluation
// Factors tuned for Thai Checkers (8x8)
// ============================================

export const DEFAULT_WEIGHTS = {
  pawnValue: 100,
  dameValue: 300,
  advancementBonus: 15,
  promotionThreatBonus: 50,
  backRowDefenseBonus: 10,
  centerBonus: 5,
  edgePenalty: 8,
  mobilityBonus: 3,
  captureThreatBonus: 20,
};

export class Heuristic {
  constructor(weights = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  /** Evaluate board from perspective of given player */
  evaluate(board, player) {
    const opponent = -player;
    let score = 0;

    const myPieces = MoveEngine.countPieces(board, player);
    const oppPieces = MoveEngine.countPieces(board, opponent);

    // Material advantage (most important)
    score += (myPieces.pawns * this.weights.pawnValue);
    score += (myPieces.dames * this.weights.dameValue);
    score -= (oppPieces.pawns * this.weights.pawnValue);
    score -= (oppPieces.dames * this.weights.dameValue);

    // Win/loss detection (absolute)
    if (myPieces.total === 0) return -100000;
    if (oppPieces.total === 0) return 100000;

    // Piece position evaluation
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (piece === 0) continue;
        const isMine = Math.sign(piece) === player;
        const sign = isMine ? 1 : -1;
        const isDame = Math.abs(piece) === 2;

        if (!isDame) {
          // Pawn advancement toward promotion
          const progress = player > 0 ? (7 - r) : r;
          score += sign * progress * this.weights.advancementBonus;

          // Promotion threat: pawn on the row before promotion
          if (progress === 6) {
            score += sign * this.weights.promotionThreatBonus;
          }

          // Back row defense: keep some pawns on starting row
          if (progress <= 1) {
            score += sign * this.weights.backRowDefenseBonus;
          }
        }

        // Center control (D4-E4-D5-E5 area is most valuable)
        const centerDist = Math.abs(3.5 - r) + Math.abs(3.5 - c);
        const centerBonus = Math.max(0, 4 - centerDist) * this.weights.centerBonus;
        score += sign * centerBonus;

        // Edge penalty: pieces on edge have fewer escape routes
        if (c === 0 || c === 7) {
          score -= sign * this.weights.edgePenalty;
        }
      }
    }

    // Mobility: difference in number of available moves
    const myMoves = MoveEngine.getAllValidMoves(board, player).length;
    const oppMoves = MoveEngine.getAllValidMoves(board, opponent).length;
    score += (myMoves - oppMoves) * this.weights.mobilityBonus;

    // Forced capture situation: being forced to make a bad capture is bad
    // (handled by mobility difference above)

    return score;
  }
}
