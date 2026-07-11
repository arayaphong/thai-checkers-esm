// Shared, WHITE-perspective static evaluator for the sequential negamax
// (core/analyzer.js).
import { PieceColor, PieceType } from './piece.mjs';
import { Position } from './position.mjs';
import {
    WHITE_PION_DIRS, BLACK_PION_DIRS, DAME_DIRS,
    pionForwardDirs, promotionRow, isOpponentPiece,
} from './directions.mjs';

export const PIECE_VALUES = Object.freeze({
    PION: 100,
    DAME: 350,
});

// MATE_SCORE must stay far above any possible heuristic score sum so a forced
// win/loss can never be outweighed by material or positional heuristics.
export const MATE_SCORE = 100_000;

// Distinguishes near-mate scores (which bake in root-relative ply distance
// and are unsafe to cache across differing remaining-depth budgets) from
// ordinary heuristic scores (safe to cache). See core/search/negamax.js.
export const MATE_SCORE_THRESHOLD = 90_000;

const pieceValue = (type) => (type === PieceType.DAME ? PIECE_VALUES.DAME : PIECE_VALUES.PION);

// ─── Piece-Square Tables (Phase 4) ───
// Light positional preference, not a promotion-proximity signal — that's
// Breakthrough's job (Phase 6). Tables are defined once from WHITE's point of
// view (y=0 is White's back rank per core/board.mjs HOME_ROWS, y=7 is White's
// promotion row) and BLACK's table is the same values with the row mirrored
// (y -> 7-y), using symmetry where Black's table is mirrored from White's.
//
// Pion: realized range here is -12 to +19 (the target was ≈ -15 to +20 as
// starting values for tuning, not final).
// Note: Due to direct pos.y indexing, the values are mapped as
// index: y = 0 (back rank) .. 7 (promotion side).
const PION_ROW_BONUS = [12, 10, 8, 6, 4, 2, -4, 5];
const PION_COL_BONUS = [-8, -3, 3, 7, 7, 3, -3, -8]; // index: x = 0 (A-file) .. 7 (H-file)

// Dame: quite flat — Thai dames are flying kings, equally strong from most
// squares — with only a small, board-symmetric center bonus / edge-corner
// penalty. The same array serves as both the row and column bonus since the
// desired shape is symmetric in both dimensions. Realized range is exactly
// -6 to +8.
const DAME_LINE_BONUS = [-3, -1, 2, 4, 4, 2, -1, -3]; // index: rank/file position 0..7

const buildPst = (rowBonus, colBonus) =>
    Position.allValid().reduce(
        (table, pos) => { table[pos.hash()] = rowBonus[pos.y] + colBonus[pos.x]; return table; },
        new Array(Position.MAX_POSITIONS).fill(0),
    );

// Only dark squares are valid positions (x+y odd — see core/position.js), so
// flipping just the row would land on a light square. The parity-preserving
// symmetry is a 180-degree board rotation (flip both x and y): BLACK's table
// at (x, y) reads WHITE's table at the rotated square (7-x, 7-y), which maps
// BLACK's own back rank (y=0) to WHITE's back rank (y=7) as intended. Column
// bonus arrays above are themselves left-right symmetric, so the x-flip is a
// value no-op in practice; it's still needed to land on a valid square.
const mirrorPst = (whiteTable) =>
    Position.allValid().reduce(
        (table, pos) => { table[pos.hash()] = whiteTable[Position.fromCoords(7 - pos.x, 7 - pos.y).hash()]; return table; },
        new Array(Position.MAX_POSITIONS).fill(0),
    );

const PION_PST_WHITE = buildPst(PION_ROW_BONUS, PION_COL_BONUS);
const PION_PST_BLACK = mirrorPst(PION_PST_WHITE);
const DAME_PST_WHITE = buildPst(DAME_LINE_BONUS, DAME_LINE_BONUS);
const DAME_PST_BLACK = mirrorPst(DAME_PST_WHITE);

