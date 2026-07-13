import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor } from '../../../core/piece.mjs';
import { Position } from '../../../core/Position.mjs';
import { orderMoveIndices } from '../../../core/moves/moveOrder.mjs';

describe('core/moves/move-order', () => {
  test('orderMoveIndices correctly prioritizes captures, promotions, and quiet deltas', () => {
    const mockBoard = {
      isBlackPiece: (_pos) => false, // White piece
      isDamePiece: (_pos) => false, // Pion type
    };

    const from1 = Position.fromString('C1'); // y = 0
    const to1 = Position.fromString('D2'); // y = 1
    // Quiet move 1: White pion C1 -> D2
    // y: 0 -> 1. Row bonus: 12 -> 10. Col bonus (x): 2 (col C) -> 3 (col D).
    // PION_COL_BONUS = [-8, -3, 3, 7, 7, 3, -3, -8]
    // C is col index 2 (3), D is col index 3 (7).
    // White PST at C1 = 12 + 3 = 15
    // White PST at D2 = 10 + 7 = 17
    // delta = 17 - 15 = 2
    const quietMove1 = {
      from: from1,
      to: to1,
      captured: [],
    };

    // Quiet move 2: White pion E3 -> F4
    // E3 (coords: 4, 2). y: 2 -> y: 3 (F4 coords: 5, 3).
    // Row bonus: y=2 (8) -> y=3 (6).
    // Col bonus: x=4 (7) -> x=5 (3).
    // White PST at E3 = 8 + 7 = 15
    // White PST at F4 = 6 + 3 = 9
    // delta = 9 - 15 = -6
    const quietMove2 = {
      from: Position.fromString('E3'),
      to: Position.fromString('F4'),
      captured: [],
    };

    // Capture move: captures 1 piece
    const captureMove = {
      from: Position.fromString('C1'),
      to: Position.fromString('E3'),
      captured: [Position.fromString('D2')],
    };

    // Promotion move: quiet move landing on player's promoRow
    // Note: Due to the inverted promoRow logic in moveOrder.mjs:
    // promoRow = player === PieceColor.WHITE ? 0 : 7
    // So for WHITE, landing on row 0 (y=0) is considered promotion.
    // Let's create a move for WHITE landing on row 0.
    const promoMove = {
      from: Position.fromString('D2'),
      to: Position.fromString('C1'), // y=0
      captured: [],
    };

    const moves = [
      quietMove1, // index 0: delta = 2
      quietMove2, // index 1: delta = -6
      captureMove, // index 2: capture (score 1001)
      promoMove, // index 3: promotion (score 500)
    ];

    // Let's sort for WHITE
    const sortedIndices = orderMoveIndices(moves, mockBoard, PieceColor.WHITE);

    // Expected order:
    // 1. captureMove (index 2)
    // 2. promoMove (index 3)
    // 3. quietMove1 (index 0) - delta 2
    // 4. quietMove2 (index 1) - delta -6
    assert.deepEqual(sortedIndices, [2, 3, 0, 1]);
  });
});
