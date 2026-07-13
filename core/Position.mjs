// Board position — only black squares on 8×8 board (32 playable squares)
// Index 0..31 maps to coordinates where (x+y) is even.
const BOARD_SIZE = 8;
const BOARD_HALF_SIZE = BOARD_SIZE / 2;
const MAX_POSITIONS = (BOARD_SIZE * BOARD_SIZE) / 2; // 32
const FIRST_COLUMN_CODE = 'A'.charCodeAt(0);
const POSITION_PATTERN = /^(?<col>[A-H])(?<row>[1-8])$/;

/**
 * Asserts that the position index is valid.
 * @param {number} index
 * @throws {RangeError}
 */
const assertValidIndex = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_POSITIONS) {
        throw new RangeError(`Invalid position index: ${index}`);
    }
};

/**
 * Represents a playable dark square on the 8x8 checkers board.
 */
export class Position {
    static BOARD_SIZE = BOARD_SIZE;
    static MAX_POSITIONS = MAX_POSITIONS;
    #index;
    #x;
    #y;

    /**
     * Internal: construct from validated index.
     * Use static factory methods fromIndex, fromCoords, or fromString instead.
     * @param {number} index
     */
    constructor(index) {
        assertValidIndex(index);
        this.#index = index;
        const y = Math.floor(index / BOARD_HALF_SIZE);
        const xBase = (index % BOARD_HALF_SIZE) * 2;
        this.#x = xBase + ((xBase + y) % 2 === 0 ? 0 : 1);
        this.#y = y;
    }

    /**
     * Factory from coordinates. Throws if not a valid black square.
     * @param {number} x - 0-based column index (0..7)
     * @param {number} y - 0-based row index (0..7)
     * @returns {Position}
     * @throws {Error}
     */
    static fromCoords(x, y) {
        if (!Position.isValid(x, y)) {
            throw new Error(`Invalid coordinates: (${x}, ${y})`);
        }
        const index = Math.floor(x / 2) + BOARD_HALF_SIZE * y;
        return new Position(index);
    }

    /**
     * Factory from 0-based index (0..31).
     * @param {number} index
     * @returns {Position}
     */
    static fromIndex(index) {
        return new Position(index);
    }

    /**
     * Factory from algebraic notation, e.g. "C4".
     * @param {string} s
     * @returns {Position}
     * @throws {Error}
     */
    static fromString(s) {
        const match = POSITION_PATTERN.exec(s);
        if (!match) throw new Error(`Invalid position string: "${s}"`);
        const { col, row } = match.groups;
        const x = col.charCodeAt(0) - FIRST_COLUMN_CODE;
        const y = Number(row) - 1;
        return Position.fromCoords(x, y);
    }

    /**
     * True if (x,y) is a valid black square on the board.
     * @param {number} x
     * @param {number} y
     * @returns {boolean}
     */
    static isValid(x, y) {
        return (
            Number.isInteger(x) &&
            Number.isInteger(y) &&
            x >= 0 &&
            x < BOARD_SIZE &&
            y >= 0 &&
            y < BOARD_SIZE &&
            (x + y) % 2 === 0
        );
    }

    /**
     * 0-based column index (0..7).
     * @type {number}
     */
    get x() {
        return this.#x;
    }

    /**
     * 0-based row index (0..7).
     * @type {number}
     */
    get y() {
        return this.#y;
    }

    /**
     * Hash = internal index (0..31), suitable for Map keys.
     * @returns {number}
     */
    hash() {
        return this.#index;
    }

    /**
     * String representation in algebraic notation (e.g. "C4").
     * @returns {string}
     */
    toString() {
        return `${String.fromCharCode(FIRST_COLUMN_CODE + this.x)}${this.y + 1}`;
    }

    /**
     * Equality check.
     * @param {Position} other
     * @returns {boolean}
     */
    equals(other) {
        return this.#index === other.#index;
    }

    /**
     * Comparison for sorting (by index).
     * @param {Position} other
     * @returns {number}
     */
    compare(other) {
        return this.#index - other.#index;
    }

    // --- All valid positions (precomputed) ---
    /** @type {readonly Position[]} */
    static #allValid;
    static {
        Position.#allValid = Object.freeze(
            Array.from({ length: MAX_POSITIONS }, (_, index) => new Position(index)),
        );
    }

    /**
     * Returns a list of all 32 valid positions on the board.
     * @returns {readonly Position[]}
     */
    static allValid() {
        return Position.#allValid;
    }
}
