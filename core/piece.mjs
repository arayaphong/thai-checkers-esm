// Thai Checkers piece definitions

/**
 * @typedef {Object} PieceInfo
 * @property {number} color - The piece color (PieceColor.WHITE or PieceColor.BLACK).
 * @property {number} type - The piece type (PieceType.PION or PieceType.DAME).
 */

/**
 * @enum {number}
 */
export const PieceColor = Object.freeze({
    WHITE: 0,
    BLACK: 1,
});

/**
 * @enum {number}
 */
export const PieceType = Object.freeze({
    PION: 0,
    DAME: 1,
});

/**
 * @param {Object} enumLike
 * @returns {Set<number>}
 */
const enumValues = (enumLike) => new Set(Object.values(enumLike));

const PIECE_COLORS = enumValues(PieceColor);
const PIECE_TYPES = enumValues(PieceType);

/** @type {Map<number, string>} */
const PIECE_COLOR_NAMES = new Map([
    [PieceColor.WHITE, 'WHITE'],
    [PieceColor.BLACK, 'BLACK'],
]);

/** @type {Map<number, string>} */
const PIECE_TYPE_NAMES = new Map([
    [PieceType.PION, 'PION'],
    [PieceType.DAME, 'DAME'],
]);

/** @type {readonly (readonly string[])[]} */
const PIECE_SYMBOLS = Object.freeze([
    Object.freeze(['\u25CF', '\u25A0']), // WHITE: pion \u25CF, dame \u25A0
    Object.freeze(['\u25CB', '\u25A1']), // BLACK: pion \u25CB, dame \u25A1
]);

/**
 * Checks if the value is a valid PieceColor.
 * @param {any} color
 * @returns {boolean}
 */
export const isPieceColor = (color) => PIECE_COLORS.has(color);

/**
 * Checks if the value is a valid PieceType.
 * @param {any} type
 * @returns {boolean}
 */
export const isPieceType = (type) => PIECE_TYPES.has(type);

/**
 * Asserts that the value is a valid PieceColor.
 * @param {any} color
 * @throws {RangeError}
 */
export const assertPieceColor = (color) => {
    if (!isPieceColor(color)) {
        throw new RangeError(`Invalid piece color: ${String(color)}`);
    }
};

/**
 * Asserts that the value is a valid PieceType.
 * @param {any} type
 * @throws {RangeError}
 */
export const assertPieceType = (type) => {
    if (!isPieceType(type)) {
        throw new RangeError(`Invalid piece type: ${String(type)}`);
    }
};

/**
 * Asserts that the object is valid PieceInfo.
 * @param {any} info
 * @throws {TypeError|RangeError}
 */
export const assertPieceInfo = (info) => {
    if (typeof info !== 'object' || info === null) {
        throw new TypeError('Piece info must be an object');
    }
    assertPieceColor(info.color);
    assertPieceType(info.type);
};

/**
 * Gets the terminal glyph for a piece type and color.
 * @param {boolean} isBlack
 * @param {boolean} isDame
 * @returns {string}
 */
export const pieceSymbol = (isBlack, isDame) =>
    PIECE_SYMBOLS[Number(Boolean(isBlack))][Number(Boolean(isDame))];

/**
 * Returns string representation of PieceColor.
 * @param {number} color
 * @returns {string}
 */
export const toStringPieceColor = (color) => {
    assertPieceColor(color);
    return PIECE_COLOR_NAMES.get(color);
};

/**
 * Returns string representation of PieceType.
 * @param {number} type
 * @returns {string}
 */
export const toStringPieceType = (type) => {
    assertPieceType(type);
    return PIECE_TYPE_NAMES.get(type);
};
