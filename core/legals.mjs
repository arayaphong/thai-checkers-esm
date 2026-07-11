// Legal moves container — digests regular positions or capture sequences into uniform MoveInfo
import { Position } from './position.mjs';

const LEGALS_CONSTRUCTOR_TOKEN = Symbol('Legals.constructor');

const assertValidIndex = (method, index, length) => {
    if (!Number.isInteger(index)) {
        throw new RangeError(`${method}: index must be an integer`);
    }
    if (index < 0 || index >= length) {
        throw new RangeError(`${method}: index out of range`);
    }
};
const copyMoveInfo = (move) => ({
    targetPosition: move.targetPosition,
    capturedPositions: [...move.capturedPositions],
    path: [...move.path],
    sequence: move.sequence?.toSpliced(),
});

const assertPosition = (value, context) => {
    if (!(value instanceof Position)) {
        throw new TypeError(`${context} must be a Position`);
    }
};

const assertValidCaptureSequence = (seq, context = 'Capture sequence') => {
    if (seq.length === 0 || seq.length % 2 !== 0) {
        throw new Error('Capture sequence must contain captured/landing position pairs');
    }
    for (const [index, position] of seq.entries()) {
        assertPosition(position, `${context} item ${index}`);
    }
};

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

const processRegularMove = (position, index) => {
    assertPosition(position, `Regular move ${index}`);
    return {
        targetPosition: position,
        capturedPositions: [],
        path: [position],
        sequence: undefined,
    };
};

export class CaptureTrace {
    #sequence;
    constructor(sequence) {
        assertValidCaptureSequence(sequence, 'CaptureTrace sequence');
        this.#sequence = Object.freeze([...sequence]);
    }
    get sequence() {
        return this.#sequence;
    }
    get length() {
        return this.#sequence.length / 2;
    }
    get captured() {
        return this.#sequence
            .values()
            .filter((_, index) => index % 2 === 0)
            .toArray();
    }
    path(from) {
        return [
            from,
            ...this.#sequence
                .values()
                .filter((_, index) => index % 2 === 1)
                .toArray(),
        ];
    }
    get finalLanding() {
        return this.#sequence.at(-1);
    }
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
export class Legals {
    #moves;
    #hasCaptures;
    constructor(token, moves, hasCaptures) {
        if (token !== LEGALS_CONSTRUCTOR_TOKEN) {
            throw new TypeError('Use Legals.fromRegularMoves() or Legals.fromCaptures()');
        }
        this.#moves = moves;
        this.#hasCaptures = hasCaptures;
    }
    static fromRegularMoves(positions) {
        return new Legals(LEGALS_CONSTRUCTOR_TOKEN, positions.map(processRegularMove), false);
    }
    static fromCaptures(captureSequences) {
        const moves = captureSequences.map((sequence, index) => {
            if (!Array.isArray(sequence)) {
                throw new TypeError(`Capture move ${index} must be a capture sequence`);
            }
            return processCaptureSequence(sequence);
        });
        return new Legals(LEGALS_CONSTRUCTOR_TOKEN, moves, moves.length > 0);
    }
    hasCaptured() {
        return this.#hasCaptures;
    }
    size() {
        return this.#moves.length;
    }
    empty() {
        return this.#moves.length === 0;
    }
    getPosition(index) {
        assertValidIndex('Legals.getPosition', index, this.#moves.length);
        return this.#moves[index].targetPosition;
    }
    getCapturePieces(index) {
        if (!this.#hasCaptures) {
            throw new Error('Legals.getCapturePieces: not a capture variant');
        }
        assertValidIndex('Legals.getCapturePieces', index, this.#moves.length);
        return [...this.#moves[index].capturedPositions];
    }
    getMoveInfo(index) {
        assertValidIndex('Legals.getMoveInfo', index, this.#moves.length);
        return copyMoveInfo(this.#moves[index]);
    }
    getTrace(index) {
        if (!this.#hasCaptures) {
            return undefined;
        }
        assertValidIndex('Legals.getTrace', index, this.#moves.length);
        return new CaptureTrace([...this.#moves[index].sequence]);
    }
    [Symbol.iterator]() {
        return this.#moves.values().map(copyMoveInfo);
    }
}
