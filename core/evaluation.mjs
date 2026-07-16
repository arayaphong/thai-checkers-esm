// Shared, WHITE-perspective static evaluator for the sequential negamax
// (core/Analyzer.mjs).
import { PieceColor, PieceType } from './piece.mjs';
import { Position } from './Position.mjs';
import { pionForwardDirs, promotionRow, isOpponentPiece, DAME_DIRS } from './directions.mjs';
// All tunable heuristic weights (piece values, PST tables, mobility,
// breakthrough, structure) live in the evaluation profile so they can be
// tuned or swapped without touching evaluator logic. Search sentinels
// (MATE_SCORE) are not weights and stay in code.
import profile from './profiles/eval-profile-v1.json' with { type: 'json' };

/**
 * Base heuristic piece values, loaded from the active evaluation profile.
 * @type {readonly {PION: number, DAME: number}}
 */
export const PIECE_VALUES = Object.freeze({ ...profile.PIECE_VALUES });

/**
 * MATE_SCORE must stay far above any possible heuristic score sum so a forced
 * win/loss can never be outweighed by material or positional heuristics.
 * @type {number}
 */
export const MATE_SCORE = 100_000;

/**
 * Distinguishes near-mate scores (which bake in root-relative ply distance
 * and are unsafe to cache across differing remaining-depth budgets) from
 * ordinary heuristic scores (safe to cache). See core/Analyzer.mjs's #negamax.
 * @type {number}
 */
export const MATE_SCORE_THRESHOLD = 90_000;

/**
 * Returns static material value of a piece type.
 * @param {number} type - PieceType
 * @returns {number}
 */
const pieceValue = (type) => (type === PieceType.DAME ? PIECE_VALUES.DAME : PIECE_VALUES.PION);

// ─── Piece-Square Tables (Phase 4) ───
// Light positional preference, not a promotion-proximity signal — that's
// Breakthrough's job (Phase 6). Tables are defined once from WHITE's point of
// view (y=0 is White's back rank per core/Board.mjs HOME_ROWS, y=7 is White's
// promotion row) and BLACK's table is the same values with the row mirrored
// (y -> 7-y), using symmetry where Black's table is mirrored from White's.
//
// Pion: realized range with the v1 profile is -12 to +19 (the target was
// ≈ -15 to +20 as starting values for tuning, not final).
// Note: Due to direct pos.y indexing, the values are mapped as
// index: y = 0 (back rank) .. 7 (promotion side).
const PION_ROW_BONUS = profile.PION_ROW_BONUS;
const PION_COL_BONUS = profile.PION_COL_BONUS; // index: x = 0 (A-file) .. 7 (H-file)

// Dame: quite flat — Thai dames are flying kings, equally strong from most
// squares — with only a small, board-symmetric center bonus / edge-corner
// penalty. The same array serves as both the row and column bonus since the
// desired shape is symmetric in both dimensions. Realized range with the v1
// profile is exactly -6 to +8.
const DAME_LINE_BONUS = profile.DAME_LINE_BONUS; // index: rank/file position 0..7

/**
 * Builds Piece-Square Table (PST) array.
 * @param {number[]} rowBonus
 * @param {number[]} colBonus
 * @returns {number[]}
 */
const buildPst = (rowBonus, colBonus) =>
    Position.allValid().reduce((table, pos) => {
        table[pos.hash()] = rowBonus[pos.y] + colBonus[pos.x];
        return table;
    }, new Array(Position.MAX_POSITIONS).fill(0));

/**
 * Rotates the PST table 180 degrees for the opposite color.
 * @param {number[]} whiteTable
 * @returns {number[]}
 */
const mirrorPst = (whiteTable) =>
    Position.allValid().reduce((table, pos) => {
        table[pos.hash()] = whiteTable[Position.fromCoords(7 - pos.x, 7 - pos.y).hash()];
        return table;
    }, new Array(Position.MAX_POSITIONS).fill(0));

const PION_PST_WHITE = buildPst(PION_ROW_BONUS, PION_COL_BONUS);
const PION_PST_BLACK = mirrorPst(PION_PST_WHITE);
const DAME_PST_WHITE = buildPst(DAME_LINE_BONUS, DAME_LINE_BONUS);
const DAME_PST_BLACK = mirrorPst(DAME_PST_WHITE);

/**
 * Gets PST score for a piece.
 * @param {number} type - PieceType
 * @param {number} color - PieceColor
 * @param {Position} pos
 * @returns {number}
 */
