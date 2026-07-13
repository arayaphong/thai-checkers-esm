import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Explorer } from '../../core/Explorer.mjs';

describe('core/explorer', () => {
  test('throws error if from position is empty', () => {
    const board = Board.empty();
    const explorer = new Explorer(board);
    const p = Position.fromString('C1');
    assert.throws(() => explorer.findValidMoves(p), Error);
  });

  test('find valid quiet moves for a white pion', () => {
    // Setup a white pion at C3 (coords: 2, 2)
    // Valid forward directions are B4 (1, 3) and D4 (3, 3)
    const p = Position.fromString('C3');
    const board = Board.fromPieces([[p, { color: PieceColor.WHITE, type: PieceType.PION }]]);
    const explorer = new Explorer(board);
    const moves = explorer.findValidMoves(p);

    assert.equal(moves.size(), 2);
    assert.equal(moves.hasCaptured(), false);

    const landingCoords = [moves.getPosition(0).toString(), moves.getPosition(1).toString()];
    assert.equal(landingCoords.includes('B4'), true);
    assert.equal(landingCoords.includes('D4'), true);
  });

  test('find valid quiet moves for a dame (long slides)', () => {
    // Setup a white dame at D4 (coords: 3, 3)
    // Diagonals:
    // dx=-1, dy=-1: C3 (2,2), B2 (1,1), A1 (0,0) -> 3 squares
    // dx=1,  dy=-1: E3 (4,2), F2 (5,1), G1 (6,0) -> 3 squares
    // dx=-1, dy=1:  C5 (2,4), B6 (1,5), A7 (0,6) -> 3 squares
    // dx=1,  dy=1:  E5 (4,4), F6 (5,5), G7 (6,6), H8 (7,7) -> 4 squares
    const p = Position.fromString('D4');
    const board = Board.fromPieces([[p, { color: PieceColor.WHITE, type: PieceType.DAME }]]);
    const explorer = new Explorer(board);
    const moves = explorer.findValidMoves(p);

    assert.equal(moves.hasCaptured(), false);
    // Total open squares along the diagonals: 3 + 3 + 3 + 4 = 13
    assert.equal(moves.size(), 13);

    // Pick some slide coordinates to verify
    const list = [...moves].map((m) => m.targetPosition.toString());
    assert.equal(list.includes('A1'), true);
    assert.equal(list.includes('G1'), true);
    assert.equal(list.includes('A7'), true);
    assert.equal(list.includes('H8'), true);
  });

  test('find single capture for white pion', () => {
    // White pion at C3, Black pion at D4.
    // C3 (2,2) -> jump over D4 (3,3) -> land on E5 (4,4).
    const whitePos = Position.fromString('C3');
    const blackPos = Position.fromString('D4');
    const board = Board.fromPieces([
      [whitePos, { color: PieceColor.WHITE, type: PieceType.PION }],
      [blackPos, { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);

    const explorer = new Explorer(board);
    const moves = explorer.findValidMoves(whitePos);

    assert.equal(moves.size(), 1);
    assert.equal(moves.hasCaptured(), true);
    assert.equal(moves.getPosition(0).toString(), 'E5');
    assert.deepEqual(moves.getCapturePieces(0), [blackPos]);
  });

  test('find multi-capture chain for pion', () => {
    // White pion at C3, Black pions at D4 and F6.
    // Jump D4: land E5 (4,4). Jump F6: land G7 (6,6).
    const whitePos = Position.fromString('C3');
    const blackPos1 = Position.fromString('D4');
    const blackPos2 = Position.fromString('F6');
    const board = Board.fromPieces([
      [whitePos, { color: PieceColor.WHITE, type: PieceType.PION }],
      [blackPos1, { color: PieceColor.BLACK, type: PieceType.PION }],
      [blackPos2, { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);

    const explorer = new Explorer(board);
    const moves = explorer.findValidMoves(whitePos);

    assert.equal(moves.size(), 1);
    assert.equal(moves.hasCaptured(), true);
    assert.equal(moves.getPosition(0).toString(), 'G7');
    assert.deepEqual(moves.getCapturePieces(0), [blackPos1, blackPos2]);
  });

  test('find dame capture over long diagonal line', () => {
    // White Dame at C1 (2,0). Black Pion at F4 (5,3).
    // Ray from C1: D2, E3, F4 (occupied), G5, H6.
    // Landing square immediately behind F4 is G5.
    const whitePos = Position.fromString('C1');
    const blackPos = Position.fromString('F4');
    const board = Board.fromPieces([
      [whitePos, { color: PieceColor.WHITE, type: PieceType.DAME }],
      [blackPos, { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);

    const explorer = new Explorer(board);
    const moves = explorer.findValidMoves(whitePos);

    assert.equal(moves.size(), 1);
    assert.equal(moves.hasCaptured(), true);
    assert.equal(moves.getPosition(0).toString(), 'G5');
    assert.deepEqual(moves.getCapturePieces(0), [blackPos]);
  });
});
