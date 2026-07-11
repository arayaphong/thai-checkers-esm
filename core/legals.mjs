// Legal moves container — digests regular positions or capture sequences into uniform MoveInfo
import { Position } from './position.mjs';

/**
 * @typedef {Object} MoveInfo
 * @property {Position} targetPosition - Final landing position.
 * @property {Position[]} capturedPositions - Captured piece positions.
 * @property {Position[]} path - The landing waypoint sequence.
 * @property {Position[]|undefined} sequence - Original raw coordinate sequence if capture, otherwise undefined.
 */

const LEGALS_CONSTRUCTOR_TOKEN = Symbol('Legals.constructor');

/**
 * Asserts index is within legal range.
 * @param {string} method
 * @param {number} index
 * @param {number} length
 * @throws {RangeError}
 */
const assertValidIndex = (method, index, length) => {
    if (!Number.isInteger(index)) {
        throw new RangeError(`${method}: index must be an integer`);
    }
    if (index < 0 || index >= length) {
        throw new RangeError(`${method}: index out of range`);
    }
};

/**
 * Deep copies MoveInfo.
 * @param {MoveInfo} move
 * @returns {MoveInfo}
 */
const copyMoveInfo = (move) => ({
    targetPosition: move.targetPosition,
    capturedPositions: [...move.capturedPositions],
    path: [...move.path],
    sequence: move.sequence?.toSpliced(),
});

/**
 * Asserts the value is a Position.
 * @param {any} value
 * @param {string} context
 * @throws {TypeError}
 */
const assertPosition = (value, context) => {
    if (!(value instanceof Position)) {
        throw new TypeError(`${context} must be a Position`);
    }
};

/**
 * Asserts the sequence is a valid capture path.
 * @param {Position[]} seq
 * @param {string} [context='Capture sequence']
 * @throws {Error|TypeError}
 */
const assertValidCaptureSequence = (seq, context = 'Capture sequence') => {
    if (seq.length === 0 || seq.length % 2 !== 0) {
        throw new Error('Capture sequence must contain captured/landing position pairs');
    }
    seq.forEach((position, index) => {
        assertPosition(position, `${context} item ${index}`);
    });
};

/**
 * Processes a raw capture sequence into MoveInfo.
 * @param {Position[]} seq
 * @returns {MoveInfo}
 */
const processCaptureSequence = (seq) => {
    assertValidCaptureSequence(seq);
    // Even indices = captured pieces, odd indices = landing positions
    const captured = seq
        .values()
        .filter((_, index) => index % 2 === 0)
        .toArray();
    const path = seq
        .values()
        .filter((_, index) => index % 2 === 1)
        .toArray();
    return {
        targetPosition: seq.at(-1), // last element = final landing
        capturedPositions: captured,
        path,
        sequence: seq,
    };
};

/**
 * Processes a regular landing square into MoveInfo.
 * @param {Position} position
 * @param {number} index
 * @returns {MoveInfo}
 */
const processRegularMove = (position, index) => {
    assertPosition(position, `Regular move ${index}`);
    return {
        targetPosition: position,
        capturedPositions: [],
        path: [position],
        sequence: undefined,
    };
};

/**
 * Represents the trace path of a capturing sequence.
 */
export class CaptureTrace {
    #sequence;

    /**
     * @param {readonly Position[]} sequence
     */
    constructor(sequence) {
        assertValidCaptureSequence(sequence, 'CaptureTrace sequence');
        this.#sequence = Object.freeze([...sequence]);
    }

    /**
     * Returns the raw sequence.
     * @type {readonly Position[]}
     */
    get sequence() {
        return this.#sequence;
    }

    /**
     * Returns the number of captures in this trace.
     * @type {number}
     */
    get length() {
        return this.#sequence.length / 2;
    }

    /**
     * Returns the list of captured coordinates.
     * @type {Position[]}
     */
    get captured() {
        return this.#sequence
            .values()
            .filter((_, index) => index % 2 === 0)
            .toArray();
    }