const pstValue = (type, color, pos) => {
    const table =
        type === PieceType.DAME
            ? color === PieceColor.BLACK
                ? DAME_PST_BLACK
                : DAME_PST_WHITE
            : color === PieceColor.BLACK
              ? PION_PST_BLACK
              : PION_PST_WHITE;
    return table[pos.hash()];
};

/**
 * PST change a quiet move would cause for the piece making it — used by
 * core/moves/moveOrder.mjs as a cheap (two table lookups, no board copy or
 * full evaluateBoard() call) tiebreaker among quiet moves, which otherwise
 * all sort as equal and gave alpha-beta nothing to distinguish them by once
 * Phase 4 (PST) made most positions no longer tie on material alone (due to the
 * node-count blowup this caused, resolved by the move-ordering fix).
 * Magnitude stays within ±31 (pion) / ±14 (dame) — safely below the capture
 * and promotion move-order tiers, so it only breaks ties within the quiet
 * bucket, never reorders across tiers.
 * @param {import('./Board.mjs').Board} board The position before the move.
 * @param {import('./Position.mjs').Position} from
 * @param {import('./Position.mjs').Position} to
 * @returns {number}
 */
export const pstMoveDelta = (board, from, to) => {
    const color = board.isBlackPiece(from) ? PieceColor.BLACK : PieceColor.WHITE;
    const type = board.isDamePiece(from) ? PieceType.DAME : PieceType.PION;
    return pstValue(type, color, to) - pstValue(type, color, from);
};

/**
 * Sums piece value and PST bonus for all pieces of a color.
 * @param {Map<Position, import('./piece.mjs').PieceInfo>} pieces
 * @param {number} color - PieceColor
 * @returns {number}
 */
const sideScore = (pieces, color) =>
    pieces
        .entries()
        .reduce((acc, [pos, { type }]) => acc + pieceValue(type) + pstValue(type, color, pos), 0);

// ─── Mobility (Phase 5) ───
// Direct coordinate scans only — never Explorer/game.getMoves() — so mobility
// stays cheap enough to compute at every leaf. Mirrors the direction vectors
// core/Explorer.mjs uses for real move generation, but only counts squares
// instead of allocating move/Legals objects.

const { PION_MOBILITY_PER_SQUARE, DAME_MOBILITY_PER_SQUARE, DAME_MOBILITY_CAP } = profile;

/**
 * Recursive ray-walker: returns the first occupied Position along (x,y) →
 * (x+stepX, y+stepY) → …, or null if the ray runs off the board without
 * hitting a piece. Used by dameMobility, pieceHasCapture, isCapturableByDame,
 * and findCaptureAttacker.
 * @param {import('./Board.mjs').Board} board
 * @param {number} x
 * @param {number} y
 * @param {number} stepX
 * @param {number} stepY
 * @returns {Position|null}
 */
const firstOccupiedAlongRay = (board, x, y, stepX, stepY) =>
    !Position.isValid(x, y)
        ? null
        : board.isOccupied(Position.fromCoords(x, y))
          ? Position.fromCoords(x, y)
          : firstOccupiedAlongRay(board, x + stepX, y + stepY, stepX, stepY);

/**
 * Computes mobility score for a pion.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {number}
 */
const pionMobility = (board, pos, color) => {
    let openSquares = 0;
    for (const { dx, dy } of pionForwardDirs(color)) {
        const x = pos.x + dx;
        const y = pos.y + dy;
        if (Position.isValid(x, y) && !board.isOccupied(Position.fromCoords(x, y))) {
            openSquares++;
        }
    }
    return openSquares * PION_MOBILITY_PER_SQUARE;
};

/**
 * Counts empty squares along a ray for dame mobility.
 * @param {import('./Board.mjs').Board} board
 * @param {number} x
 * @param {number} y
 * @param {number} dx
 * @param {number} dy
 * @returns {number}
 */
const dameRayCount = (board, x, y, dx, dy) =>
    Position.isValid(x, y) && !board.isOccupied(Position.fromCoords(x, y))
        ? 1 + dameRayCount(board, x + dx, y + dy, dx, dy)
        : 0;

/**
 * Computes mobility score for a dame.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @returns {number}
 */
const dameMobility = (board, pos) =>
    Math.min(
        DAME_DIRS.reduce(
            (acc, { dx, dy }) => acc + dameRayCount(board, pos.x + dx, pos.y + dy, dx, dy),
            0,
        ),
        DAME_MOBILITY_CAP,
    ) * DAME_MOBILITY_PER_SQUARE;

/**
 * Checks if a dame has any available capture.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor of the reference side
 * @returns {boolean}
 */
