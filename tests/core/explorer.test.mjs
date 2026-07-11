import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/position.mjs';
import { Board } from '../../core/board.mjs';
import { Explorer } from '../../core/explorer.mjs';

describe('core/explorer', () => {
    test('throws error if from position is empty', () => {
        const board = Board.empty();
        const explorer = new Explorer(board);
        const p = Position.fromString('B1');
        assert.throws(() => explorer.findValidMoves(p), Error);
    });

    test('find valid quiet moves for a white pion', () => {
        // Setup a white pion at B3 (coords: 1, 2)
        // Valid forward directions are A4 (0, 3) and C4 (2, 3)
        const p = Position.fromString('B3');
        const board = Board.fromPieces([
            [p, { color: PieceColor.WHITE, type: PieceType.PION }],
        ]);
        const explorer = new Explorer(board);
        const moves = explorer.findValidMoves(p);
        
        assert.equal(moves.size(), 2);
        assert.equal(moves.hasCaptured(), false);
        
        const landingCoords = [moves.getPosition(0).toString(), moves.getPosition(1).toString()];
        assert.equal(landingCoords.includes('A4'), true);
        assert.equal(landingCoords.includes('C4'), true);
    });

    test('find valid quiet moves for a dame (long slides)', () => {
        // Setup a white dame at C4 (coords: 2, 3)
        // Diagonals:
        // dx=-1, dy=-1: B3 (1,2), A2 (0,1) -> 2 squares
        // dx=1,  dy=-1: D3 (3,2), E2 (4,1), F1 (5,0) -> 3 squares
        // dx=-1, dy=1:  B5 (1,4), A6 (0,5) -> 2 squares
        // dx=1,  dy=1:  D5 (3,4), E6 (4,5), F7 (5,6), G8 (6,7) -> 4 squares
        const p = Position.fromString('C4');
        const board = Board.fromPieces([
            [p, { color: PieceColor.WHITE, type: PieceType.DAME }],
        ]);
        const explorer = new Explorer(board);
        const moves = explorer.findValidMoves(p);
        
        assert.equal(moves.hasCaptured(), false);
        // Total open squares along the diagonals: 2 + 3 + 2 + 4 = 11
        assert.equal(moves.size(), 11);
        
        // Pick some slide coordinates to verify
        const list = [...moves].map(m => m.targetPosition.toString());
        assert.equal(list.includes('A2'), true);
        assert.equal(list.includes('F1'), true);
        assert.equal(list.includes('A6'), true);
        assert.equal(list.includes('G8'), true);
    });

    test('find single capture for white pion', () => {
        // White pion at B3, Black pion at C4.
        // B3 (1,2) -> jump over C4 (2,3) -> land on D5 (3,4).
        const whitePos = Position.fromString('B3');
        const blackPos = Position.fromString('C4');
        const board = Board.fromPieces([
            [whitePos, { color: PieceColor.WHITE, type: PieceType.PION }],
            [blackPos, { color: PieceColor.BLACK, type: PieceType.PION }],
        ]);
        
        const explorer = new Explorer(board);
        const moves = explorer.findValidMoves(whitePos);
        
        assert.equal(moves.size(), 1);
        assert.equal(moves.hasCaptured(), true);
        assert.equal(moves.getPosition(0).toString(), 'D5');
        assert.deepEqual(moves.getCapturePieces(0), [blackPos]);
    });

    test('find multi-capture chain for pion', () => {
        // White pion at B3, Black pions at C4 and E6.
        // Jump C4: land D5 (3,4). Jump E6: land F7 (5,6).
        const whitePos = Position.fromString('B3');
        const blackPos1 = Position.fromString('C4');
        const blackPos2 = Position.fromString('E6');
        const board = Board.fromPieces([
            [whitePos, { color: PieceColor.WHITE, type: PieceType.PION }],
            [blackPos1, { color: PieceColor.BLACK, type: PieceType.PION }],
            [blackPos2, { color: PieceColor.BLACK, type: PieceType.PION }],
        ]);
        
        const explorer = new Explorer(board);
        const moves = explorer.findValidMoves(whitePos);
        
        assert.equal(moves.size(), 1);
        assert.equal(moves.hasCaptured(), true);
        assert.equal(moves.getPosition(0).toString(), 'F7');
        assert.deepEqual(moves.getCapturePieces(0), [blackPos1, blackPos2]);
    });

    test('find dame capture over long diagonal line', () => {
        // White Dame at B1 (1,0). Black Pion at E4 (4,3).
        // Ray from B1: C2, D3, E4 (occupied), F5, G6, H7.
        // Landing square immediately behind E4 is F5.
        const whitePos = Position.fromString('B1');
        const blackPos = Position.fromString('E4');
        const board = Board.fromPieces([
            [whitePos, { color: PieceColor.WHITE, type: PieceType.DAME }],
            [blackPos, { color: PieceColor.BLACK, type: PieceType.PION }],
        ]);

        const explorer = new Explorer(board);
        const moves = explorer.findValidMoves(whitePos);

        assert.equal(moves.size(), 1);
        assert.equal(moves.hasCaptured(), true);
        assert.equal(moves.getPosition(0).toString(), 'F5');
        assert.deepEqual(moves.getCapturePieces(0), [blackPos]);
    });
});
