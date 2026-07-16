// Deep-first search analysis for Thai Checkers
import { PieceColor } from './piece.mjs';
import { Game } from './Game.mjs';
import { evaluatePosition, MATE_SCORE } from './evaluation.mjs';
import { promotionRow } from './directions.mjs';
import { orderMoveIndices } from './moves/moveOrder.mjs';

/**
 * Capped limit for depth search to avoid stack overflow.
 * @type {number}
 */
export const MAX_ANALYSIS_DEPTH = 16;

/**
 * A simulated line loses when it reaches this many consecutive plies without
 * a capture or promotion. The counter starts at zero for every analyze() call.
 * @type {number}
 */
export const NO_PROGRESS_THRESHOLD = 16;

/**
 * Captures and promotions are the only moves that reset the search-local
 * no-progress counter.
 * @param {import('./Board.mjs').Board} board Position before the move.
 * @param {number} player Side making the move.
 * @param {import('./Game.mjs').Move} move
 * @returns {boolean}
 */
const moveMakesProgress = (board, player, move) =>
    move.captured.length > 0 ||
    (!board.isDamePiece(move.from) && move.to.y === promotionRow(player));

/**
 * Asserts depth parameter validity.
 * @param {number} depth
 * @throws {RangeError}
 */
const assertValidDepth = (depth) => {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_ANALYSIS_DEPTH) {
        throw new RangeError(
            `Analysis depth must be an integer between 1 and ${MAX_ANALYSIS_DEPTH}: ${depth}`,
        );
    }
};

/**
 * A simple game tree analyzer using negamax with alpha-beta pruning.
 */
export class Analyzer {
    #game;
    #nodeCount = 0;

    /**
     * @param {import('./Game.mjs').Game} game The starting game state.
     */
    constructor(game) {
        this.#game = game;
    }

    /**
     * Number of #negamax and #quiescence invocations during the most recent analyze() call.
     * @type {number}
     */
    get nodeCount() {
        return this.#nodeCount;
    }

    /**
     * Run a deep search to find the best move.
     *
     * Every root move gets its own full (-Infinity, Infinity) window — not a
     * window narrowed by earlier siblings' scores. Narrowing would save some
     * root-level pruning, but fail-soft alpha-beta's return value on a cutoff
     * is only a bound, not necessarily the exact score; that's harmless deeper
     * in the tree (a node only needs the correct *maximum*, not to know which
     * child achieved it), but at the root #analyze also needs to know *which*
     * move produced the best score, and a narrowed sibling can wrongly appear
     * to tie or beat one it doesn't actually match. An earlier version of
     * this method narrowed the window here and picked the wrong root move on
     * a genuine near-tie (see the move-ordering-fix notes for the
     * reproduction). The root has only as many moves as there are legal
     * options here (never exponential), so searching each with a full window
     * costs comparatively little next to the exponential subtree beneath it,
     * where #negamax's own narrowing is unaffected and still safe.
     * @param {number} depth The search depth in plies. Must be an integer from 1 to MAX_ANALYSIS_DEPTH.
     * @returns {{move: import('./Game.mjs').Move, score: number}|null} The best move and its score, or null if no moves are available.
     */
    analyze(depth) {
        assertValidDepth(depth);

        this.#nodeCount = 0;
        const game = Game.copy(this.#game);
        const playerColor = game.player() === PieceColor.WHITE ? 1 : -1;
        const moves = game.getMoves();
        if (moves.length === 0) {
            return null;
        }

        const board = game.board();
        const player = game.player();
        const seenPositions = new Set(game.getPositionKeyHistory());

        const { bestMoveIndex, bestScore } = orderMoveIndices(moves, board, player).reduce(
            (acc, index) => {
                const transition = this.#enterMove(game, index, moves[index], 0, seenPositions);
                let score;
                try {
                    score =
                        transition.losesByPolicy && game.moveCount() > 0
                            ? -MATE_SCORE + 1
                            : -this.#negamax(
                                  game,
                                  depth - 1,
                                  -Infinity,
                                  Infinity,
                                  -playerColor,
                                  1,
                                  transition.noProgressPlies,
                                  seenPositions,
                              );
                } finally {
                    this.#leaveMove(game, transition, seenPositions);
                }

                // Strict improvement wins; ties keep the lowest move index, matching the
                // ascending-order tie-break of the original unordered scan.
                return score > acc.bestScore ||
                    (score === acc.bestScore && index < acc.bestMoveIndex)
                    ? { bestMoveIndex: index, bestScore: score }
                    : acc;
            },
            { bestMoveIndex: 0, bestScore: -Infinity },
        );

        return { move: moves[bestMoveIndex], score: bestScore };
    }

