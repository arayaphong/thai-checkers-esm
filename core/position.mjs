// Board position — only black squares on 8×8 board (32 playable squares)
// Index 0..31 maps to coordinates where (x+y) is odd.
const BOARD_SIZE = 8;
const BOARD_HALF_SIZE = BOARD_SIZE / 2;
const MAX_POSITIONS = (BOARD_SIZE * BOARD_SIZE) / 2; // 32
const FIRST_COLUMN_CODE = 'A'.charCodeAt(0);
const POSITION_PATTERN = /^(?<col>[A-H])(?<row>[1-8])$/;

const assertValidIndex = (index) => {
    if (!Number.isInteger(index) || index < 0 || index >= MAX_POSITIONS) {
        throw new RangeError(`Invalid position index: ${index}`);
    }
};

export class Position {
    static BOARD_SIZE = BOARD_SIZE;
    static MAX_POSITIONS = MAX_POSITIONS;
    #index;
    /** Internal: construct from validated index. */
    constructor(index) {
        assertValidIndex(index);
        this.#index = index;
    }
    /** Factory from coordinates. Throws if not a valid black square. */
    static fromCoords(x, y) {
        if (!Position.isValid(x, y)) {
            throw new Error(`Invalid coordinates: (${x}, ${y})`);
        }
        const index = Math.floor(x / 2) + (BOARD_HALF_SIZE * y);
        return new Position(index);
    }
    /** Factory from 0-based index (0..31). */
    static fromIndex(index) {
        return new Position(index);
    }
    /** Factory from algebraic notation, e.g. "C4". */
    static fromString(s) {
        const match = POSITION_PATTERN.exec(s);
        if (!match)
            throw new Error(`Invalid position string: "${s}"`);
        const { col, row } = match.groups;
        const x = col.charCodeAt(0) - FIRST_COLUMN_CODE;
        const y = Number(row) - 1;
        return Position.fromCoords(x, y);
    }
    /** True if (x,y) is a valid black square on the board. */
    static isValid(x, y) {
        return (Number.isInteger(x) &&
            Number.isInteger(y) &&
            x >= 0 && x < BOARD_SIZE &&
            y >= 0 && y < BOARD_SIZE &&
            (x + y) % 2 === 1);
    }
    get x() {
        const y = Math.floor(this.#index / BOARD_HALF_SIZE);
        const xBase = (this.#index % BOARD_HALF_SIZE) * 2;
        return xBase + ((xBase + y) % 2 === 0 ? 1 : 0);
    }
    get y() {
        return Math.floor(this.#index / BOARD_HALF_SIZE);
    }
    /** Hash = internal index (0..31), suitable for Map keys. */
    hash() {
        return this.#index;
    }
    toString() {
        return `${String.fromCharCode(FIRST_COLUMN_CODE + this.x)}${this.y + 1}`;
    }
    // Equality
    equals(other) {
        return this.#index === other.#index;
    }
    // Comparison for sorting
    compare(other) {
        return this.#index - other.#index;
    }
    // --- All valid positions (precomputed) ---
    static #allValid;
    static {
        Position.#allValid = Object.freeze(
            Array.from({ length: MAX_POSITIONS }, (_, index) => new Position(index)),
        );
    }
    static allValid() {
        return Position.#allValid;
    }
}
