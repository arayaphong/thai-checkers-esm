import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Game } from '../../core/Game.mjs';
import {
  PIECE_VALUES,
  MATE_SCORE,
  MATE_SCORE_THRESHOLD,
  pstMoveDelta,
  isImmediateDraw,
  evaluateBoard,
  evaluatePosition,
} from '../../core/evaluation.mjs';

describe('core/evaluation', () => {
  test('static constants values', () => {
    assert.equal(PIECE_VALUES.PION, 100);
    assert.equal(PIECE_VALUES.DAME, 350);
    assert.equal(MATE_SCORE, 100_000);
    assert.equal(MATE_SCORE_THRESHOLD, 90_000);
  });

  test('pstMoveDelta calculations', () => {
    const board = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.PION }],
    ]);

    // White Pion C1 (y=0) to D2 (y=1)
    // White PST at C1 = Row 0 (12) + Col C (3) = 15
    // White PST at D2 = Row 1 (10) + Col D (7) = 17
    // delta = 17 - 15 = 2
    const delta = pstMoveDelta(board, Position.fromString('C1'), Position.fromString('D2'));
    assert.equal(delta, 2);
  });

  test('isImmediateDraw detection', () => {
    // Case 1: Both sides have exactly one dame and nothing else -> Immediate Draw
    const board1 = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [Position.fromString('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    assert.equal(isImmediateDraw(board1, PieceColor.WHITE), true);

    // Case 2: One side has no dame -> Not immediate draw
    const board2 = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [Position.fromString('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    assert.equal(isImmediateDraw(board2, PieceColor.WHITE), false);

    // Case 3: More than 1 pion on a side -> Not immediate draw
    const board3 = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [Position.fromString('D2'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [Position.fromString('E3'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [Position.fromString('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    assert.equal(isImmediateDraw(board3, PieceColor.WHITE), false);

    // Case 4: Mandatory capture exists -> Not immediate draw
    // White Dame at C3, Black Pion at D4, landing at E5 is empty.
    // There is a mandatory capture.
    const board4 = Board.fromPieces([
      [Position.fromString('C3'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [Position.fromString('D4'), { color: PieceColor.BLACK, type: PieceType.PION }],
      [Position.fromString('H6'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    // White has a capture on D4, landing on E5.
    assert.equal(isImmediateDraw(board4, PieceColor.WHITE), false);
  });

  test('evaluateBoard and evaluatePosition basic checks', () => {
    // Empty board evaluates to 0
    const empty = Board.empty();
    assert.equal(evaluateBoard(empty), 0);

    // Symmetric board layout evaluates to 0
    const boardSymmetric = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [Position.fromString('F8'), { color: PieceColor.BLACK, type: PieceType.PION }], // Mirrored position
    ]);
    assert.equal(evaluateBoard(boardSymmetric), 0);

    // Game position evaluation
    const game = new Game();
    // Standard setup is symmetric for both sides
    assert.equal(evaluatePosition(game), 0);
  });
});