const dameHasCapture = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const blocker = firstOccupiedAlongRay(board, pos.x + dx, pos.y + dy, dx, dy);
        return (
            blocker !== null &&
            isOpponentPiece(board, blocker, color) &&
            Position.isValid(blocker.x + dx, blocker.y + dy) &&
            !board.isOccupied(Position.fromCoords(blocker.x + dx, blocker.y + dy))
        );
    });

/**
 * Checks if a pion has any available capture.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor of the reference side
 * @returns {boolean}
 */
const pionHasCapture = (board, pos, color) =>
    pionForwardDirs(color).some(({ dx, dy }) => {
        const midX = pos.x + dx;
        const midY = pos.y + dy;
        const landX = pos.x + 2 * dx;
        const landY = pos.y + 2 * dy;
        return (
            Position.isValid(midX, midY) &&
            Position.isValid(landX, landY) &&
            isOpponentPiece(board, Position.fromCoords(midX, midY), color) &&
            !board.isOccupied(Position.fromCoords(landX, landY))
        );
    });

/**
 * Checks if a piece has any available capture.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @param {boolean} isDame
 * @returns {boolean}
 */
const pieceHasCapture = (board, pos, color, isDame) =>
    isDame ? dameHasCapture(board, pos, color) : pionHasCapture(board, pos, color);

/**
 * Checks if a color has any mandatory captures.
 * @param {import('./Board.mjs').Board} board
 * @param {number} color - PieceColor
 * @returns {boolean}
 */
const hasMandatoryCapture = (board, color, pieces) =>
    pieces
        .entries()
        .some(([pos, { type }]) => pieceHasCapture(board, pos, color, type === PieceType.DAME));

/**
 * Computes mobility sum for a side.
 * @param {Map<Position, import('./piece.mjs').PieceInfo>} pieces
 * @param {import('./Board.mjs').Board} board
 * @param {number} color - PieceColor
 * @returns {number}
 */
const sideMobility = (pieces, board, color) =>
    pieces
        .entries()
        .reduce(
            (acc, [pos, { type }]) =>
                acc +
                (type === PieceType.DAME
                    ? dameMobility(board, pos)
                    : pionMobility(board, pos, color)),
            0,
        );

/**
 * Computes relative mobility score.
 * @param {import('./Board.mjs').Board} board
 * @param {number} [sideToMove] - PieceColor
 * @returns {number}
 */
const mobilityScore = (board, sideToMove, piecesByColor) =>
    sideToMove === undefined || hasMandatoryCapture(board, sideToMove, piecesByColor[sideToMove])
        ? 0
        : sideMobility(piecesByColor[PieceColor.WHITE], board, PieceColor.WHITE) -
          sideMobility(piecesByColor[PieceColor.BLACK], board, PieceColor.BLACK);

// ─── Breakthrough (Phase 6) ───
// Pions only. A "candidate" is a pion that has passed every enemy pion's row
// AND (when it's actually the opponent's turn) isn't sitting in an immediate
// capture. Passing those two gates always earns the base bonus; a genuinely
// open (unblocked) path to promotion adds the path + proximity bonus on top.
const {
    BREAKTHROUGH_BASE,
    BREAKTHROUGH_OPEN_PATH,
    BREAKTHROUGH_PROXIMITY_MIN,
    BREAKTHROUGH_PROXIMITY_MAX,
    BREAKTHROUGH_PROXIMITY_DECAY_PER_ROW,
} = profile;

/**
 * Helper to get the opposite color.
 * @param {number} color
 * @returns {number}
 */
const oppositeColor = (color) => (color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE);

/**
 * Scans the maximum/minimum enemy pion row limit.
 * @param {import('./Board.mjs').Board} board
 * @param {number} color - PieceColor
 * @returns {number}
 */
const findEnemyPionRowLimit = (enemyPieces, color) => {
    const reducer =
        color === PieceColor.WHITE ? (acc, y) => Math.max(acc, y) : (acc, y) => Math.min(acc, y);
    const initial = color === PieceColor.WHITE ? -Infinity : Infinity;
    return [...enemyPieces]
        .filter(([, { type }]) => type === PieceType.PION)
        .reduce((acc, [pos]) => reducer(acc, pos.y), initial);
};

/**
 * Checks if a pion has passed all opponent pions.
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @param {number} enemyPionRowLimit
 * @returns {boolean}
 */
const isPassedPion = (pos, color, enemyPionRowLimit) =>
    color === PieceColor.WHITE ? pos.y > enemyPionRowLimit : pos.y < enemyPionRowLimit;

/**
 * BFS over forward-diagonal empty squares (see core/Board.mjs's promotion
 * rows), using a BFS/flood-fill in the forward direction up to the
 * promotion row — a static reachability estimate over the current board
 * snapshot, not a real multi-ply move simulation.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {boolean}
 */
