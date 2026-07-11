// Bitboard-based 8×8 Thai Checkers board (32 playable dark squares)
import { PieceColor, PieceType, assertPieceColor, assertPieceInfo } from './piece.mjs';
import { Position } from './position.mjs';

const BOARD_SQUARES = 32;
const MAX_PIECES = 16;
const MAX_ENCODED = (1n << 64n) - 1n;
const LOW_16_BITS = 0xffff;
const LOW_32_BITS = 0xffff_ffffn;
const HOME_ROWS = Object.freeze([0, 1, 6, 7]);

/** 
 * 1 << idx as unsigned 32-bit integer (idx must be an integer 0..31).
 * Guards explicitly because JS `<<` silently masks the shift count to 5 bits,
 * which would otherwise turn an out-of-range index into a wrong-bit result.
 * @param {number} idx
 * @returns {number}
 * @throws {RangeError}
 */
const bit = (idx) => {
    if (!Number.isInteger(idx) || idx < 0 || idx > 31) {
        throw new RangeError(`Bit index out of range: ${idx}`);
    }
    return (1 << idx) >>> 0;
};

/**
 * Set a bit.
 * @param {number} bits
 * @param {number} mask
 * @returns {number}
 */
const setBit = (bits, mask) => (bits | mask) >>> 0;

/**
 * Clear a bit.
 * @param {number} bits
 * @param {number} mask
 * @returns {number}
 */
const clearBit = (bits, mask) => (bits & ~mask) >>> 0;

/**
 * Computes population count using SWAR algorithm.
 * @param {number} v
 * @returns {number}
 */
