// Bitboard-based 8×8 Thai Checkers board (32 playable dark squares)
import { PieceColor, PieceType, assertPieceColor, assertPieceInfo } from './piece.mjs';
import { Position } from './position.mjs';

const BOARD_SQUARES = 32;
const MAX_PIECES = 16;
const MAX_ENCODED = (1n << 64n) - 1n;
const LOW_16_BITS = 0xffff;
const LOW_32_BITS = 0xffff_ffffn;
const HOME_ROWS = Object.freeze([0, 1, 6, 7]);

/** 1 << idx as unsigned 32-bit integer (idx must be an integer 0..31).
 *  Guards explicitly because JS `<<` silently masks the shift count to 5 bits,
 *  which would otherwise turn an out-of-range index into a wrong-bit result. */
const bit = (idx) => {
    if (!Number.isInteger(idx) || idx < 0 || idx > 31) {
        throw new RangeError(`Bit index out of range: ${idx}`);
    }
    return (1 << idx) >>> 0;
};

const setBit = (bits, mask) => (bits | mask) >>> 0;

const clearBit = (bits, mask) => (bits & ~mask) >>> 0;

const popCount32 = (v) => {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

const assertValidPieceCount = (count) => {
    if (count > MAX_PIECES) {
        throw new RangeError(`Thai checkers boards cannot contain more than ${MAX_PIECES} pieces`);
    }
};

const assertUInt32 = (name, value) => {
    if (!Number.isInteger(value) || value < 0 || value > Number(LOW_32_BITS)) {
        throw new RangeError(`${name} must be an unsigned 32-bit integer`);
    }
};

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

const toPieceKey = (position) =>
    position instanceof Position ? position.hash() : Position.fromIndex(position).hash();

// Token allowing internal transforms to build a Board from bitboards that are
// already known to satisfy the invariants, skipping the full revalidation.
const TRUSTED = Symbol('Board.trusted');

export class Board {
    // Bitboards — each bit i corresponds to Position.fromIndex(i)
    #occBits;
    #blackBits;
    #dameBits;
    constructor(occBits = 0, blackBits = 0, dameBits = 0, trusted = undefined) {
        if (trusted !== TRUSTED) {
            assertValidBitboards(occBits, blackBits, dameBits);
        }
        this.#occBits = occBits >>> 0;
        this.#blackBits = blackBits >>> 0;
        this.#dameBits = dameBits >>> 0;
        Object.freeze(this);
    }
    /** Build from bitboards already known to satisfy the invariants (produced by
     *  transforming an existing valid Board), bypassing revalidation. */
    static #unchecked(occBits, blackBits, dameBits) {
        return new Board(occBits, blackBits, dameBits, TRUSTED);
    }
    // ─── Factories ───
    static empty() {
        return new Board();
    }
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
    static fromPieces(pieces) {
        let occBits = 0;
        let blackBits = 0;
        let dameBits = 0;
        const seen = new Set();
        pieces.forEach(([position, info]) => {
            const key = toPieceKey(position);
            if (seen.has(key)) {
                throw new Error(`Duplicate piece position: ${Position.fromIndex(key).toString()}`);
            }
            seen.add(key);
            assertPieceInfo(info);
            const mask = bit(key);
            occBits = setBit(occBits, mask);
            if (info.color === PieceColor.BLACK) {
                blackBits = setBit(blackBits, mask);
            }
            if (info.type === PieceType.DAME) {
                dameBits = setBit(dameBits, mask);
            }
        });
        assertValidPieceCount(popCount32(occBits));
        return new Board(occBits, blackBits, dameBits);
    }
    static copy(other) {
        return Board.#unchecked(other.#occBits, other.#blackBits, other.#dameBits);
    }
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
    static isValidPosition(pos) {
        return Position.isValid(pos.x, pos.y);
    }
    isOccupied(pos) {
        if (!Board.isValidPosition(pos)) return false;
        return (this.#occBits & bit(pos.hash())) !== 0;
    }
    isBlackPiece(pos) {
        const mask = bit(pos.hash());
        return (this.#occBits & mask) !== 0 && (this.#blackBits & mask) !== 0;
    }
    isDamePiece(pos) {
        const mask = bit(pos.hash());
        return (this.#occBits & mask) !== 0 && (this.#dameBits & mask) !== 0;
    }
    getPieces(color) {
        assertPieceColor(color);
        return new Map(
            Position.allValid()
                .values()
                .filter((pos) => (this.#occBits & bit(pos.hash())) !== 0)
                .filter((pos) => (color === PieceColor.BLACK) === this.isBlackPiece(pos))
                .map((pos) => {
                    const mask = bit(pos.hash());
                    const isBlack = (this.#blackBits & mask) !== 0;
                    const isDame = (this.#dameBits & mask) !== 0;
                    return [
                        pos,
                        {
                            color: isBlack ? PieceColor.BLACK : PieceColor.WHITE,
                            type: isDame ? PieceType.DAME : PieceType.PION,
                        },
                    ];
                }),
        );
    }
    // ─── Transformations ───
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
        let blackBits = clearBit(this.#blackBits, fm);
        let dameBits = clearBit(this.#dameBits, fm);
        if (wasBlack) blackBits = setBit(blackBits, tm);
        if (wasDame) dameBits = setBit(dameBits, tm);
        return Board.#unchecked(occBits, blackBits, dameBits);
    }
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
    encode() {
        const occupiedIndices = Array.from({ length: BOARD_SQUARES }, (_, i) => i)
            .filter((i) => (this.#occBits & bit(i)) !== 0);

        const { damePacked, blackPacked } = occupiedIndices.reduce(
            (acc, index, count) => {
                const mask = bit(index);
                return {
                    damePacked: (this.#dameBits & mask) !== 0 ? acc.damePacked | bit(count) : acc.damePacked,
                    blackPacked: (this.#blackBits & mask) !== 0 ? acc.blackPacked | bit(count) : acc.blackPacked,
                };
            },
            { damePacked: 0, blackPacked: 0 },
        );

        return (
            (BigInt(this.#occBits >>> 0) << 32n) |
            (BigInt(blackPacked & LOW_16_BITS) << 16n) |
            BigInt(damePacked & LOW_16_BITS)
        );
    }
    // ─── Accessors ───
    get occBits() {
        return this.#occBits >>> 0;
    }
    get blackBits() {
        return this.#blackBits >>> 0;
    }
    get dameBits() {
        return this.#dameBits >>> 0;
    }
    // ─── Equality ───
    equals(other) {
        return (
            this.#occBits === other.#occBits &&
            this.#blackBits === other.#blackBits &&
            this.#dameBits === other.#dameBits
        );
    }
    hashCode() {
        return (this.#occBits ^ this.#blackBits ^ this.#dameBits) >>> 0;
    }
}