    /**
     * Reconstructs the movement path.
     * @param {Position} from
     * @returns {Position[]}
     */
    path(from) {
        return [
            from,
            ...this.#sequence
                .values()
                .filter((_, index) => index % 2 === 1)
                .toArray(),
        ];
    }

    /**
     * Returns the final square.
     * @type {Position}
     */
    get finalLanding() {
        return this.#sequence.at(-1);
    }

    /**
     * Returns a human readable trace representation.
     * @returns {string}
     */
    toString() {
        return this.#sequence
            .values()
            .filter((_, index) => index % 2 === 0)
            .map(
                (captured, index) =>
                    `×${captured.toString()} →${this.#sequence[index * 2 + 1].toString()}`,
            )
            .toArray()
            .join(' ');
    }
}

/**
 * Container for valid move candidates generated for a square.
 */
export class Legals {
    #moves;
    #hasCaptures;

    /**
     * @param {symbol} token
     * @param {MoveInfo[]} moves
     * @param {boolean} hasCaptures
     */
    constructor(token, moves, hasCaptures) {
        if (token !== LEGALS_CONSTRUCTOR_TOKEN) {
            throw new TypeError('Use Legals.fromRegularMoves() or Legals.fromCaptures()');
        }
        this.#moves = moves;
        this.#hasCaptures = hasCaptures;
    }

    /**
     * Factory from plain target squares.
     * @param {Position[]} positions
     * @returns {Legals}
     */
    static fromRegularMoves(positions) {
        return new Legals(LEGALS_CONSTRUCTOR_TOKEN, positions.map(processRegularMove), false);
    }

    /**
     * Factory from multiple capture sequences.
     * @param {Position[][]} captureSequences
     * @returns {Legals}
     */
    static fromCaptures(captureSequences) {
        const moves = captureSequences.map((sequence, index) => {
            if (!Array.isArray(sequence)) {
                throw new TypeError(`Capture move ${index} must be a capture sequence`);
            }
            return processCaptureSequence(sequence);
        });
        return new Legals(LEGALS_CONSTRUCTOR_TOKEN, moves, moves.length > 0);
    }

    /**
     * True if the options represent capturing actions.
     * @returns {boolean}
     */
    hasCaptured() {
        return this.#hasCaptures;
    }

    /**
     * Number of available target candidates.
     * @returns {number}
     */
    size() {
        return this.#moves.length;
    }

    /**
     * True if no options are available.
     * @returns {boolean}
     */
    empty() {
        return this.#moves.length === 0;
    }

    /**
     * Gets landing coordinate at index.
     * @param {number} index
     * @returns {Position}
     */
    getPosition(index) {
        assertValidIndex('Legals.getPosition', index, this.#moves.length);
        return this.#moves[index].targetPosition;
    }

    /**
     * Gets captured coordinates list at index.
     * @param {number} index
     * @returns {Position[]}
     */
    getCapturePieces(index) {
        if (!this.#hasCaptures) {
            throw new Error('Legals.getCapturePieces: not a capture variant');
        }
        assertValidIndex('Legals.getCapturePieces', index, this.#moves.length);
        return [...this.#moves[index].capturedPositions];
    }

    /**
     * Gets MoveInfo at index.
     * @param {number} index
     * @returns {MoveInfo}
     */
    getMoveInfo(index) {
        assertValidIndex('Legals.getMoveInfo', index, this.#moves.length);
        return copyMoveInfo(this.#moves[index]);
    }

    /**
     * Gets CaptureTrace at index.
     * @param {number} index
     * @returns {CaptureTrace|undefined}
     */
    getTrace(index) {
        if (!this.#hasCaptures) {
            return undefined;
        }
        assertValidIndex('Legals.getTrace', index, this.#moves.length);
        return new CaptureTrace([...this.#moves[index].sequence]);
    }

    /**
     * Iterates over available MoveInfo candidates.
     * @returns {Iterator<MoveInfo>}
     */
    [Symbol.iterator]() {
        return this.#moves.values().map(copyMoveInfo);
    }
}