const hasOpenPathToPromotion = (board, pos, color) => {
    const target = promotionRow(color);
    const dirs = pionForwardDirs(color);
    const bfs = (queue, visited) =>
        queue.length === 0
            ? false
            : queue[0].y === target
              ? true
              : (() => {
                    const current = queue[0];
                    const rest = queue.slice(1);
                    const neighbors = dirs.reduce((acc, { dx, dy }) => {
                        const x = current.x + dx;
                        const y = current.y + dy;
                        const next = Position.isValid(x, y) ? Position.fromCoords(x, y) : null;
                        return next !== null && !visited.has(next.hash()) && !board.isOccupied(next)
                            ? acc.concat([next])
                            : acc;
                    }, []);
                    const newVisited = new Set([...visited, ...neighbors.map((n) => n.hash())]);
                    return bfs([...rest, ...neighbors], newVisited);
                })();
    return bfs([pos], new Set([pos.hash()]));
};

/**
 * Distance-to-promotion proximity bonus, clamped to a +10..+30 target with
 * the v1 profile.
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {number}
 */
const proximityBonus = (pos, color) => {
    const distance = color === PieceColor.WHITE ? 7 - pos.y : pos.y;
    return Math.max(
        BREAKTHROUGH_PROXIMITY_MIN,
        BREAKTHROUGH_PROXIMITY_MAX - distance * BREAKTHROUGH_PROXIMITY_DECAY_PER_ROW,
    );
};

/**
 * Checks if a pion is currently threatened with capture by a dame.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {boolean}
 */
const isCapturableByDame = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const landX = pos.x + dx;
        const landY = pos.y + dy;
        return (
            Position.isValid(landX, landY) &&
            !board.isOccupied(Position.fromCoords(landX, landY)) &&
            (() => {
                const attacker = firstOccupiedAlongRay(board, pos.x - dx, pos.y - dy, -dx, -dy);
                return (
                    attacker !== null &&
                    isOpponentPiece(board, attacker, color) &&
                    board.isDamePiece(attacker)
                );
            })()
        );
    });

/**
 * Computes breakthrough promotion score.
 * @param {import('./Board.mjs').Board} board
 * @param {number} [sideToMove] - PieceColor
 * @returns {number}
 */
const breakthroughScore = (board, sideToMove, piecesByColor) =>
    sideToMove === undefined
        ? 0
        : [PieceColor.WHITE, PieceColor.BLACK].reduce((score, color) => {
              const sign = color === PieceColor.WHITE ? 1 : -1;
              const enemyPionRowLimit = findEnemyPionRowLimit(
                  piecesByColor[oppositeColor(color)],
                  color,
              );
              return (
                  score +
                  [...piecesByColor[color]]
                      .filter(
                          ([pos, { type }]) =>
                              type === PieceType.PION &&
                              isPassedPion(pos, color, enemyPionRowLimit),
                      )
                      .filter(
                          ([pos]) =>
                              !(
                                  sideToMove === oppositeColor(color) &&
                                  isCapturableByDame(board, pos, color)
                              ),
                      )
                      .reduce((acc, [pos]) => {
                          const bonus =
                              BREAKTHROUGH_BASE +
                              (hasOpenPathToPromotion(board, pos, color)
                                  ? BREAKTHROUGH_OPEN_PATH + proximityBonus(pos, color)
                                  : 0);
                          return acc + sign * bonus;
                      }, 0)
              );
          }, 0);

// ─── Structure (Phase 7) ───
// Pions only. Unlike Mobility and Breakthrough, nothing here depends on whose
// turn it is: "does an actual opponent attacker's capture depend on this
// landing square" and "does a friendly piece sit diagonally adjacent" are
// both facts about the board alone, so structureScore is never gated on
// context.sideToMove and is always added in evaluateBoard.
const { ISOLATED_PENALTY, BLOCKED_CAPTURE_PER_SIDE, BLOCKED_CAPTURE_CAP } = profile;

/**
 * The opponent piece that could capture the pion at `pos` by jumping in
 * direction (dx, dy) — i.e. from `pos - (dx,dy)`, landing at `pos + (dx,dy)`
 * — if that landing square were empty, or null if no such attacker exists.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} dx
 * @param {number} dy
 * @param {number} color - PieceColor of the reference side
 * @returns {Position|null}
 */
