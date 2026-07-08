// Move generation — Thai Checkers rules
import { PieceColor } from './piece.mjs';
import { Position } from './position.mjs';
import { Legals } from './legals.mjs';
import { WHITE_PION_DIRS, BLACK_PION_DIRS, DAME_DIRS, promotionRow, isOpponentPiece } from './directions.mjs';

const getDirs = (color, isDame) =>
    isDame
        ? DAME_DIRS
        : color === PieceColor.BLACK ? BLACK_PION_DIRS : WHITE_PION_DIRS;

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
        if (captures.length > 0)
            return Legals.fromCaptures(captures);

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
        const results = [];
        const dirs = getDirs(color, isDame);
        for (const d of dirs) {
            const caps = this.#findCapturesInDir(board, pos, d, isDame);
            for (const cap of caps) {
                const sim = this.#applyCapture(board, pos, cap[0], cap[1]);
                const becameDame = !isDame && cap[1].y === promotionRow(color);
                if (becameDame) {
                    // Pion promotion ends the capture sequence immediately.
                    results.push(this.#flatten(path, cap));
                    continue;
                }
                const rec = this.#findCapturesFrom(sim, cap[1], color, isDame, [...path, cap]);
                if (rec.length > 0)
                    results.push(...rec);
                else
                    results.push(this.#flatten(path, cap));
            }
        }
        return results;
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
            // Flying dame: glide over empty squares to the first opponent, then
            // land on the single empty square immediately behind it (Thai "short
            // king" rule — no choice of a farther landing square).
            let x = from.x + dx;
            let y = from.y + dy;
            let foundOpponent = null;
            while (Position.isValid(x, y)) {
                const pos = Position.fromCoords(x, y);
                if (board.isOccupied(pos)) {
                    // A blocker before any opponent, or a second piece behind the
                    // captured one, ends this ray with no capture.
                    if (foundOpponent || !isOpponentPiece(board, pos, myColor)) {
                        return [];
                    }
                    foundOpponent = pos;
                }
                else if (foundOpponent) {
                    return [[foundOpponent, pos]];
                }
                x += dx;
                y += dy;
            }
            return [];
        }
        // Pion: single square capture
        const midX = from.x + dx;
        const midY = from.y + dy;
        const landX = from.x + 2 * dx;
        const landY = from.y + 2 * dy;
        if (!Position.isValid(midX, midY) || !Position.isValid(landX, landY))
            return [];
        const midPos = Position.fromCoords(midX, midY);
        const landPos = Position.fromCoords(landX, landY);
        if (!board.isOccupied(midPos) || board.isOccupied(landPos))
            return [];
        const isOpp = isOpponentPiece(board, midPos, myColor);
        if (!isOpp)
            return [];
        return [[midPos, landPos]];
    }
    // ─── regular moves ───
    #findRegularMoves(from, color, isDame, dirs) {
        const positions = [];
        if (isDame) {
            for (const { dx, dy } of dirs) {
                let x = from.x + dx;
                let y = from.y + dy;
                while (Position.isValid(x, y)) {
                    const pos = Position.fromCoords(x, y);
                    if (this.#board.isOccupied(pos))
                        break;
                    positions.push(pos);
                    x += dx;
                    y += dy;
                }
            }
        }
        else {
            for (const { dx, dy } of dirs) {
                const nx = from.x + dx;
                const ny = from.y + dy;
                if (Position.isValid(nx, ny)) {
                    const pos = Position.fromCoords(nx, ny);
                    if (!this.#board.isOccupied(pos))
                        positions.push(pos);
                }
            }
        }
        return positions;
    }
}
