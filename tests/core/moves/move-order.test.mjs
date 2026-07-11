import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor } from '../../../core/piece.mjs';
import { Position } from '../../../core/position.mjs';
import { orderMoveIndices } from '../../../core/moves/move-order.mjs';

describe('core/moves/move-order', () => {
    test('orderMoveIndices correctly prioritizes captures, promotions, and quiet deltas', () => {
        const mockBoard = {
            isBlackPiece: (pos) => false, // White piece
            isDamePiece: (pos) => false,  // Pion type
        };

        const from1 = Position.fromString('B1'); // y = 0
        const to1 = Position.fromString('C2');   // y = 1
        // Quiet move 1: White pion B1 -> C2
        // y: 0 -> 1. Row bonus: 12 -> 10. Col bonus (x): 1 (col B) -> 2 (col C).
        // PION_COL_BONUS = [-8, -3, 3, 7, 7, 3, -3, -8]
        // B is col index 1 (-3), C is col index 2 (3).
        // White PST at B1 = 12 + (-3) = 9
        // White PST at C2 = 10 + 3 = 13
        // delta = 13 - 9 = 4
        const quietMove1 = {
            from: from1,
            to: to1,
            captured: [],
        };

        // Quiet move 2: White pion D3 -> E4
        // D3 (coords: 3, 2). y: 2 -> y: 3 (E4 coords: 4, 3).
        // Row bonus: y=2 (8) -> y=3 (6).
        // Col bonus: x=3 (7) -> x=4 (7).
        // White PST at D3 = 8 + 7 = 15
        // White PST at E4 = 6 + 7 = 13
        // delta = 13 - 15 = -2
        const quietMove2 = {
            from: Position.fromString('D3'),
            to: Position.fromString('E4'),
            captured: [],
        };

        // Capture move: captures 1 piece
        const captureMove = {
            from: Position.fromString('B1'),
            to: Position.fromString('D3'),
            captured: [Position.fromString('C2')],
        };

        // Promotion move: quiet move landing on player's promoRow
        // Note: Due to the inverted promoRow logic in move-order.mjs:
        // promoRow = player === PieceColor.WHITE ? 0 : 7
        // So for WHITE, landing on row 0 (y=0) is considered promotion.
        // Let's create a move for WHITE landing on row 0.
        const promoMove = {
            from: Position.fromString('C2'),
            to: Position.fromString('B1'), // y=0
            captured: [],
        };

        const moves = [
            quietMove1,   // index 0: delta = 4
            quietMove2,   // index 1: delta = -2
            captureMove,  // index 2: capture (score 1001)
            promoMove,    // index 3: promotion (score 500)
        ];

        // Let's sort for WHITE
        const sortedIndices = orderMoveIndices(moves, mockBoard, PieceColor.WHITE);
        
        // Expected order:
        // 1. captureMove (index 2)
        // 2. promoMove (index 3)
        // 3. quietMove1 (index 0) - delta 4
        // 4. quietMove2 (index 1) - delta -2
        assert.deepEqual(sortedIndices, [2, 3, 0, 1]);
    });
});
