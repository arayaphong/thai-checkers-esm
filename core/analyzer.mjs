// Deep-first search analysis for Thai Checkers
import { PieceColor } from './piece.mjs';
import { Game } from './game.mjs';
import { evaluatePosition, isImmediateDraw, MATE_SCORE } from './evaluation.mjs';
import { orderMoveIndices } from './moves/move-order.mjs';

/**
 * Capped limit for depth search to avoid stack overflow.
 * @type {number}
 */
export const MAX_ANALYSIS_DEPTH = 16;

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
     * @param {import('./game.mjs').Game} game The starting game state.
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
     * @returns {{move: import('./game.mjs').Move, score: number}|null} The best move and its score, or null if no moves are available.
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

        const { bestMoveIndex, bestScore } = orderMoveIndices(moves, board, player).reduce(
            (acc, index) => {
                game.selectMove(index);
                const score = -this.#negamax(game, depth - 1, -Infinity, Infinity, -playerColor, 1);
                game.undoMove();

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
     * @param {import('./game.mjs').Game} game
     * @param {number} depth
     * @param {number} alpha
     * @param {number} beta
     * @param {number} color 1 for maximizing player, -1 for minimizing
     * @param {number} plyFromRoot Distance in plies from the analyze() root to `game`'s
     *   current position, used so a terminal score reflects actual mate distance rather
     *   than remaining search depth (see core/evaluation.mjs).
     * @returns {number} The score of the position from the perspective of the current player.
     */
    #negamax(game, depth, alpha, beta, color, plyFromRoot) {
        this.#nodeCount++;

        if (game.moveCount() === 0) {
            return -MATE_SCORE + plyFromRoot; // Loss, prefer losing later
        }

        const board = game.board();
        const player = game.player();

        // An immediate draw (per Thai checkers draw rules) scores as a loss for
        // player, not a neutral 0: the real game doesn't stop play here (see
        // analyze()'s doc comment on why the core engine is left alone), but
        // the search should never treat reaching this dead end as acceptable
        // as an actual win, so it's penalized identically to having no moves.
        if (isImmediateDraw(board, player)) {
            return -MATE_SCORE + plyFromRoot;
        }

        if (depth === 0) {
            return this.#quiescence(game, alpha, beta, color, plyFromRoot);
        }

        const moves = game.getMoves();

        let value = -Infinity;
        for (const index of orderMoveIndices(moves, board, player)) {
            game.selectMove(index);
            value = Math.max(
                value,
                -this.#negamax(game, depth - 1, -beta, -alpha, -color, plyFromRoot + 1),
            );
            game.undoMove();
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
     * @param {import('./game.mjs').Game} game
     * @param {number} alpha
     * @param {number} beta
     * @param {number} color 1 for maximizing player, -1 for minimizing
     * @param {number} plyFromRoot See #negamax.
     * @returns {number} The score of the position from the perspective of the current player.
     */
    #quiescence(game, alpha, beta, color, plyFromRoot) {
        this.#nodeCount++;

        const moves = game.getMoves();

        if (moves.length === 0) {
            return -MATE_SCORE + plyFromRoot;
        }

        const hasMandatoryCapture = moves[0].captured.length > 0;
        const board = game.board();
        const player = game.player();

        if (!hasMandatoryCapture) {
            if (isImmediateDraw(board, player)) {
                return -MATE_SCORE + plyFromRoot; // Immediate draw scores as a loss; see #negamax.
            }
            return color * evaluatePosition(game);
        }

        let value = -Infinity;
        for (const index of orderMoveIndices(moves, board, player)) {
            game.selectMove(index);
            value = Math.max(
                value,
                -this.#quiescence(game, -beta, -alpha, -color, plyFromRoot + 1),
            );
            game.undoMove();
            alpha = Math.max(alpha, value);
            if (alpha >= beta) break;
        }
        return value;
    }
}