const pstValue = (type, color, pos) => {
    const table = type === PieceType.DAME
        ? (color === PieceColor.BLACK ? DAME_PST_BLACK : DAME_PST_WHITE)
        : (color === PieceColor.BLACK ? PION_PST_BLACK : PION_PST_WHITE);
    return table[pos.hash()];
};

/**
 * PST change a quiet move would cause for the piece making it — used by
 * core/search/move-order.js as a cheap (two table lookups, no board copy or
 * full evaluateBoard() call) tiebreaker among quiet moves, which otherwise
 * all sort as equal and gave alpha-beta nothing to distinguish them by once
 * Phase 4 (PST) made most positions no longer tie on material alone (due to the
 * node-count blowup this caused, resolved by the move-ordering fix).
 * Magnitude stays within ±31 (pion) / ±14 (dame) — safely below the capture
 * and promotion move-order tiers, so it only breaks ties within the quiet
 * bucket, never reorders across tiers.
 * @param {import('./board.mjs').Board} board The position before the move.
 * @param {import('./position.mjs').Position} from
 * @param {import('./position.mjs').Position} to
 * @returns {number}
 */
export const pstMoveDelta = (board, from, to) => {
    const color = board.isBlackPiece(from) ? PieceColor.BLACK : PieceColor.WHITE;
    const type = board.isDamePiece(from) ? PieceType.DAME : PieceType.PION;
    return pstValue(type, color, to) - pstValue(type, color, from);
};

const sideScore = (pieces, color) =>
    pieces.entries().reduce((acc, [pos, { type }]) =>
        acc + pieceValue(type) + pstValue(type, color, pos), 0);

// ─── Mobility (Phase 5) ───
// Direct coordinate scans only — never Explorer/game.getMoves() — so mobility
// stays cheap enough to compute at every leaf. Mirrors the direction vectors
// core/explorer.js uses for real move generation, but only counts squares
// instead of allocating move/Legals objects.

const PION_MOBILITY_PER_SQUARE = 2;
const DAME_MOBILITY_PER_SQUARE = 1;
const DAME_MOBILITY_CAP = 6;

// Recursive ray-walker: returns the first occupied Position along (x,y) →
// (x+stepX, y+stepY) → …, or null if the ray runs off the board without
// hitting a piece. Used by dameMobility, pieceHasCapture, isCapturableByDame,
// and findCaptureAttacker.
const firstOccupiedAlongRay = (board, x, y, stepX, stepY) =>
    !Position.isValid(x, y) ? null
    : board.isOccupied(Position.fromCoords(x, y)) ? Position.fromCoords(x, y)
    : firstOccupiedAlongRay(board, x + stepX, y + stepY, stepX, stepY);

const pionMobility = (board, pos, color) =>
    pionForwardDirs(color).filter(({ dx, dy }) => {
        const x = pos.x + dx;
        const y = pos.y + dy;
        return Position.isValid(x, y) && !board.isOccupied(Position.fromCoords(x, y));
    }).length * PION_MOBILITY_PER_SQUARE;

const dameRayCount = (board, x, y, dx, dy) =>
    Position.isValid(x, y) && !board.isOccupied(Position.fromCoords(x, y))
        ? 1 + dameRayCount(board, x + dx, y + dy, dx, dy)
        : 0;

const dameMobility = (board, pos) =>
    Math.min(
        DAME_DIRS.reduce((acc, { dx, dy }) => acc + dameRayCount(board, pos.x + dx, pos.y + dy, dx, dy), 0),
        DAME_MOBILITY_CAP,
    ) * DAME_MOBILITY_PER_SQUARE;

// Cheap existence check ("can this piece capture at all?"), unlike
// core/explorer.js's findValidMoves() which also builds full capture
// sequences for chain moves — not needed just to know mobility should be
// suppressed this call.

