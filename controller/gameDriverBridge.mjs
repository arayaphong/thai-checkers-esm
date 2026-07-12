import { Position } from '../core/Position.mjs';
import { PieceColor } from '../core/piece.mjs';
import { GameDriver } from '../cli/GameDriver.mjs';

/**
 * Coordinate position in the MVC model and view layers.
 * - r: row index (0..7, where 0 is rank 8/top and 7 is rank 1/bottom)
 * - c: column index (0..7, where 0 is file A/left and 7 is file H/right)
 * @typedef {Object} ModelPos
 * @property {number} r
 * @property {number} c
 */

/**
 * Translates a core Position instance to a model coordinate object.
 * Relation: y = 7 - r, x = c.
 * @param {import('../core/Position.mjs').Position} pos
 * @returns {ModelPos}
 */
export const modelPosOfPosition = (pos) => ({ r: 7 - pos.y, c: pos.x });

/**
 * Translates a model coordinate object to a core Position instance.
 * @param {ModelPos} modelPos
 * @returns {import('../core/Position.mjs').Position}
 */
export const positionOfModelPos = ({ r, c }) => Position.fromCoords(c, 7 - r);

/**
 * Translates a model coordinate object to a board square string (e.g., "A3").
 * @param {ModelPos} rc
 * @returns {string}
 */
export const squareOfModelPos = (rc) => positionOfModelPos(rc).toString();

/**
 * Translates a board square string (e.g., "A3") to a model coordinate object.
 * @param {string} square
 * @returns {ModelPos}
 */
export const modelPosOfSquare = (square) =>
  modelPosOfPosition(Position.fromString(square.toUpperCase()));

/**
 * Maps turn integer to PieceColor.
 * @param {number} turn 1 for white, -1 for black
 * @returns {number} PieceColor
 */
export const pieceColorOfTurn = (turn) => (turn === 1 ? PieceColor.WHITE : PieceColor.BLACK);

/**
 * Maps PieceColor to turn integer.
 * @param {number} color PieceColor
 * @returns {number} 1 for white, -1 for black
 */
export const turnOfPieceColor = (color) => (color === PieceColor.WHITE ? 1 : -1);

export const demoJsonFromModelBoard = (board, turn) => {
  const pieces = board.flatMap((row, r) =>
    row
      .map((value, c) => {
        if (value === 0) return null;
        const color = value > 0 ? 'WHITE' : 'BLACK';
        const type = Math.abs(value) === 2 ? 'DAME' : 'PION';
        return [squareOfModelPos({ r, c }), { color, type }];
      })
      .filter((item) => item !== null),
  );
  return { pieces, sideToMove: turn === 1 ? 'WHITE' : 'BLACK' };
};

export const createDriverForModelBoard = (board, turn) =>
  new GameDriver(demoJsonFromModelBoard(board, turn));

export const createStandardDriver = () => new GameDriver();

export const expandDriverMoveToModelHops = (move) => {
  const path = move.path?.length > 0 ? move.path : [move.from, move.to];
  const isCaptureChain = move.captured.length > 0;
  return path.slice(0, -1).map((current, i) => {
    const from = modelPosOfPosition(current);
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
    return hop;
  });
};

export const playHumanTurnOnDriver = (driver, { fromSquare, toSquare, capturedSquares }) => {
  try {
    return driver.playMovePosition(fromSquare, toSquare);
  } catch (error) {
    if (error.code !== 'AMBIGUOUS_MOVE') throw error;
    const wanted = [...capturedSquares].toSorted().join(',');
    const match = error.candidates.find(
      ({ move }) =>
        move.captured
          .map((position) => position.toString())
          .toSorted()
          .join(',') === wanted,
    );
    if (!match) {
      throw new Error(
        `GameDriverBridge: no candidate route for ${fromSquare}->${toSquare} matches ` +
          `captured set [${wanted}]. model/ and core/ move generation have diverged.`,
      );
    }
    return driver.playMovePosition(fromSquare, toSquare, match.choice);
  }
};