    /**
     * Alpha-beta minimax recursive search.
     * @param {import('./Game.mjs').Game} game
     * @param {number} depth
     * @param {number} alpha
     * @param {number} beta
     * @param {number} color 1 for maximizing player, -1 for minimizing
     * @param {number} plyFromRoot Distance in plies from the analyze() root to `game`'s
     *   current position, used so a terminal score reflects actual mate distance rather
     *   than remaining search depth (see core/evaluation.mjs).
     * @param {number} noProgressPlies Consecutive simulated plies without capture/promotion.
     * @param {Set<bigint>} seenPositions Full played history plus the current search branch.
     * @returns {number} The score of the position from the perspective of the current player.
     */
    #negamax(game, depth, alpha, beta, color, plyFromRoot, noProgressPlies, seenPositions) {
        this.#nodeCount++;

        if (game.moveCount() === 0) {
            return -MATE_SCORE + plyFromRoot; // Loss, prefer losing later
        }

        const board = game.board();
        const player = game.player();

        if (depth === 0) {
            return this.#quiescence(
                game,
                alpha,
                beta,
                color,
                plyFromRoot,
                noProgressPlies,
                seenPositions,
            );
        }

        const moves = game.getMoves();

        let value = -Infinity;
        for (const index of orderMoveIndices(moves, board, player)) {
            const childPly = plyFromRoot + 1;
            const transition = this.#enterMove(
                game,
                index,
                moves[index],
                noProgressPlies,
                seenPositions,
            );
            let score;
            try {
                score =
                    transition.losesByPolicy && game.moveCount() > 0
                        ? -MATE_SCORE + childPly
                        : -this.#negamax(
                              game,
                              depth - 1,
                              -beta,
                              -alpha,
                              -color,
                              childPly,
                              transition.noProgressPlies,
                              seenPositions,
                          );
            } finally {
                this.#leaveMove(game, transition, seenPositions);
            }
            value = Math.max(value, score);
            alpha = Math.max(alpha, value);
            if (alpha >= beta) break;
        }
        return value;
    }

    /**
     * Extends search past the depth-0 horizon while a mandatory capture is
     * pending: Thai checkers' forced-capture rule means the side to move has
     * no right to "stand pat" on the current position, so a static evaluation
     * here would not be a valid lower bound. Terminates because every capture
     * removes at least one piece from a finite board.
     * @param {import('./Game.mjs').Game} game
     * @param {number} alpha
     * @param {number} beta
     * @param {number} color 1 for maximizing player, -1 for minimizing
     * @param {number} plyFromRoot See #negamax.
     * @param {number} noProgressPlies See #negamax.
     * @param {Set<bigint>} seenPositions See #negamax.
     * @returns {number} The score of the position from the perspective of the current player.
     */
    #quiescence(game, alpha, beta, color, plyFromRoot, noProgressPlies, seenPositions) {
        this.#nodeCount++;

        const moves = game.getMoves();

        if (moves.length === 0) {
            return -MATE_SCORE + plyFromRoot;
        }

        const hasMandatoryCapture = moves[0].captured.length > 0;
        const board = game.board();
        const player = game.player();

        if (!hasMandatoryCapture) {
            return color * evaluatePosition(game);
        }

        let value = -Infinity;
        for (const index of orderMoveIndices(moves, board, player)) {
            const childPly = plyFromRoot + 1;
            const transition = this.#enterMove(
                game,
                index,
                moves[index],
                noProgressPlies,
                seenPositions,
            );
            let score;
            try {
                score =
                    transition.losesByPolicy && game.moveCount() > 0
                        ? -MATE_SCORE + childPly
                        : -this.#quiescence(
                              game,
                              -beta,
                              -alpha,
                              -color,
                              childPly,
                              transition.noProgressPlies,
                              seenPositions,
                          );
            } finally {
                this.#leaveMove(game, transition, seenPositions);
            }
            value = Math.max(value, score);
            alpha = Math.max(alpha, value);
            if (alpha >= beta) break;
        }
        return value;
    }

    /**
     * Selects one move and updates the two independent search policies:
     * no-progress counting and full-position repetition detection.
     * @param {import('./Game.mjs').Game} game
     * @param {number} index
     * @param {import('./Game.mjs').Move} move
     * @param {number} noProgressPlies
     * @param {Set<bigint>} seenPositions
     * @returns {{noProgressPlies: number, positionKey: bigint, losesByPolicy: boolean}}
     */
    #enterMove(game, index, move, noProgressPlies, seenPositions) {
        const nextNoProgressPlies = moveMakesProgress(game.board(), game.player(), move)
            ? 0
            : noProgressPlies + 1;

        game.selectMove(index);
        const positionKey = game.positionKey();
        const losesByPolicy =
            nextNoProgressPlies >= NO_PROGRESS_THRESHOLD || seenPositions.has(positionKey);

        if (!losesByPolicy) {
            seenPositions.add(positionKey);
        }

        return {
            noProgressPlies: nextNoProgressPlies,
            positionKey,
            losesByPolicy,
        };
    }

    /**
     * Restores the branch-local seen set and game after #enterMove().
     * @param {import('./Game.mjs').Game} game
     * @param {{positionKey: bigint, losesByPolicy: boolean}} transition
     * @param {Set<bigint>} seenPositions
     */
    #leaveMove(game, transition, seenPositions) {
        if (!transition.losesByPolicy) {
            seenPositions.delete(transition.positionKey);
        }
        game.undoMove();
    }
}
