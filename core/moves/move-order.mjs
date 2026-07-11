// Move ordering heuristic for the sequential search (core/analyzer.js).
// Order only affects how much of the tree alpha-beta prunes — it never
// changes the resulting score.
import { PieceColor } from '../piece.mjs';
import { pstMoveDelta } from '../evaluation.mjs';

/**
 * Assigns a weight score to a candidate move.
 * @param {import('../game.mjs').Move} move
 * @param {import('../board.mjs').Board} board
 * @param {number} promoRow
 * @returns {number}
 */
const moveOrderScore = (move, board, promoRow) => {
    if (move.captured.length > 0) {
        return 1_000 + move.captured.length;
    }
    if (move.to.y === promoRow && !board.isDamePiece(move.from)) {
        return 500;
    }
    // Quiet-move tiebreaker: every quiet move used to sort as an exact tie
    // (score 0) here, which cost alpha-beta nothing while evaluation was
    // material-only, but became a real liability once PST (and later
    // Mobility/Breakthrough) made positions rarely tie on value — see
    // core/evaluation.js's pstMoveDelta doc comment.
    return pstMoveDelta(board, move.from, move.to);
};

/**
 * Returns move indices sorted by priority.
 * @param {import('../game.mjs').Move[]} moves
 * @param {import('../board.mjs').Board} board
 * @param {number} player - PieceColor
 * @returns {number[]}
 */
export const orderMoveIndices = (moves, board, player) => {
    const promoRow = player === PieceColor.WHITE ? 0 : 7;
    return moves
        .keys()
        .toArray()
        .toSorted(
            (a, b) =>
                moveOrderScore(moves[b], board, promoRow) -
                moveOrderScore(moves[a], board, promoRow),
        );
};