const findCaptureAttacker = (board, pos, dx, dy, color) => {
    const attacker = firstOccupiedAlongRay(board, pos.x - dx, pos.y - dy, -dx, -dy);
    return attacker === null
        ? null
        : !isOpponentPiece(board, attacker, color)
          ? null
          : board.isDamePiece(attacker)
            ? attacker
            : attacker.x !== pos.x - dx || attacker.y !== pos.y - dy
              ? null
              : pionForwardDirs(oppositeColor(color)).some(
                      ({ dx: fdx, dy: fdy }) => fdx === dx && fdy === dy,
                  )
                ? attacker
                : null;
};

/**
 * Computes support bonus if a capture path is blocked by a friendly piece.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {number}
 */
const blockedCaptureBonus = (board, pos, color) =>
    Math.min(
        DAME_DIRS.reduce((bonus, { dx, dy }) => {
            const landX = pos.x + dx;
            const landY = pos.y + dy;
            return Position.isValid(landX, landY) &&
                (() => {
                    const land = Position.fromCoords(landX, landY);
                    return (
                        board.isOccupied(land) &&
                        !isOpponentPiece(board, land, color) &&
                        findCaptureAttacker(board, pos, dx, dy, color) !== null
                    );
                })()
                ? bonus + BLOCKED_CAPTURE_PER_SIDE
                : bonus;
        }, 0),
        BLOCKED_CAPTURE_CAP,
    );

/**
 * Checks if a pion has a friendly diagonal neighbor.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @returns {boolean}
 */
const hasFriendlyDiagonalNeighbor = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const x = pos.x + dx;
        const y = pos.y + dy;
        return (
            Position.isValid(x, y) &&
            board.isOccupied(Position.fromCoords(x, y)) &&
            !isOpponentPiece(board, Position.fromCoords(x, y), color)
        );
    });

/**
 * Checks if a pion is isolated.
 * @param {import('./Board.mjs').Board} board
 * @param {Position} pos
 * @param {number} color - PieceColor
 * @param {number} enemyPionRowLimit
 * @returns {boolean}
 */
const isIsolated = (board, pos, color, enemyPionRowLimit) =>
    !hasFriendlyDiagonalNeighbor(board, pos, color) && !isPassedPion(pos, color, enemyPionRowLimit);

/**
 * Computes structural (isolated/support) score delta.
 * @param {import('./Board.mjs').Board} board
 * @returns {number}
 */
const structureScore = (board, piecesByColor) =>
    [PieceColor.WHITE, PieceColor.BLACK].reduce((score, color) => {
        const sign = color === PieceColor.WHITE ? 1 : -1;
        const enemyPionRowLimit = findEnemyPionRowLimit(piecesByColor[oppositeColor(color)], color);
        return (
            score +
            [...piecesByColor[color]]
                .filter(([, { type }]) => type === PieceType.PION)
                .reduce(
                    (acc, [pos]) =>
                        acc +
                        sign * blockedCaptureBonus(board, pos, color) -
                        (isIsolated(board, pos, color, enemyPionRowLimit)
                            ? sign * ISOLATED_PENALTY
                            : 0),
                    0,
                )
        );
    }, 0);

/**
 * Statically evaluate a board position. Positive is good for WHITE, negative
 * is good for BLACK. Material + PST + Mobility + Breakthrough + Structure.
 * @param {import('./Board.mjs').Board} board
 * @param {object} [context] Reserved for heuristics added in later phases.
 * @param {number} [context.sideToMove] PieceColor of the side to move. Gates
 *   Mobility and Breakthrough (both skipped entirely if omitted) — see
 *   mobilityScore and breakthroughScore. Structure is unaffected: it never
 *   depends on whose turn it is.
 * @returns {number}
 */
export const evaluateBoard = (board, context = {}) => {
    const piecesByColor = {
        [PieceColor.WHITE]: board.getPieces(PieceColor.WHITE),
        [PieceColor.BLACK]: board.getPieces(PieceColor.BLACK),
    };
    return (
        sideScore(piecesByColor[PieceColor.WHITE], PieceColor.WHITE) -
        sideScore(piecesByColor[PieceColor.BLACK], PieceColor.BLACK) +
        mobilityScore(board, context.sideToMove, piecesByColor) +
        breakthroughScore(board, context.sideToMove, piecesByColor) +
        structureScore(board, piecesByColor)
    );
};

/**
 * Statically evaluate a game's current position. Positive is good for WHITE.
 * @param {import('./Game.mjs').Game} game
 * @param {object} [options] Forwarded to evaluateBoard, with sideToMove filled
 *   in from the game unless the caller overrides it.
 * @returns {number}
 */
export const evaluatePosition = (game, options = {}) =>
    evaluateBoard(game.board(), {
        sideToMove: game.player(),
        ...options,
    });
