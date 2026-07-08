// Thai Checkers piece definitions
export const PieceColor = Object.freeze({
    WHITE: 0,
    BLACK: 1,
});

export const PieceType = Object.freeze({
    PION: 0,
    DAME: 1,
});

const enumValues = (enumLike) => new Set(Object.values(enumLike));

const PIECE_COLORS = enumValues(PieceColor);
const PIECE_TYPES = enumValues(PieceType);
const PIECE_COLOR_NAMES = new Map([
    [PieceColor.WHITE, 'WHITE'],
    [PieceColor.BLACK, 'BLACK'],
]);
const PIECE_TYPE_NAMES = new Map([
    [PieceType.PION, 'PION'],
    [PieceType.DAME, 'DAME'],
]);
// Terminal glyphs indexed as PIECE_SYMBOLS[isBlack][isDame].
// Intentional convention: WHITE uses the filled glyphs (\u25CF/\u25A0) and BLACK uses the
// hollow ones (\u25CB/\u25A1) \u2014 the inverse of "filled = black". Keep it in sync if the
// renderer's expectations change.
const PIECE_SYMBOLS = Object.freeze([
    Object.freeze(['\u25CF', '\u25A0']), // WHITE: pion \u25CF, dame \u25A0
    Object.freeze(['\u25CB', '\u25A1']), // BLACK: pion \u25CB, dame \u25A1
]);

export const isPieceColor = (color) => PIECE_COLORS.has(color);

export const isPieceType = (type) => PIECE_TYPES.has(type);

export const assertPieceColor = (color) => {
    if (!isPieceColor(color)) {
        throw new RangeError(`Invalid piece color: ${String(color)}`);
    }
};

export const assertPieceType = (type) => {
    if (!isPieceType(type)) {
        throw new RangeError(`Invalid piece type: ${String(type)}`);
    }
};

export const assertPieceInfo = (info) => {
    if (typeof info !== 'object' || info === null) {
        throw new TypeError('Piece info must be an object');
    }
    assertPieceColor(info.color);
    assertPieceType(info.type);
};

export const pieceSymbol = (isBlack, isDame) =>
    PIECE_SYMBOLS[Number(Boolean(isBlack))][Number(Boolean(isDame))];

export const toStringPieceColor = (color) => {
    assertPieceColor(color);
    return PIECE_COLOR_NAMES.get(color);
};

export const toStringPieceType = (type) => {
    assertPieceType(type);
    return PIECE_TYPE_NAMES.get(type);
};
