// Shared direction vectors and small helpers used by both move generation
// (core/Explorer.mjs) and static evaluation (core/evaluation.mjs).
import { PieceColor } from './piece.mjs';

/**
 * @typedef {Object} Direction
 * @property {number} dx
 * @property {number} dy
 */

/**
 * Freezes the direction vectors.
 * @param {Direction[]} dirs
 * @returns {readonly Direction[]}
 */
const freezeDirs = (dirs) => Object.freeze(dirs.map((dir) => Object.freeze(dir)));

/** @type {readonly Direction[]} */
export const WHITE_PION_DIRS = freezeDirs([
    { dx: -1, dy: 1 },
    { dx: 1, dy: 1 },
]);

/** @type {readonly Direction[]} */
export const BLACK_PION_DIRS = freezeDirs([
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
]);

/** @type {readonly Direction[]} */
export const DAME_DIRS = freezeDirs([
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: 1 },
]);

/**
 * Forward-diagonal direction vectors for a pion of `color`.
 * @param {number} color PieceColor
 * @returns {readonly Direction[]}
 */
export const pionForwardDirs = (color) =>
    color === PieceColor.BLACK ? BLACK_PION_DIRS : WHITE_PION_DIRS;

/**
 * The y-coordinate of the promotion row for `color` (0 for WHITE, 7 for BLACK).
 * @param {number} color PieceColor
 * @returns {number}
 */
export const promotionRow = (color) => (color === PieceColor.WHITE ? 7 : 0);

/**
 * True when `pos` is occupied by an opponent piece of `color`.
 * @param {import('./Board.mjs').Board} board
 * @param {import('./Position.mjs').Position} pos
 * @param {number} color PieceColor of the reference side
 * @returns {boolean}
 */
export const isOpponentPiece = (board, pos, color) =>
    board.isOccupied(pos) && (color === PieceColor.WHITE) === board.isBlackPiece(pos);
