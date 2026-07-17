// Deep-first search analysis for Thai Checkers
import { PieceColor } from './piece.mjs';
import { Game } from './Game.mjs';
import { evaluatePosition, MATE_SCORE } from './evaluation.mjs';
import { promotionRow } from './directions.mjs';
import { orderMoveIndices } from './moves/moveOrder.mjs';
import learnedTrajectory from '../train/trajectory.json' with { type: 'json' };
import {
    hardPruneMoveIndices,
    trajectoryBias,
    trajectoryMoveKey,
} from './trajectoryPolicy.mjs';

/**
 * Capped limit for depth search to avoid stack overflow.
 * @type {number}
 */
export const MAX_ANALYSIS_DEPTH = 16;

/**
 * A line loses when it reaches this many consecutive played and simulated
 * plies without a capture or promotion.
 * @type {number}
 */
export const NO_PROGRESS_THRESHOLD = 16;

/**
 * Counts set bits in an unsigned 32-bit bitboard.
 * @param {number} bits
 * @returns {number}
 */
const countBits = (bits) => {
    let remaining = bits >>> 0;
    let count = 0;
    while (remaining !== 0) {
        remaining = (remaining & (remaining - 1)) >>> 0;
        count++;
    }
    return count;
};

/**
 * Returns the trailing number of played plies without a capture or promotion.
 * Board history is authoritative: captures reduce occupancy, while a quiet
 * promotion increases the number of dames. Scanning stops at the policy limit
 * because larger values are equivalent to the analyzer.
 * @param {import('./Board.mjs').Board[]} boardHistory
 * @returns {number}
 */
const trailingNoProgressPlies = (boardHistory) => {
    let plies = 0;
    for (let i = boardHistory.length - 1; i > 0 && plies < NO_PROGRESS_THRESHOLD; i--) {
        const before = boardHistory[i - 1];
        const after = boardHistory[i];
        const captured = countBits(after.occBits) < countBits(before.occBits);
        const promoted = countBits(after.dameBits) > countBits(before.dameBits);
        if (captured || promoted) break;
        plies++;
    }
    return plies;
};

/**
 * Converts a root-relative no-progress loss into the perspective of the
 * parent node that selected the move. Even parent plies belong to the root
 * side; odd parent plies belong to its opponent.
 * @param {number} parentPly
 * @param {number} childPly
 * @returns {number}
 */
const rootLossScoreForParent = (parentPly, childPly) => {
    const rootLoss = -MATE_SCORE + childPly;
    return parentPly % 2 === 0 ? rootLoss : -rootLoss;
};

/**
 * Returns a policy result from the perspective of the parent that selected
 * the move, or undefined when normal search should continue. Repetition is
 * checked first because that specific move is forbidden for its mover, even
 * when it also reaches the more general no-progress limit. Otherwise,
 * no-progress is always a loss for the analyzer root.
 * @param {{reachesNoProgressThreshold: boolean, repeatsPosition: boolean}} transition
 * @param {number} parentPly
 * @param {number} childPly
 * @returns {number|undefined}
 */
const policyScoreForParent = (transition, parentPly, childPly) => {
    if (transition.repeatsPosition) {
        return -MATE_SCORE + childPly;
    }
    if (transition.reachesNoProgressThreshold) {
        return rootLossScoreForParent(parentPly, childPly);
    }
    return undefined;
};

