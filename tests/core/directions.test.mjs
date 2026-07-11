import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor } from '../../core/piece.mjs';
import { Position } from '../../core/position.mjs';
import {
    WHITE_PION_DIRS,
    BLACK_PION_DIRS,
    DAME_DIRS,
    pionForwardDirs,
    promotionRow,
    isOpponentPiece,
} from '../../core/directions.mjs';

describe('core/directions', () => {
    test('direction constants are frozen lists of frozen directions', () => {
        // WHITE_PION_DIRS
        assert.equal(WHITE_PION_DIRS.length, 2);
        assert.deepEqual(WHITE_PION_DIRS[0], { dx: -1, dy: 1 });
        assert.deepEqual(WHITE_PION_DIRS[1], { dx: 1, dy: 1 });
        assert.equal(Object.isFrozen(WHITE_PION_DIRS), true);
        assert.equal(Object.isFrozen(WHITE_PION_DIRS[0]), true);

        // BLACK_PION_DIRS
        assert.equal(BLACK_PION_DIRS.length, 2);
        assert.deepEqual(BLACK_PION_DIRS[0], { dx: -1, dy: -1 });
        assert.deepEqual(BLACK_PION_DIRS[1], { dx: 1, dy: -1 });
        assert.equal(Object.isFrozen(BLACK_PION_DIRS), true);
        assert.equal(Object.isFrozen(BLACK_PION_DIRS[0]), true);

        // DAME_DIRS
        assert.equal(DAME_DIRS.length, 4);
        assert.equal(Object.isFrozen(DAME_DIRS), true);
        assert.equal(Object.isFrozen(DAME_DIRS[0]), true);
    });

    test('pionForwardDirs selects appropriate directions', () => {
        assert.equal(pionForwardDirs(PieceColor.WHITE), WHITE_PION_DIRS);
        assert.equal(pionForwardDirs(PieceColor.BLACK), BLACK_PION_DIRS);
    });

    test('promotionRow maps to home boundaries', () => {
        assert.equal(promotionRow(PieceColor.WHITE), 7);
        assert.equal(promotionRow(PieceColor.BLACK), 0);
    });

    test('isOpponentPiece evaluates correctly on mock board', () => {
        const mockPos = Position.fromCoords(1, 0);

        // Scenario 1: Square is empty
        const board1 = {
            isOccupied: (pos) => false,
            isBlackPiece: (pos) => false,
        };
        assert.equal(isOpponentPiece(board1, mockPos, PieceColor.WHITE), false);
        assert.equal(isOpponentPiece(board1, mockPos, PieceColor.BLACK), false);

        // Scenario 2: Square is occupied by White piece
        const board2 = {
            isOccupied: (pos) => true,
            isBlackPiece: (pos) => false,
        };
        // For WHITE, a White piece is not an opponent
        assert.equal(isOpponentPiece(board2, mockPos, PieceColor.WHITE), false);
        // For BLACK, a White piece is an opponent
        assert.equal(isOpponentPiece(board2, mockPos, PieceColor.BLACK), true);

        // Scenario 3: Square is occupied by Black piece
        const board3 = {
            isOccupied: (pos) => true,
            isBlackPiece: (pos) => true,
        };
        // For WHITE, a Black piece is an opponent
        assert.equal(isOpponentPiece(board3, mockPos, PieceColor.WHITE), true);
        // For BLACK, a Black piece is not an opponent
        assert.equal(isOpponentPiece(board3, mockPos, PieceColor.BLACK), false);
    });
});
