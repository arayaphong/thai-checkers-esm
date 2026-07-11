// Move generation — Thai Checkers rules
import { PieceColor } from './piece.mjs';
import { Position } from './position.mjs';
import { Legals } from './legals.mjs';
import {
    WHITE_PION_DIRS,
    BLACK_PION_DIRS,
    DAME_DIRS,
    promotionRow,
    isOpponentPiece,
} from './directions.mjs';

const getDirs = (color, isDame) =>
    isDame ? DAME_DIRS : color === PieceColor.BLACK ? BLACK_PION_DIRS : WHITE_PION_DIRS;

const getRayCoords = (from, dx, dy) =>
    Array.from({ length: 7 }, (_, i) => ({ x: from.x + dx * (i + 1), y: from.y + dy * (i + 1) }))
        .filter(({ x, y }) => Position.isValid(x, y))
        .map(({ x, y }) => Position.fromCoords(x, y));

// ─── Explorer ───
export class Explorer {
    #board;
    constructor(board) {
        this.#board = board;
    }
    // ─── public API ───
    findValidMoves(from) {
        if (!this.#board.isOccupied(from)) {
            throw new Error(`No piece at ${from.toString()}`);
        }
        const isDame = this.#board.isDamePiece(from);
        const color = this.#board.isBlackPiece(from) ? PieceColor.BLACK : PieceColor.WHITE;
        // 1. Try captures
        const captures = this.#findAllCaptureSequences(from, color, isDame);
        if (captures.length > 0) return Legals.fromCaptures(captures);

        // 2. Regular moves
        const dirs = getDirs(color, isDame);
        const positions = this.#findRegularMoves(from, color, isDame, dirs);
        return Legals.fromRegularMoves(positions);
    }
    // ─── capture sequence finding ───
    #findAllCaptureSequences(from, color, isDame) {
        const results = this.#findCapturesFrom(this.#board, from, color, isDame, []);
        // Deduplicate exact capture sequences while preserving alternative
        // routes for Game to classify after it has built the complete move list.
        const seen = new Set();
        return results.filter((seq) => {
            const key = seq.map((position) => position.hash()).join(',');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }
    #findCapturesFrom(board, pos, color, isDame, path) {
        const dirs = getDirs(color, isDame);
        return dirs.flatMap((d) => {
            const caps = this.#findCapturesInDir(board, pos, d, isDame);
            return caps.flatMap((cap) => {
                const sim = this.#applyCapture(board, pos, cap[0], cap[1]);
                const becameDame = !isDame && cap[1].y === promotionRow(color);
                if (becameDame) {
                    return [this.#flatten(path, cap)];
                }
                const rec = this.#findCapturesFrom(sim, cap[1], color, isDame, [...path, cap]);
                return rec.length > 0 ? rec : [this.#flatten(path, cap)];
            });
        });
    }
    #flatten(path, last) {
        return [...path.flatMap(([captured, landing]) => [captured, landing]), ...last];
    }
    #applyCapture(board, from, captured, landing) {
        return board.removePiece(captured).movePiece(from, landing);
    }
    // ─── find the capture available in one direction (at most one) ───
    #findCapturesInDir(board, from, dir, isDame) {
        const myColor = board.isBlackPiece(from) ? PieceColor.BLACK : PieceColor.WHITE;
        const { dx, dy } = dir;
        if (isDame) {
            const ray = getRayCoords(from, dx, dy);
            const occupiedIndices = ray
                .map((pos, idx) => (board.isOccupied(pos) ? idx : -1))
                .filter((idx) => idx !== -1);

            if (occupiedIndices.length === 0) return [];

            const firstIdx = occupiedIndices[0];
            const hasValidLanding = firstIdx + 1 < ray.length && !board.isOccupied(ray[firstIdx + 1]);
            if (hasValidLanding && isOpponentPiece(board, ray[firstIdx], myColor)) {
                return [[ray[firstIdx], ray[firstIdx + 1]]];
            }
            return [];
        }
        // Pion: single square capture
        const midX = from.x + dx;
        const midY = from.y + dy;
        const landX = from.x + 2 * dx;
        const landY = from.y + 2 * dy;
        if (!Position.isValid(midX, midY) || !Position.isValid(landX, landY)) return [];
        const midPos = Position.fromCoords(midX, midY);
        const landPos = Position.fromCoords(landX, landY);
        if (!board.isOccupied(midPos) || board.isOccupied(landPos)) return [];
        const isOpp = isOpponentPiece(board, midPos, myColor);
        if (!isOpp) return [];
        return [[midPos, landPos]];
    }
    // ─── regular moves ───
    #findRegularMoves(from, color, isDame, dirs) {
        if (isDame) {
            return dirs.flatMap(({ dx, dy }) => {
                const ray = getRayCoords(from, dx, dy);
                const firstOccupiedIdx = ray.findIndex((pos) => this.#board.isOccupied(pos));
                return firstOccupiedIdx === -1 ? ray : ray.slice(0, firstOccupiedIdx);
            });
        }
        return dirs
            .map(({ dx, dy }) => ({ x: from.x + dx, y: from.y + dy }))
            .filter(({ x, y }) => Position.isValid(x, y))
            .map(({ x, y }) => Position.fromCoords(x, y))
            .filter((pos) => !this.#board.isOccupied(pos));
    }
}
