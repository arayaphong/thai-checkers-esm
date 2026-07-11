import { Position } from '../core/position.mjs';
import { PieceColor, PieceType } from '../core/piece.mjs';
import { GameDriver } from '../cli/GameDriver.mjs';

// core Position: x = 0..7 ('A'..'H'), y = 0..7 (rank1..rank8)
// model {r,c}:   r = 0..7 (rank8..rank1), c = 0..7 ('A'..'H')
// Relation: y = 7 - r, x = c.
export const modelPosOfPosition = (pos) => ({ r: 7 - pos.y, c: pos.x });
export const positionOfModelPos = ({ r, c }) => Position.fromCoords(c, 7 - r);

export const squareOfModelPos = (rc) => positionOfModelPos(rc).toString();
export const modelPosOfSquare = (square) =>
  modelPosOfPosition(Position.fromString(square.toUpperCase()));

export const pieceColorOfTurn = (turn) =>
  (turn === 1 ? PieceColor.WHITE : PieceColor.BLACK);
export const turnOfPieceColor = (color) =>
  (color === PieceColor.WHITE ? 1 : -1);

export const demoJsonFromModelBoard = (board, turn) => {
  const pieces = [];
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const value = board[r][c];
      if (value === 0) continue;
      const color = value > 0 ? 'WHITE' : 'BLACK';
      const type = Math.abs(value) === 2 ? 'DAME' : 'PION';
      pieces.push([squareOfModelPos({ r, c }), { color, type }]);
    }
  }
  return { pieces, sideToMove: turn === 1 ? 'WHITE' : 'BLACK' };
};

export const createDriverForModelBoard = (board, turn) =>
  new GameDriver(demoJsonFromModelBoard(board, turn));

export const createStandardDriver = () => new GameDriver();

export const expandDriverMoveToModelHops = (move) => {
  const path = move.path?.length > 0 ? move.path : [move.from, move.to];
  const isCaptureChain = move.captured.length > 0;
  const hops = [];
  for (let i = 0; i < path.length - 1; i += 1) {
    const from = modelPosOfPosition(path[i]);
    const to = modelPosOfPosition(path[i + 1]);
    const hop = {
      fromR: from.r,
      fromC: from.c,
      toR: to.r,
      toC: to.c,
      isCapture: isCaptureChain,
    };
    if (isCaptureChain) {
      const jumped = modelPosOfPosition(move.captured[i]);
      hop.jumpedR = jumped.r;
      hop.jumpedC = jumped.c;
    }
    hops.push(hop);
  }
  return hops;
};

export const playHumanTurnOnDriver = (
  driver,
  { fromSquare, toSquare, capturedSquares },
) => {
  try {
    return driver.playMovePosition(fromSquare, toSquare);
  } catch (error) {
    if (error.code !== 'AMBIGUOUS_MOVE') throw error;
    const wanted = [...capturedSquares].toSorted().join(',');
    const match = error.candidates.find(({ move }) =>
      move.captured.map((position) => position.toString()).toSorted().join(',') === wanted);
    if (!match) {
      throw new Error(
        `GameDriverBridge: no candidate route for ${fromSquare}->${toSquare} matches `
        + `captured set [${wanted}]. model/ and core/ move generation have diverged.`,
      );
    }
    return driver.playMovePosition(fromSquare, toSquare, match.choice);
  }
};