const dameHasCapture = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const blocker = firstOccupiedAlongRay(board, pos.x + dx, pos.y + dy, dx, dy);
        return blocker !== null
            && isOpponentPiece(board, blocker, color)
            && Position.isValid(blocker.x + dx, blocker.y + dy)
            && !board.isOccupied(Position.fromCoords(blocker.x + dx, blocker.y + dy));
    });

const pionHasCapture = (board, pos, color) =>
    pionForwardDirs(color).some(({ dx, dy }) => {
        const midX = pos.x + dx;
        const midY = pos.y + dy;
        const landX = pos.x + 2 * dx;
        const landY = pos.y + 2 * dy;
        return Position.isValid(midX, midY)
            && Position.isValid(landX, landY)
            && isOpponentPiece(board, Position.fromCoords(midX, midY), color)
            && !board.isOccupied(Position.fromCoords(landX, landY));
    });

const pieceHasCapture = (board, pos, color, isDame) =>
    isDame ? dameHasCapture(board, pos, color) : pionHasCapture(board, pos, color);

const hasMandatoryCapture = (board, color) =>
    board.getPieces(color).entries().some(([pos, { type }]) =>
        pieceHasCapture(board, pos, color, type === PieceType.DAME));

const sideMobility = (pieces, board, color) =>
    pieces.entries().reduce((acc, [pos, { type }]) =>
        acc + (type === PieceType.DAME ? dameMobility(board, pos) : pionMobility(board, pos, color)), 0);

// Mobility only means something in a quiet position: mandatory capture rules
// mean the side to move can't act on ordinary mobility this turn anyway (see
// core/analyzer.js's #quiescence for the same principle applied to search).
// `sideToMove` is only known when a caller supplies it (evaluatePosition()
// always does); without it mobility is skipped rather than guessed at.
const mobilityScore = (board, sideToMove) =>
    (sideToMove === undefined || hasMandatoryCapture(board, sideToMove))
        ? 0
        : sideMobility(board.getPieces(PieceColor.WHITE), board, PieceColor.WHITE)
            - sideMobility(board.getPieces(PieceColor.BLACK), board, PieceColor.BLACK);

// ─── Breakthrough (Phase 6) ───
// Pions only. A "candidate" is a pion that has passed every enemy pion's row
// AND (when it's actually the opponent's turn) isn't sitting in an immediate
// capture. Passing those two gates always earns the base bonus; a genuinely
// open (unblocked) path to promotion adds the path + proximity bonus on top.
const BREAKTHROUGH_BASE = 40;
const BREAKTHROUGH_OPEN_PATH = 20;
const BREAKTHROUGH_PROXIMITY_MIN = 10;
const BREAKTHROUGH_PROXIMITY_MAX = 30;

const oppositeColor = (color) => (color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE);

// "Passed" definition: White passed row iff its y is
// greater than every BLACK PION's y (White moves up — dames don't count);
// Black passed row iff its y is less than every WHITE PION's y (Black moves
// down). Vacuously true if the opponent has no pions left.
//
// "y > every enemy pion's y" is exactly "y > max(enemy pion y)", so the
// board only needs one O(pieces) scan per color per evaluateBoard call
// (findEnemyPionRowLimit) instead of an O(pieces) scan per candidate pion
// (an O(pieces²) blow-up on positions with many pions still on the board,
// which start/mid-game positions have plenty of).
const findEnemyPionRowLimit = (board, color) => {
    const enemyColor = oppositeColor(color);
    const reducer = color === PieceColor.WHITE
        ? (acc, y) => Math.max(acc, y)
        : (acc, y) => Math.min(acc, y);
    const initial = color === PieceColor.WHITE ? -Infinity : Infinity;
    return [...board.getPieces(enemyColor)]
        .filter(([, { type }]) => type === PieceType.PION)
        .reduce((acc, [pos]) => reducer(acc, pos.y), initial);
};

