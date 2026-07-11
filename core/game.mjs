// Thai Checkers game state machine
import { PieceColor, assertPieceColor } from './piece.mjs';
import { Board } from './board.mjs';
import { Explorer } from './explorer.mjs';
import { CaptureTrace } from './legals.mjs';

const copyMove = (move) => ({
    from: move.from,
    to: move.to,
    captured: [...move.captured],
    path: [...move.path],
    trace: move.trace,
});

const moveIdentityKey = (move) => {
    const sortedCaptured = move.captured.map((pos) => pos.hash()).toSorted();
    return `${move.from.hash()}:${move.to.hash()}:${sortedCaptured.toString()}`;
};

const uniqueMoves = (moves) => {
    const seen = new Set();
    return moves.filter((move) => {
        const key = moveIdentityKey(move);
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const oppositeColor = (color) => color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;

export class Game {
    #boardHistory = [];
    #encodedHistory = [];
    #indexHistory = [];
    // Side to move at ply 0 (indexHistory.length === 0). Games constructed via the
    // regular constructor always start with WHITE.
    #rootPlayer = PieceColor.WHITE;
    // Caches
    #choicesDirty = true;
    #choicesCache = [];
    #moveableDirty = true;
    #moveableCache = new Map();
    #moveCountCache = 0;
    #sortedPositionsCache = [];
    // ─── Constructors ───
    constructor(board) {
        const initial = board ?? Board.setup();
        this.#boardHistory.push(initial);
        this.#encodedHistory.push(initial.encode());
    }
    static copy(other) {
        const g = new Game();
        g.#boardHistory = other.#boardHistory.map(b => Board.copy(b));
        g.#encodedHistory = [...other.#encodedHistory];
        g.#indexHistory = [...other.#indexHistory];
        g.#rootPlayer = other.#rootPlayer;
        g.#choicesDirty = true;
        g.#moveableDirty = true;
        return g;
    }
    /**
     * Build a Game rooted at an arbitrary board with an explicit side to move,
     * and no move history.
     * @param {import('./board.mjs').Board} board
     * @param {number} sideToMove PieceColor of the player to move at this board.
     */
    static from(board, sideToMove) {
        assertPieceColor(sideToMove);
        const g = new Game(board);
        g.#rootPlayer = sideToMove;
        return g;
    }
    // ─── Core actions ───
    selectMove(index) {
        this.#assertValidMoveIndex(index);
        const move = this.#choicesCache[index];
        this.#indexHistory.push(index);
        this.#executeMove(move);
    }
    undoMove() {
        if (this.#indexHistory.length === 0)
            return;
        this.#indexHistory.pop();
        this.#boardHistory.pop();
        this.#encodedHistory.pop();
        this.#choicesDirty = true;
        this.#moveableDirty = true;
    }
    // ─── Queries ───
    moveCount() {
        this.#updateChoicesCache();
        return this.#moveCountCache;
    }
    getMoves() {
        this.#updateChoicesCache();
        return this.#choicesCache.map(copyMove);
    }
    getMoveSequence() {
        return [...this.#indexHistory];
    }
    getBoardHistory() {
        return [...this.#boardHistory];
    }
    getEncodedHistory() {
        return [...this.#encodedHistory];
    }
    board() {
        return this.#boardHistory.at(-1);
    }
    player() {
        return this.#indexHistory.length % 2 === 0 ? this.#rootPlayer : oppositeColor(this.#rootPlayer);
    }
    /**
     * Canonical transposition-table key for the current position: the encoded
     * board with the side-to-move packed into the low bit.
     * @returns {bigint}
     */
    positionKey() {
        return (this.board().encode() << 1n) | BigInt(this.player());
    }
    // ─── Private: move execution ───
    #executeMove(move) {
        const current = this.board();
        // Remove captured pieces first so a long chain can finish on a
        // square that was occupied before the sequence began.
        let next = current;
        for (const cap of move.captured) {
            next = next.removePiece(cap);
        }
        // Move piece (skip when from == to, e.g. a dame loop capture).
        if (!move.from.equals(move.to)) {
            next = next.movePiece(move.from, move.to);
        }
        // Promotion check
        const movedIsBlack = current.isBlackPiece(move.from);
        const color = movedIsBlack ? PieceColor.BLACK : PieceColor.WHITE;
        const promoRow = color === PieceColor.WHITE ? 7 : 0;
        if (move.to.y === promoRow && !current.isDamePiece(move.from)) {
            next = next.promotePiece(move.to);
        }
        this.#boardHistory.push(next);
        this.#encodedHistory.push(next.encode());
        this.#choicesDirty = true;
        this.#moveableDirty = true;
    }
    // ─── Private: move generation ───
    #updateChoicesCache() {
        if (!this.#choicesDirty)
            return;
        this.#choicesDirty = false;
        this.#updateMoveableCache();
        this.#choicesCache = uniqueMoves(this.#buildAllMoves());
        this.#moveCountCache = this.#choicesCache.length;
    }
    #updateMoveableCache() {
        if (!this.#moveableDirty)
            return;
        this.#moveableDirty = false;
        const board = this.board();
        const color = this.player();
        const explorer = new Explorer(board);

        this.#moveableCache = new Map(
            board.getPieces(color)
                .keys()
                .map((pos) => [pos, explorer.findValidMoves(pos)])
                .filter(([, legals]) => !legals.empty())
        );

        this.#sortedPositionsCache = this.#moveableCache
            .keys()
            .toArray()
            .toSorted((a, b) => a.compare(b));
    }
    #hasMandatoryCapture() {
        return this.#moveableCache.values().some(legals => legals.hasCaptured());
    }
    #toMove(from, info) {
        const move = { from, to: info.targetPosition, captured: [...info.capturedPositions], path: [from, ...info.path] };
        if (info.capturedPositions.length > 0) {
            move.trace = new CaptureTrace([...info.sequence]);
        }
        return move;
    }
    #buildAllMoves() {
        const hasCaptures = this.#hasMandatoryCapture();
        return this.#sortedPositionsCache
            .values()
            // If captures exist anywhere, only include capture moves
            .filter((pos) => !hasCaptures || this.#moveableCache.get(pos).hasCaptured())
            .flatMap((pos) => Iterator
                .from(this.#moveableCache.get(pos))
                .map((info) => this.#toMove(pos, info)))
            .toArray();
    }
    #assertValidMoveIndex(index) {
        if (!Number.isInteger(index)) {
            throw new RangeError(`Move index must be an integer: ${index}`);
        }
        const count = this.moveCount();
        if (index < 0 || index >= count) {
            const range = count > 0 ? `0-${count - 1}` : 'no legal moves';
            throw new RangeError(`Move index ${index} out of range; valid range is ${range}`);
        }
    }
}
