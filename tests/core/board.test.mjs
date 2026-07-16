import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';

describe('core/board', () => {
  test('constructor and validation invariants', () => {
    // Valid board construction
    assert.doesNotThrow(() => new Board(0, 0, 0));
    assert.doesNotThrow(() => new Board(0xff, 0xf0, 0x0f));

    // Invalid parameters throw RangeError
    assert.throws(() => new Board(-1, 0, 0), RangeError); // negative
    assert.throws(() => new Board(0x1_0000_0000n, 0, 0), RangeError); // out of uint32

    // Too many pieces (max 16)
    // 0x1ffff has 17 bits set
    assert.throws(() => new Board(0x1ffff, 0, 0), RangeError);

    // blackBits / dameBits marking empty squares
    assert.throws(() => new Board(0, 1, 0), RangeError);
    assert.throws(() => new Board(0, 0, 1), RangeError);
  });

  test('Board.empty', () => {
    const board = Board.empty();
    assert.equal(board.occBits, 0);
    assert.equal(board.blackBits, 0);
    assert.equal(board.dameBits, 0);

    // Verify immutability
    assert.equal(Object.isFrozen(board), true);
  });

  test('Board.setup initial layout', () => {
    const board = Board.setup();
    // White starts on rows 0 and 1. There are 4 dark squares per row.
    // Row 0 squares: A1 (idx 0), C1 (idx 1), E1 (idx 2), G1 (idx 3)
    // Row 1 squares: B2 (idx 4), D2 (idx 5), F2 (idx 6), H2 (idx 7)
    // Row 6 squares: A7 (idx 24), C7 (idx 25), E7 (idx 26), G7 (idx 27)
    // Row 7 squares: B8 (idx 28), D8 (idx 29), F8 (idx 30), H8 (idx 31)

    // White total: 8 pieces, Black total: 8 pieces
    // occBits should have bits 0..7 and 24..31 set.
    // occBits = 0xff0000ff
    assert.equal(board.occBits, 0xff0000ff >>> 0);
    // blackBits should have bits 24..31 set.
    // blackBits = 0xff000000
    assert.equal(board.blackBits, 0xff000000 >>> 0);
    assert.equal(board.dameBits, 0);
  });

  test('Board.fromPieces', () => {
    const p1 = Position.fromString('C1');
    const p2 = Position.fromString('G7');
    const pieces = [
      [p1, { color: PieceColor.WHITE, type: PieceType.PION }],
      [p2, { color: PieceColor.BLACK, type: PieceType.DAME }],
    ];

    const board = Board.fromPieces(pieces);
    assert.equal(board.isOccupied(p1), true);
    assert.equal(board.isBlackPiece(p1), false);
    assert.equal(board.isDamePiece(p1), false);

    assert.equal(board.isOccupied(p2), true);
    assert.equal(board.isBlackPiece(p2), true);
    assert.equal(board.isDamePiece(p2), true);

    // Duplicate squares throw
    assert.throws(
      () =>
        Board.fromPieces([
          [p1, pieces[0][1]],
          [p1, pieces[0][1]],
        ]),
      Error,
    );
  });

  test('Board.copy', () => {
    const original = Board.setup();
    const copy = Board.copy(original);
    assert.equal(original.equals(copy), true);
    assert.notEqual(original, copy); // different reference
  });

  test('isOccupied, isBlackPiece, isDamePiece queries', () => {
    const board = Board.setup();
    const b1 = Position.fromString('C1');
    const h7 = Position.fromString('G7');
    const emptySquare = Position.fromString('D4');

    assert.equal(board.isOccupied(b1), true);
    assert.equal(board.isBlackPiece(b1), false);
    assert.equal(board.isDamePiece(b1), false);

    assert.equal(board.isOccupied(h7), true);
    assert.equal(board.isBlackPiece(h7), true);
    assert.equal(board.isDamePiece(h7), false);

    assert.equal(board.isOccupied(emptySquare), false);
    assert.equal(board.isBlackPiece(emptySquare), false);
    assert.equal(board.isDamePiece(emptySquare), false);

    // Invalid position return false
    assert.equal(board.isOccupied({ x: 1, y: 0 }), false);
  });

  test('getPieces', () => {
    const p1 = Position.fromString('C1');
    const p2 = Position.fromString('G7');
    const board = Board.fromPieces([
      [p1, { color: PieceColor.WHITE, type: PieceType.PION }],
      [p2, { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);

    const whitePieces = board.getPieces(PieceColor.WHITE);
    assert.equal(whitePieces.size, 1);
    const p1Canonical = Position.allValid()[p1.hash()];
    assert.deepEqual(whitePieces.get(p1Canonical), {
      color: PieceColor.WHITE,
      type: PieceType.PION,
    });

    const blackPieces = board.getPieces(PieceColor.BLACK);
    assert.equal(blackPieces.size, 1);
    const p2Canonical = Position.allValid()[p2.hash()];
    assert.deepEqual(blackPieces.get(p2Canonical), {
      color: PieceColor.BLACK,
      type: PieceType.DAME,
    });
  });

  test('getPieceBits filters occupied squares by color', () => {
    const board = Board.setup();

    assert.equal(board.getPieceBits(PieceColor.WHITE), 0x000000ff);
    assert.equal(board.getPieceBits(PieceColor.BLACK), 0xff000000 >>> 0);
    assert.throws(() => board.getPieceBits(99), RangeError);
  });

  test('promotePiece mutation', () => {
    const p = Position.fromString('C1');
    const board = Board.fromPieces([[p, { color: PieceColor.WHITE, type: PieceType.PION }]]);

    const promoted = board.promotePiece(p);
    assert.equal(promoted.isDamePiece(p), true);
    assert.equal(board.isDamePiece(p), false); // original unchanged

    // Promote empty or already dame throws
    assert.throws(() => board.promotePiece(Position.fromString('D4')), Error);
    assert.throws(() => promoted.promotePiece(p), Error);
  });

  test('movePiece mutation', () => {
    const from = Position.fromString('C1');
    const to = Position.fromString('D2');
    const board = Board.fromPieces([[from, { color: PieceColor.WHITE, type: PieceType.PION }]]);

    const moved = board.movePiece(from, to);
    assert.equal(moved.isOccupied(from), false);
    assert.equal(moved.isOccupied(to), true);
    assert.equal(moved.isBlackPiece(to), false);

    // Invalid moves throw
    assert.throws(() => board.movePiece(Position.fromString('D4'), to), Error); // empty source
    assert.throws(() => board.movePiece(from, from), Error); // same square (Wait, from equals to throws as occupied in movePiece logic because bit fm and tm match)
  });

  test('removePiece mutation', () => {
    const p = Position.fromString('C1');
    const board = Board.fromPieces([[p, { color: PieceColor.WHITE, type: PieceType.PION }]]);

    const removed = board.removePiece(p);
    assert.equal(removed.isOccupied(p), false);

    // Remove empty throws
    assert.throws(() => board.removePiece(Position.fromString('D4')), Error);
  });

  test('encode and decode canonical round-trip', () => {
    const original = Board.setup();
    const encoded = original.encode();
    assert.equal(typeof encoded, 'bigint');

    const decoded = Board.decode(encoded);
    assert.equal(original.equals(decoded), true);

    // Test custom board encoding/decoding with Dames
    const custom = Board.fromPieces([
      [Position.fromString('C1'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [Position.fromString('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const customDecoded = Board.decode(custom.encode());
    assert.equal(custom.equals(customDecoded), true);

    // Invalid decode inputs
    assert.throws(() => Board.decode(-1n), RangeError);
    assert.throws(() => Board.decode(1n << 64n), RangeError);
  });

  test('equals and hashCode', () => {
    const b1 = Board.setup();
    const b2 = Board.setup();
    const b3 = Board.empty();

    assert.equal(b1.equals(b2), true);
    assert.equal(b1.equals(b3), false);
    assert.equal(b1.hashCode(), b2.hashCode());
  });
});