const isPassedPion = (pos, color, enemyPionRowLimit) =>
    color === PieceColor.WHITE ? pos.y > enemyPionRowLimit : pos.y < enemyPionRowLimit;

// BFS over forward-diagonal empty squares (see core/board.mjs's promotion
// rows), using a BFS/flood-fill in the forward direction up to the
// promotion row — a static reachability estimate over the current board
// snapshot, not a real multi-ply move simulation.
const hasOpenPathToPromotion = (board, pos, color) => {
    const target = promotionRow(color);
    const dirs = pionForwardDirs(color);
    const bfs = (queue, visited) =>
        queue.length === 0 ? false
        : queue[0].y === target ? true
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

// Distance-to-promotion proximity bonus, clamped to a +10..+30 target.
const proximityBonus = (pos, color) => {
    const distance = color === PieceColor.WHITE ? 7 - pos.y : pos.y;
    return Math.max(BREAKTHROUGH_PROXIMITY_MIN, BREAKTHROUGH_PROXIMITY_MAX - distance * 3);
};

// A full move generation check (Game.from(board, opponent).getMoves())
// was considered for this check; benchmarking showed it roughly doubles
// time per search node, so this directly performs a direct attack check.
//
// The direct check only needs to look for DAME attackers, never pions: a
// pion capturing "candidate" would have to sit at the candidate's y+1 for White
// (its own forward direction lands one row closer to its target, y=0), but
// "passed" requires every enemy pion to have a smaller y than White (so no
// enemy pion can sit at y >= candidate.y). Thus, a pion attacker would have
// to simultaneously violate the passed condition the candidate just satisfied.
// Only a flying dame, unconstrained by that forward-only adjacency, can
// threaten a genuinely passed pion.
const isCapturableByDame = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const landX = pos.x + dx;
        const landY = pos.y + dy;
        return Position.isValid(landX, landY)
            && !board.isOccupied(Position.fromCoords(landX, landY))
            && (() => {
                const attacker = firstOccupiedAlongRay(board, pos.x - dx, pos.y - dy, -dx, -dy);
                return attacker !== null
                    && isOpponentPiece(board, attacker, color)
                    && board.isDamePiece(attacker);
            })();
    });

// Breakthrough needs sideToMove for the same reason Mobility does (see
// mobilityScore) — condition 3 only applies "if opponent to move" — so it's
// skipped entirely without one, for the same backward-compatibility reason.
const breakthroughScore = (board, sideToMove) =>
    sideToMove === undefined ? 0
    : [PieceColor.WHITE, PieceColor.BLACK].reduce((score, color) => {
        const sign = color === PieceColor.WHITE ? 1 : -1;
        const enemyPionRowLimit = findEnemyPionRowLimit(board, color);
        return score + [...board.getPieces(color)]
            .filter(([pos, { type }]) => type === PieceType.PION && isPassedPion(pos, color, enemyPionRowLimit))
            .filter(([pos]) => !(sideToMove === oppositeColor(color) && isCapturableByDame(board, pos, color)))
            .reduce((acc, [pos]) => {
                const bonus = BREAKTHROUGH_BASE + (hasOpenPathToPromotion(board, pos, color)
                    ? BREAKTHROUGH_OPEN_PATH + proximityBonus(pos, color)
                    : 0);
                return acc + sign * bonus;
            }, 0);
    }, 0);

// ─── Structure (Phase 7) ───
// Pions only. Unlike Mobility and Breakthrough, nothing here depends on whose
// turn it is: "does an actual opponent attacker's capture depend on this
// landing square" and "does a friendly piece sit diagonally adjacent" are
// both facts about the board alone, so structureScore is never gated on
// context.sideToMove and is always added in evaluateBoard.
const ISOLATED_PENALTY = 8;
const BLOCKED_CAPTURE_PER_SIDE = 4;
const BLOCKED_CAPTURE_CAP = 8;