/**
 * Captures and promotions are the only moves that reset the no-progress
 * counter while exploring a branch.
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
    #positionBias;
    #pruneMoves;

    /**
     * @param {import('./Game.mjs').Game} game The starting game state.
     * @param {{useTrajectory?: boolean, positionBias?: (positionKey: bigint) => number,
     *   pruneMoves?: (positionKey: bigint, moves: import('./Game.mjs').Move[]) => Iterable<number>}} [options]
     *   Optional learned score adjustment. The callback receives a position key
     *   that includes the side to move and must return a score from that side's
     *   perspective. It is consulted only at static, non-terminal leaf nodes.
     */
    constructor(game, options = {}) {
        if (typeof options !== 'object' || options === null || Array.isArray(options)) {
            throw new TypeError('Analyzer options must be an object');
        }
        if (options.positionBias !== undefined && typeof options.positionBias !== 'function') {
            throw new TypeError('Analyzer positionBias must be a function');
        }
        if (options.pruneMoves !== undefined && typeof options.pruneMoves !== 'function') {
            throw new TypeError('Analyzer pruneMoves must be a function');
        }
        if (options.useTrajectory !== undefined && typeof options.useTrajectory !== 'boolean') {
            throw new TypeError('Analyzer useTrajectory must be a boolean');
        }
        this.#game = game;
        const useTrajectory = options.useTrajectory ?? true;
        this.#positionBias =
            options.positionBias ??
            (useTrajectory
                ? (positionKey) => trajectoryBias(learnedTrajectory, positionKey)
                : () => 0);
        this.#pruneMoves =
            options.pruneMoves ??
            (useTrajectory
                ? (positionKey, moves) =>
                      hardPruneMoveIndices(
                          learnedTrajectory,
                          positionKey,
                          moves,
                          trajectoryMoveKey,
                      )
                : () => []);
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
        return this.analyzeCandidates(depth)[0] ?? null;
    }

    /**
     * Scores every root move that survives optional pruning and returns them
     * from strongest to weakest. Equal scores retain the original legal-move
     * index tie-break used by analyze().
     * @param {number} depth Search depth in plies.
     * @returns {{move: import('./Game.mjs').Move, score: number}[]}
     */
    analyzeCandidates(depth) {
        assertValidDepth(depth);

        this.#nodeCount = 0;
        const game = Game.copy(this.#game);
        const playerColor = game.player() === PieceColor.WHITE ? 1 : -1;
        const moves = game.getMoves();
        if (moves.length === 0) {
            return [];
        }

        const board = game.board();
        const player = game.player();
        const noProgressPlies = trailingNoProgressPlies(game.getBoardHistory());
        const seenPositions = new Set(game.getPositionKeyHistory());

        const moveIndices = this.#moveIndices(game, moves, board, player);
        return moveIndices
            .map((index) => {
                const transition = this.#enterMove(
                    game,
                    index,
                    moves[index],
                    noProgressPlies,
                    seenPositions,
                );
                let score;
                try {
                    const childPly = 1;
                    const policyScore = policyScoreForParent(transition, 0, childPly);
                    score =
                        policyScore !== undefined && game.moveCount() > 0
                            ? policyScore
                            : -this.#negamax(
                                  game,
                                  depth - 1,
                                  -Infinity,
                                  Infinity,
                                  -playerColor,
                                  childPly,
                                  transition.noProgressPlies,
                                  seenPositions,
                              );
                } finally {
                    this.#leaveMove(game, transition, seenPositions);
                }
                return { index, move: moves[index], score };
            })
            .sort((left, right) => right.score - left.score || left.index - right.index)
            .map(({ move, score }) => ({ move, score }));
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
     * @param {number} noProgressPlies Consecutive played and simulated plies without
     *   capture/promotion.
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
        for (const index of this.#moveIndices(game, moves, board, player)) {
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
                const policyScore = policyScoreForParent(
                    transition,
                    plyFromRoot,
                    childPly,
                );
                score =
                    policyScore !== undefined && game.moveCount() > 0
                        ? policyScore
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
            const bias = this.#positionBias(game.positionKey());
            if (typeof bias !== 'number' || !Number.isFinite(bias)) {
                throw new TypeError('Analyzer positionBias must return a finite number');
            }
            return color * evaluatePosition(game) + bias;
        }

        let value = -Infinity;
        for (const index of this.#moveIndices(game, moves, board, player)) {
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
                const policyScore = policyScoreForParent(
                    transition,
                    plyFromRoot,
                    childPly,
                );
                score =
                    policyScore !== undefined && game.moveCount() > 0
                        ? policyScore
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
     * Applies optional learned pruning after normal move ordering. A forced
     * move is never offered for pruning, and a faulty provider cannot remove
     * every legal move.
     */
    #moveIndices(game, moves, board, player) {
        const ordered = orderMoveIndices(moves, board, player);
        if (ordered.length <= 1) return ordered;

        const requested = this.#pruneMoves(game.positionKey(), moves);
        if (requested === null || requested === undefined || !requested[Symbol.iterator]) {
            throw new TypeError('Analyzer pruneMoves must return an iterable of move indices');
        }
        const pruned = new Set(requested);
        for (const index of pruned) {
            if (!Number.isSafeInteger(index) || index < 0 || index >= moves.length) {
                throw new RangeError(`Analyzer pruneMoves returned an invalid move index: ${index}`);
            }
        }

        const remaining = ordered.filter((index) => !pruned.has(index));
        return remaining.length > 0 ? remaining : [ordered[0]];
    }

    /**
     * Selects one move and updates the two independent search policies:
     * no-progress counting and full-position repetition detection.
     * @param {import('./Game.mjs').Game} game
     * @param {number} index
     * @param {import('./Game.mjs').Move} move
     * @param {number} noProgressPlies
     * @param {Set<bigint>} seenPositions
     * @returns {{noProgressPlies: number, positionKey: bigint,
     *   reachesNoProgressThreshold: boolean, repeatsPosition: boolean, addedToSeen: boolean}}
     */
    #enterMove(game, index, move, noProgressPlies, seenPositions) {
        const nextNoProgressPlies = moveMakesProgress(game.board(), game.player(), move)
            ? 0
            : noProgressPlies + 1;

        game.selectMove(index);
        const positionKey = game.positionKey();
        const reachesNoProgressThreshold = nextNoProgressPlies >= NO_PROGRESS_THRESHOLD;
        const repeatsPosition = seenPositions.has(positionKey);
        const addedToSeen = !reachesNoProgressThreshold && !repeatsPosition;

        if (addedToSeen) {
            seenPositions.add(positionKey);
        }

        return {
            noProgressPlies: nextNoProgressPlies,
            positionKey,
            reachesNoProgressThreshold,
            repeatsPosition,
            addedToSeen,
        };
    }

    /**
     * Restores the branch-local seen set and game after #enterMove().
     * @param {import('./Game.mjs').Game} game
     * @param {{positionKey: bigint, addedToSeen: boolean}} transition
     * @param {Set<bigint>} seenPositions
     */
    #leaveMove(game, transition, seenPositions) {
        if (transition.addedToSeen) {
            seenPositions.delete(transition.positionKey);
        }
        game.undoMove();
    }
}
