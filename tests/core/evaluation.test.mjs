import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/position.mjs';
import { Board } from '../../core/board.mjs';
import { Game } from '../../core/game.mjs';
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
            [Position.fromString('B1'), { color: PieceColor.WHITE, type: PieceType.PION }],
        ]);
        
        // White Pion B1 (y=0) to C2 (y=1)
        // White PST at B1 = Row 0 (12) + Col B (-3) = 9
        // White PST at C2 = Row 1 (10) + Col C (3) = 13
        // delta = 13 - 9 = 4
        const delta = pstMoveDelta(board, Position.fromString('B1'), Position.fromString('C2'));
        assert.equal(delta, 4);
    });

    test('isImmediateDraw detection', () => {
        // Case 1: Both sides have exactly one dame and nothing else -> Immediate Draw
        const board1 = Board.fromPieces([
            [Position.fromString('B1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
            [Position.fromString('H7'), { color: PieceColor.BLACK, type: PieceType.DAME }],
        ]);
        assert.equal(isImmediateDraw(board1, PieceColor.WHITE), true);

        // Case 2: One side has no dame -> Not immediate draw
        const board2 = Board.fromPieces([
            [Position.fromString('B1'), { color: PieceColor.WHITE, type: PieceType.PION }],
            [Position.fromString('H7'), { color: PieceColor.BLACK, type: PieceType.DAME }],
        ]);
        assert.equal(isImmediateDraw(board2, PieceColor.WHITE), false);

        // Case 3: More than 1 pion on a side -> Not immediate draw
        const board3 = Board.fromPieces([
            [Position.fromString('B1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
            [Position.fromString('C2'), { color: PieceColor.WHITE, type: PieceType.PION }],
            [Position.fromString('D3'), { color: PieceColor.WHITE, type: PieceType.PION }],
            [Position.fromString('H7'), { color: PieceColor.BLACK, type: PieceType.DAME }],
        ]);
        assert.equal(isImmediateDraw(board3, PieceColor.WHITE), false);
        
        // Case 4: Mandatory capture exists -> Not immediate draw
        // White Dame at B3, Black Pion at C4, landing at D5 is empty.
        // There is a mandatory capture.
        const board4 = Board.fromPieces([
            [Position.fromString('B3'), { color: PieceColor.WHITE, type: PieceType.DAME }],
            [Position.fromString('C4'), { color: PieceColor.BLACK, type: PieceType.PION }],
            [Position.fromString('G6'), { color: PieceColor.BLACK, type: PieceType.DAME }],
        ]);
        // White has a capture on C4, landing on D5.
        assert.equal(isImmediateDraw(board4, PieceColor.WHITE), false);
    });

    test('evaluateBoard and evaluatePosition basic checks', () => {
        // Empty board evaluates to 0
        const empty = Board.empty();
        assert.equal(evaluateBoard(empty), 0);

        // Symmetric board layout evaluates to 0
        const boardSymmetric = Board.fromPieces([
            [Position.fromString('B1'), { color: PieceColor.WHITE, type: PieceType.PION }],
            [Position.fromString('G8'), { color: PieceColor.BLACK, type: PieceType.PION }], // Mirrored position
        ]);
        assert.equal(evaluateBoard(boardSymmetric), 0);

        // Game position evaluation
        const game = new Game();
        // Standard setup is symmetric for both sides
        assert.equal(evaluatePosition(game), 0);
    });
});