// The opponent piece that could capture the pion at `pos` by jumping in
// direction (dx, dy) — i.e. from `pos - (dx,dy)`, landing at `pos + (dx,dy)`
// — if that landing square were empty, or null if no such attacker exists.
// A dame can attack from anywhere along the ray (it glides over empty
// squares to the first piece it meets, per core/explorer.js's "short king"
// rule); a pion can only attack from immediate adjacency, and only along its
// own forward direction — it can't jump sideways or backward. This mirrors
// isCapturableByDame's backward scan, generalized to also recognize pion
// attackers (Breakthrough only ever needed to rule pions out; Structure's
// blocked-capture support is common precisely *because* of pion attackers).
const findCaptureAttacker = (board, pos, dx, dy, color) => {
    const attacker = firstOccupiedAlongRay(board, pos.x - dx, pos.y - dy, -dx, -dy);
    return attacker === null ? null
        : !isOpponentPiece(board, attacker, color) ? null
        : board.isDamePiece(attacker) ? attacker
        : attacker.x !== pos.x - dx || attacker.y !== pos.y - dy ? null
        : pionForwardDirs(oppositeColor(color)).some(({ dx: fdx, dy: fdy }) => fdx === dx && fdy === dy) ? attacker
        : null;
};

// A friendly piece occupying the landing square an actual opponent attacker
// would need in order to capture this pion (blocked-capture support).
// Deliberately does *not* score a friendly piece merely standing diagonally
// behind the pion with no attacker to block (avoiding a broad "supported pion"
// score), nor an empty landing square with an attacker present (that's a live
// tactical threat for Quiescence/Negamax to find, not Structure's job).
const blockedCaptureBonus = (board, pos, color) =>
    Math.min(
        DAME_DIRS.reduce((bonus, { dx, dy }) => {
            const landX = pos.x + dx;
            const landY = pos.y + dy;
            return Position.isValid(landX, landY)
                && (() => {
                    const land = Position.fromCoords(landX, landY);
                    return board.isOccupied(land)
                        && !isOpponentPiece(board, land, color)
                        && findCaptureAttacker(board, pos, dx, dy, color) !== null;
                })()
                ? bonus + BLOCKED_CAPTURE_PER_SIDE
                : bonus;
        }, 0),
        BLOCKED_CAPTURE_CAP,
    );

// Isolated: no friendly piece in any of the 4 diagonal neighbors, and the
// pion hasn't already passed every enemy pion's row. A passed pion is exempt
// — Phase 6 already proved no enemy PION can capture it, and it's racing for
// promotion rather than holding a formation, so the isolation proxy (which is
// about formation weakness) doesn't apply to it.
const hasFriendlyDiagonalNeighbor = (board, pos, color) =>
    DAME_DIRS.some(({ dx, dy }) => {
        const x = pos.x + dx;
        const y = pos.y + dy;
        return Position.isValid(x, y)
            && board.isOccupied(Position.fromCoords(x, y))
            && !isOpponentPiece(board, Position.fromCoords(x, y), color);
    });

const isIsolated = (board, pos, color, enemyPionRowLimit) =>
    !hasFriendlyDiagonalNeighbor(board, pos, color) && !isPassedPion(pos, color, enemyPionRowLimit);

const structureScore = (board) =>
    [PieceColor.WHITE, PieceColor.BLACK].reduce((score, color) => {
        const sign = color === PieceColor.WHITE ? 1 : -1;
        const enemyPionRowLimit = findEnemyPionRowLimit(board, color);
        return score + [...board.getPieces(color)]
            .filter(([, { type }]) => type === PieceType.PION)
            .reduce((acc, [pos]) =>
                acc + sign * blockedCaptureBonus(board, pos, color)
                    - (isIsolated(board, pos, color, enemyPionRowLimit) ? sign * ISOLATED_PENALTY : 0),
            0);
    }, 0);

