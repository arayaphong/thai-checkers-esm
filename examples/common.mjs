import { Position } from '../core/position.mjs';
import { pieceSymbol } from '../core/piece.mjs';

// '.' marks a non-playable (light) square; a blank marks an empty playable
// (dark) square; a piece glyph marks an occupied one. Row 1 is printed first
// (top) through row 8 (bottom), matching the algebraic notation used elsewhere.
export const renderBoard = (board) => {
  const pieceAt = (x, y) => {
    const pos = Position.fromCoords(x, y);
    return board.isOccupied(pos) ? pieceSymbol(board.isBlackPiece(pos), board.isDamePiece(pos)) : ' ';
  }

  const cell = (x, y) =>
    Position.isValid(x, y) ? pieceAt(x, y) : '.';

  const cells = (_, y) =>
    `${y + 1} ${Array.from({ length: 8 }, (_, x) => cell(x, y)).join(' ')}`;

  const rows = Array.from({ length: 8 }, cells);
  return [`  A B C D E F G H`, ...rows].join('\n');
};

// Move objects returned by Analyzer#analyze come from an internal Game.copy(),
// so they're structurally equal but not the same instances as this game's own
// moves. Match by content to find the right index to play.
export const moveKey = (move) =>
    `${move.from.hash()}:${move.to.hash()}:${move.captured.map((p) => p.hash()).toSorted((a, b) => a - b)}`;
