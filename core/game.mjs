// Thai Checkers game state machine
import { PieceColor, assertPieceColor } from './piece.mjs';
import { Board } from './board.mjs';
import { Explorer } from './explorer.mjs';
import { CaptureTrace } from './legals.mjs';

/**
 * Creates a deep copy of a Move object.
 * @param {import('./game.mjs').Move} move
 * @returns {import('./game.mjs').Move}
 */
const copyMove = (move) => ({
    from: move.from,
    to: move.to,
    captured: [...move.captured],
    path: [...move.path],
    trace: move.trace,
});

/**
 * Generates a unique string key for a Move instance to deduplicate moves.
 * @param {import('./game.mjs').Move} move
 * @returns {string}
 */
const moveIdentityKey = (move) => {
    const sortedCaptured = move.captured.map((pos) => pos.hash()).toSorted();
    return `${move.from.hash()}:${move.to.hash()}:${sortedCaptured.toString()}`;
};

/**
 * Filter out duplicate moves.
 * @param {import('./game.mjs').Move[]} moves
 * @returns {import('./game.mjs').Move[]}
 */
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

/**
 * Helper to get the opposite PieceColor.
 * @param {number} color
 * @returns {number}
 */
const oppositeColor = (color) => (color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE);

/**
 * Orchestrates game rules, legal moves generation, and board history.
 */
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

    /**
     * @typedef {Object} Move
     * @property {import('./position.mjs').Position} from - The starting position of the move.
     * @property {import('./position.mjs').Position} to - The ending position of the move.
     * @property {import('./position.mjs').Position[]} captured - The positions of any captured pieces.
     * @property {import('./position.mjs').Position[]} path - The complete list of waypoints from source to destination.
     * @property {import('./legals.mjs').CaptureTrace} [trace] - Detailed steps for validation of capture moves.
     */

    // ─── Constructors ───

    /**
     * Constructs a Game state machine.
     * @param {import('./board.mjs').Board} [board] The starting board configuration (defaults to standard setup).
     */
    constructor(board) {
        const initial = board ?? Board.setup();
        this.#boardHistory.push(initial);
        this.#encodedHistory.push(initial.encode());
    }

    /**
     * Creates a deep copy of another Game instance.
     * @param {Game} other The game to copy.
     * @returns {Game} A new copy of the Game.
     */
    static copy(other) {
        const g = new Game();
        g.#boardHistory = other.#boardHistory.map((b) => Board.copy(b));
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
     * @returns {Game}
     */
    static from(board, sideToMove) {
        assertPieceColor(sideToMove);
        const g = new Game(board);
        g.#rootPlayer = sideToMove;
        return g;
    }

    // ─── Core actions ───

    /**
     * Advances the game state by selecting a legal move index.
     * @param {number} index The index of the move in the current choices list.
     */
    selectMove(index) {
        this.#assertValidMoveIndex(index);
        const move = this.#choicesCache[index];
        this.#indexHistory.push(index);
        this.#executeMove(move);
    }

    /**
     * Reverts the game state by undoing the last selected move.
     */
    undoMove() {
        if (this.#indexHistory.length === 0) return;
        this.#indexHistory.pop();
        this.#boardHistory.pop();
        this.#encodedHistory.pop();
        this.#choicesDirty = true;
        this.#moveableDirty = true;
    }

    // ─── Queries ───

    /**
     * Returns the number of legal moves available in the current position.
     * @returns {number}
     */
    moveCount() {
        this.#updateChoicesCache();
        return this.#moveCountCache;
    }

    /**
     * Returns the list of legal moves available in the current position.
     * @returns {Move[]}
     */
    getMoves() {
        this.#updateChoicesCache();
        return this.#choicesCache.map(copyMove);
    }

    /**
     * Returns the array of selected move indices played in this game.
     * @returns {number[]}
     */
    getMoveSequence() {
        return [...this.#indexHistory];
    }

    /**
     * Returns the board state history since the root of this game.
     * @returns {import('./board.mjs').Board[]}
     */
    getBoardHistory() {
        return [...this.#boardHistory];
    }

    /**
     * Returns the history of encoded board states (64-bit bigints).
     * @returns {bigint[]}
     */
    getEncodedHistory() {
        return [...this.#encodedHistory];
    }

    /**
     * Returns the current board state.
     * @returns {import('./board.mjs').Board}
     */
    board() {
        return this.#boardHistory.at(-1);
    }

    /**
     * Returns the side to move (PieceColor).
     * @returns {number} PieceColor
     */
    player() {
        return this.#indexHistory.length % 2 === 0
            ? this.#rootPlayer
            : oppositeColor(this.#rootPlayer);
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

    /**
     * Helper to apply a Move to the board state.
     * @param {Move} move
     */
    #executeMove(move) {
        const current = this.board();
        // Remove captured pieces first so a long chain can finish on a
        // square that was occupied before the sequence began.
        const removed = move.captured.reduce((acc, cap) => acc.removePiece(cap), current);
        // Move piece (skip when from == to, e.g. a dame loop capture).
        const moved = !move.from.equals(move.to)
            ? removed.movePiece(move.from, move.to)
            : removed;
        // Promotion check
        const movedIsBlack = current.isBlackPiece(move.from);
        const color = movedIsBlack ? PieceColor.BLACK : PieceColor.WHITE;
        const promoRow = color === PieceColor.WHITE ? 7 : 0;
        const next = move.to.y === promoRow && !current.isDamePiece(move.from)
            ? moved.promotePiece(move.to)
            : moved;

        this.#boardHistory.push(next);
        this.#encodedHistory.push(next.encode());
        this.#choicesDirty = true;
        this.#moveableDirty = true;
    }

    // ─── Private: move generation ───

    /**
     * Rebuilds the cache of legal moves if dirty.
     */
    #updateChoicesCache() {
        if (!this.#choicesDirty) return;
        this.#choicesDirty = false;
        this.#updateMoveableCache();
        this.#choicesCache = uniqueMoves(this.#buildAllMoves());
        this.#moveCountCache = this.#choicesCache.length;
    }

    /**
     * Rebuilds pieces moveable cache.
     */
    #updateMoveableCache() {
        if (!this.#moveableDirty) return;
        this.#moveableDirty = false;
        const board = this.board();
        const color = this.player();
        const explorer = new Explorer(board);

        const moveableCache = new Map();
        const sortedPositions = [];

        board.getPieces(color).forEach((_, pos) => {
            const legals = explorer.findValidMoves(pos);
            if (!legals.empty()) {
                moveableCache.set(pos, legals);
                sortedPositions.push(pos);
            }
        });

        this.#moveableCache = moveableCache;
        this.#sortedPositionsCache = sortedPositions;
    }

    /**
     * Checks if there are any mandatory captures.
     * @returns {boolean}
     */
    #hasMandatoryCapture() {
        return this.#moveableCache.values().some((legals) => legals.hasCaptured());
    }

    /**
     * Maps explorer legal MoveInfo to a Move structure.
     * @param {import('./position.mjs').Position} from
     * @param {import('./legals.mjs').MoveInfo} info
     * @returns {Move}
     */
    #toMove(from, info) {
        const move = {
            from,
            to: info.targetPosition,
            captured: [...info.capturedPositions],
            path: [from, ...info.path],
        };
        if (info.capturedPositions.length > 0) {
            move.trace = new CaptureTrace([...info.sequence]);
        }
        return move;
    }

    /**
     * Assembles all valid moves.
     * @returns {Move[]}
     */
    #buildAllMoves() {
        const hasCaptures = this.#hasMandatoryCapture();
        return (
            this.#sortedPositionsCache
                .values()
                // If captures exist anywhere, only include capture moves
                .filter((pos) => !hasCaptures || this.#moveableCache.get(pos).hasCaptured())
                .flatMap((pos) =>
                    Iterator.from(this.#moveableCache.get(pos)).map((info) =>
                        this.#toMove(pos, info),
                    ),
                )
                .toArray()
        );
    }

    /**
     * Asserts that index is a valid move sequence index.
     * @param {number} index
     * @throws {RangeError}
     */
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