const popCount32 = (v) => {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

/**
 * Asserts that the piece count is within limits.
 * @param {number} count
 * @throws {RangeError}
 */
const assertValidPieceCount = (count) => {
    if (count > MAX_PIECES) {
        throw new RangeError(`Thai checkers boards cannot contain more than ${MAX_PIECES} pieces`);
    }
};

/**
 * Asserts that a value is an unsigned 32-bit integer.
 * @param {string} name
 * @param {any} value
 * @throws {RangeError}
 */
const assertUInt32 = (name, value) => {
    if (!Number.isInteger(value) || value < 0 || value > Number(LOW_32_BITS)) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
};

/**
 * Asserts that all bitboards are valid.
 * @param {number} occBits
 * @param {number} blackBits
 * @param {number} dameBits
 * @throws {RangeError}
 */
const assertValidBitboards = (occBits, blackBits, dameBits) => {
    assertUInt32('occBits', occBits);
    assertUInt32('blackBits', blackBits);
    assertUInt32('dameBits', dameBits);
    assertValidPieceCount(popCount32(occBits));
    if ((blackBits & ~occBits) >>> 0 !== 0) {
        throw new RangeError('blackBits cannot mark empty squares');
    }
    if ((dameBits & ~occBits) >>> 0 !== 0) {
        throw new RangeError('dameBits cannot mark empty squares');
    }
};

/**
 * Helper to get piece hash key from position or index.
 * @param {Position|number} position
 * @returns {number}
 */
const toPieceKey = (position) =>
    position instanceof Position ? position.hash() : Position.fromIndex(position).hash();

// Token allowing internal transforms to build a Board from bitboards that are
// already known to satisfy the invariants, skipping the full revalidation.
const TRUSTED = Symbol('Board.trusted');

/**
 * Immutable Board representation using 32-bit bitboards.
 */
export class Board {
    // Bitboards — each bit i corresponds to Position.fromIndex(i)
    #occBits;
    #blackBits;
    #dameBits;

    /**
     * @param {number} [occBits=0]
     * @param {number} [blackBits=0]
     * @param {number} [dameBits=0]
     * @param {symbol} [trusted]
     */
    constructor(occBits = 0, blackBits = 0, dameBits = 0, trusted = undefined) {
        if (trusted !== TRUSTED) {
            assertValidBitboards(occBits, blackBits, dameBits);
        }
        this.#occBits = occBits >>> 0;
        this.#blackBits = blackBits >>> 0;
        this.#dameBits = dameBits >>> 0;
        Object.freeze(this);
    }

    /** 
     * Build from bitboards already known to satisfy the invariants (produced by
     * transforming an existing valid Board), bypassing revalidation.
     * @param {number} occBits
     * @param {number} blackBits
     * @param {number} dameBits
     * @returns {Board}
     */
    static #unchecked(occBits, blackBits, dameBits) {
        return new Board(occBits, blackBits, dameBits, TRUSTED);
    }

    // ─── Factories ───

    /**
     * Returns an empty Board.
     * @returns {Board}
     */
    static empty() {
        return new Board();
    }

    /**
     * Returns a Board in the standard starting layout.
     * @returns {Board}
     */
    static setup() {
        const { occBits, blackBits } = HOME_ROWS.reduce(
            (acc, row) => {
                const startCol = row % 2 === 0 ? 1 : 0;
                return Array.from({ length: 4 }).reduce((innerAcc, _, i) => {
                    const mask = bit(Position.fromCoords(startCol + i * 2, row).hash());
                    return {
                        occBits: setBit(innerAcc.occBits, mask),
                        blackBits: row >= 6 ? setBit(innerAcc.blackBits, mask) : innerAcc.blackBits,
                    };
                }, acc);
            },
            { occBits: 0, blackBits: 0 },
        );
        return new Board(occBits, blackBits, 0);
    }

    /**
     * Constructs a Board from an array of [position, info] pairs.
     * @param {readonly [Position, import('./piece.mjs').PieceInfo][]} pieces
     * @returns {Board}
     * @throws {Error}
     */
    static fromPieces(pieces) {
        const seen = new Set();
        const { occBits, blackBits, dameBits } = pieces.reduce(
            (acc, [position, info]) => {
                const key = toPieceKey(position);
                if (seen.has(key)) {
                    throw new Error(`Duplicate piece position: ${Position.fromIndex(key).toString()}`);
                }
                seen.add(key);
                assertPieceInfo(info);
                const mask = bit(key);
                acc.occBits = setBit(acc.occBits, mask);
                if (info.color === PieceColor.BLACK) {
                    acc.blackBits = setBit(acc.blackBits, mask);
                }
                if (info.type === PieceType.DAME) {
                    acc.dameBits = setBit(acc.dameBits, mask);
                }
                return acc;
            },
            { occBits: 0, blackBits: 0, dameBits: 0 },
        );
        assertValidPieceCount(popCount32(occBits));
        return new Board(occBits, blackBits, dameBits);
    }

    /**
     * Copy factory.
     * @param {Board} other
     * @returns {Board}
     */
    static copy(other) {
        return Board.#unchecked(other.#occBits, other.#blackBits, other.#dameBits);
    }

    /**
     * Decodes a 64-bit bigint board representation.
     * @param {bigint} encoded
     * @returns {Board}
     * @throws {RangeError|Error}
     */
    static decode(encoded) {
        if (encoded < 0n || encoded > MAX_ENCODED) {
            throw new RangeError('Encoded board must be an unsigned 64-bit value');
        }
        const occBits = Number((encoded >> 32n) & LOW_32_BITS) >>> 0;
        assertValidPieceCount(popCount32(occBits));
        const low32 = Number(encoded & LOW_32_BITS) >>> 0;

        const occupiedIndices = Array.from({ length: BOARD_SQUARES }, (_, i) => i)
            .filter((i) => (occBits & bit(i)) !== 0);

        const { blackBits, dameBits } = occupiedIndices.reduce(
            (acc, index, count) => {
                const mask = bit(index);
                const nextDameBits = (low32 & bit(count)) !== 0 ? setBit(acc.dameBits, mask) : acc.dameBits;
                const nextBlackBits = (low32 & bit(count + MAX_PIECES)) !== 0 ? setBit(acc.blackBits, mask) : acc.blackBits;
                return { dameBits: nextDameBits, blackBits: nextBlackBits };
            },
            { blackBits: 0, dameBits: 0 },
        );

        const board = new Board(occBits, blackBits, dameBits);
        if (board.encode() !== encoded) {
            throw new Error('Encoded board is not canonical');
        }
        return board;
    }

    // ─── Queries ───

    /**
     * Checks if the position is a valid board coordinate.
     * @param {Position} pos
     * @returns {boolean}
     */
    static isValidPosition(pos) {
        return Position.isValid(pos.x, pos.y);
    }

    /**
     * Checks if a square is occupied.
     * @param {Position} pos
     * @returns {boolean}
     */
    isOccupied(pos) {
        if (!Board.isValidPosition(pos)) return false;
        return (this.#occBits & bit(pos.hash())) !== 0;
    }

    /**
     * Checks if the piece at the square is black.
     * @param {Position} pos
     * @returns {boolean}
     */
    isBlackPiece(pos) {
        const mask = bit(pos.hash());
        return (this.#occBits & mask) !== 0 && (this.#blackBits & mask) !== 0;
    }

    /**
     * Checks if the piece at the square is a promoted dame.
     * @param {Position} pos
     * @returns {boolean}
     */
    isDamePiece(pos) {
        const mask = bit(pos.hash());
        return (this.#occBits & mask) !== 0 && (this.#dameBits & mask) !== 0;
    }

    /**
     * Returns a Map of active pieces for a player color.
     * @param {number} color
     * @returns {Map<Position, import('./piece.mjs').PieceInfo>}
     */
    getPieces(color) {
        assertPieceColor(color);
        const map = new Map();
        const allValid = Position.allValid();
        const occBits = this.#occBits;
        const blackBits = this.#blackBits;
        const dameBits = this.#dameBits;
        const isColorBlack = color === PieceColor.BLACK;

        let pieces = (isColorBlack ? occBits & blackBits : occBits & ~blackBits) >>> 0;
        while (pieces !== 0) {
            const mask = pieces & -pieces;
            const index = 31 - Math.clz32(mask);
            map.set(allValid[index], {
                color,
                type: (dameBits & mask) !== 0 ? PieceType.DAME : PieceType.PION,
            });
            pieces = (pieces & (pieces - 1)) >>> 0;
        }
        return map;
    }

    // ─── Transformations ───

    /**
     * Promotes the piece at the position to a dame.
     * @param {Position} pos
     * @returns {Board}
     * @throws {Error}
     */
    promotePiece(pos) {
        const mask = bit(pos.hash());
        if ((this.#occBits & mask) === 0) {
            throw new Error(`Cannot promote empty square: ${pos.toString()}`);
        }
        if ((this.#dameBits & mask) !== 0) {
            throw new Error(`Cannot promote dame piece: ${pos.toString()}`);
        }
        return Board.#unchecked(this.#occBits, this.#blackBits, setBit(this.#dameBits, mask));
    }

    /**
     * Moves a piece from one square to another.
     * @param {Position} from
     * @param {Position} to
     * @returns {Board}
     * @throws {Error}
     */
    movePiece(from, to) {
        const fm = bit(from.hash());
        const tm = bit(to.hash());
        if ((this.#occBits & fm) === 0) {
            throw new Error(`Cannot move from empty square: ${from.toString()}`);
        }
        if ((this.#occBits & tm) !== 0) {
            throw new Error(`Cannot move to occupied square: ${to.toString()}`);
        }
        const wasBlack = (this.#blackBits & fm) !== 0;
        const wasDame = (this.#dameBits & fm) !== 0;
        const occBits = setBit(clearBit(this.#occBits, fm), tm);
        const baseBlack = clearBit(this.#blackBits, fm);
        const baseDame = clearBit(this.#dameBits, fm);
        const blackBits = wasBlack ? setBit(baseBlack, tm) : baseBlack;
        const dameBits = wasDame ? setBit(baseDame, tm) : baseDame;
        return Board.#unchecked(occBits, blackBits, dameBits);
    }

    /**
     * Removes a piece from the board.
     * @param {Position} pos
     * @returns {Board}
     * @throws {Error}
     */
    removePiece(pos) {
        const mask = bit(pos.hash());
        if ((this.#occBits & mask) === 0) {
            throw new Error(`Cannot remove from empty square: ${pos.toString()}`);
        }
        return Board.#unchecked(
            clearBit(this.#occBits, mask),
            clearBit(this.#blackBits, mask),
            clearBit(this.#dameBits, mask),
        );
    }

    // ─── Encoding ───

    /**
     * Encodes the board state into a 64-bit bigint.
     * @returns {bigint}
     */
    encode() {
        let occupied = this.#occBits;
        let packedMask = 1;
        let damePacked = 0;
        let blackPacked = 0;

        while (occupied !== 0) {
            const mask = occupied & -occupied;
            if ((this.#dameBits & mask) !== 0) damePacked |= packedMask;
            if ((this.#blackBits & mask) !== 0) blackPacked |= packedMask;
            occupied = (occupied & (occupied - 1)) >>> 0;
            packedMask <<= 1;
        }

        return (
            (BigInt(this.#occBits >>> 0) << 32n) |
            (BigInt(blackPacked & LOW_16_BITS) << 16n) |
            BigInt(damePacked & LOW_16_BITS)
        );
    }

    // ─── Accessors ───

    /**
     * Occupancy bitboard.
     * @type {number}
     */
    get occBits() {
        return this.#occBits >>> 0;
    }

    /**
     * Black piece bitboard.
     * @type {number}
     */
    get blackBits() {
        return this.#blackBits >>> 0;
    }

    /**
     * Dame piece bitboard.
     * @type {number}
     */
    get dameBits() {
        return this.#dameBits >>> 0;
    }

    // ─── Equality ───

    /**
     * Checks if this board is equal to another board.
     * @param {Board} other
     * @returns {boolean}
     */
    equals(other) {
        return (
            this.#occBits === other.#occBits &&
            this.#blackBits === other.#blackBits &&
            this.#dameBits === other.#dameBits
        );
    }

    /**
     * Computes unique hash for board configuration.
     * @returns {number}
     */
    hashCode() {
        return (this.#occBits ^ this.#blackBits ^ this.#dameBits) >>> 0;
    }
}