// ─── Immediate Draw (per docs/กฎการเสมอในเกมหมากฮอส.md) ───
// With no mandatory capture pending for sideToMove, a position is an
// immediate draw once both sides hold at least one dame, at most one pion
// each, a combined piece count of at most 7, and a piece-count difference of
// at most 1 — exactly the 17 endings that document's §3 tabulates.
const IMMEDIATE_DRAW_MAX_PIONS = 1;
const IMMEDIATE_DRAW_MAX_TOTAL_PIECES = 7;
const IMMEDIATE_DRAW_MAX_PIECE_DIFF = 1;

const countPionsAndDames = (board, color) =>
    [...board.getPieces(color)].reduce(
        (acc, [, { type }]) => type === PieceType.DAME
            ? { pions: acc.pions, dames: acc.dames + 1 }
            : { pions: acc.pions + 1, dames: acc.dames },
        { pions: 0, dames: 0 },
    );

/**
 * True if `board` is an immediate draw per docs/กฎการเสมอในเกมหมากฮอส.md.
 * Reuses the same direct-scan hasMandatoryCapture Mobility/Breakthrough rely
 * on (not full move generation), so this stays cheap enough to call at every
 * search node — see core/analyzer.js's #negamax/#quiescence and
 * core/search/negamax.js, which both score an immediate draw as a loss for
 * sideToMove (same -MATE_SCORE + plyFromRoot convention as having no legal
 * moves at all), rather than the neutral score a genuine mutual draw would
 * otherwise get.
 * @param {import('./board.mjs').Board} board
 * @param {number} sideToMove PieceColor of the side to move.
 * @returns {boolean}
 */
export const isImmediateDraw = (board, sideToMove) =>
    !hasMandatoryCapture(board, sideToMove)
    && (() => {
        const white = countPionsAndDames(board, PieceColor.WHITE);
        const black = countPionsAndDames(board, PieceColor.BLACK);
        const whiteTotal = white.pions + white.dames;
        const blackTotal = black.pions + black.dames;
        return white.dames >= 1
            && black.dames >= 1
            && white.pions <= IMMEDIATE_DRAW_MAX_PIONS
            && black.pions <= IMMEDIATE_DRAW_MAX_PIONS
            && whiteTotal + blackTotal <= IMMEDIATE_DRAW_MAX_TOTAL_PIECES
            && Math.abs(whiteTotal - blackTotal) <= IMMEDIATE_DRAW_MAX_PIECE_DIFF;
    })();

/**
 * Statically evaluate a board position. Positive is good for WHITE, negative
 * is good for BLACK. Material + PST + Mobility + Breakthrough + Structure.
 * @param {import('./board.mjs').Board} board
 * @param {object} [context] Reserved for heuristics added in later phases.
 * @param {number} [context.sideToMove] PieceColor of the side to move. Gates
 *   Mobility and Breakthrough (both skipped entirely if omitted) — see
 *   mobilityScore and breakthroughScore. Structure is unaffected: it never
 *   depends on whose turn it is.
 * @returns {number}
 */
export const evaluateBoard = (board, context = {}) =>
    sideScore(board.getPieces(PieceColor.WHITE), PieceColor.WHITE)
        - sideScore(board.getPieces(PieceColor.BLACK), PieceColor.BLACK)
        + mobilityScore(board, context.sideToMove)
        + breakthroughScore(board, context.sideToMove)
        + structureScore(board);

/**
 * Statically evaluate a game's current position. Positive is good for WHITE.
 * @param {import('./game.mjs').Game} game
 * @param {object} [options] Forwarded to evaluateBoard, with sideToMove filled
 *   in from the game unless the caller overrides it.
 * @returns {number}
 */
export const evaluatePosition = (game, options = {}) =>
    evaluateBoard(game.board(), {
        sideToMove: game.player(),
        ...options,
    });
