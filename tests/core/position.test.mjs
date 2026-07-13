import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { Position } from '../../core/Position.mjs';

describe('core/position', () => {
  test('static constants', () => {
    assert.equal(Position.BOARD_SIZE, 8);
    assert.equal(Position.MAX_POSITIONS, 32);
  });

  test('Position.isValid', () => {
    // Valid dark squares (x + y is even)
    assert.equal(Position.isValid(0, 0), true);
    assert.equal(Position.isValid(1, 1), true);
    assert.equal(Position.isValid(2, 2), true);
    assert.equal(Position.isValid(6, 6), true);

    // Invalid squares (x + y is odd)
    assert.equal(Position.isValid(1, 0), false);
    assert.equal(Position.isValid(3, 2), false);

    // Out of bounds
    assert.equal(Position.isValid(-1, 0), false);
    assert.equal(Position.isValid(8, 0), false);
    assert.equal(Position.isValid(0, -1), false);
    assert.equal(Position.isValid(0, 8), false);

    // Non-integers
    assert.equal(Position.isValid(1.5, 0), false);
    assert.equal(Position.isValid('1', 0), false);
  });

  test('constructor and validation', () => {
    assert.doesNotThrow(() => new Position(0));
    assert.doesNotThrow(() => new Position(31));

    assert.throws(() => new Position(-1), RangeError);
    assert.throws(() => new Position(32), RangeError);
    assert.throws(() => new Position(1.5), RangeError);
    assert.throws(() => new Position('0'), RangeError);
  });

  test('Position.fromCoords', () => {
    // Valid coordinate inputs
    const p1 = Position.fromCoords(0, 0); // index = 0 + 4 * 0 = 0
    assert.equal(p1.hash(), 0);

    const p2 = Position.fromCoords(1, 1); // index = 0 + 4 * 1 = 4
    assert.equal(p2.hash(), 4);

    // Invalid coordinates throw
    assert.throws(() => Position.fromCoords(1, 0), Error);
    assert.throws(() => Position.fromCoords(8, 8), Error);
  });

  test('Position.fromIndex', () => {
    const p = Position.fromIndex(15);
    assert.equal(p.hash(), 15);
  });

  test('Position.fromString algebraic notation parser', () => {
    const p1 = Position.fromString('A1'); // coords (0, 0)
    assert.equal(p1.x, 0);
    assert.equal(p1.y, 0);

    const p2 = Position.fromString('B2'); // coords (1, 1)
    assert.equal(p2.x, 1);
    assert.equal(p2.y, 1);

    const p3 = Position.fromString('G7'); // coords (6, 6)
    assert.equal(p3.x, 6);
    assert.equal(p3.y, 6);

    // Invalid strings throw
    assert.throws(() => Position.fromString('A0'), Error);
    assert.throws(() => Position.fromString('A9'), Error);
    assert.throws(() => Position.fromString('I1'), Error);
    assert.throws(() => Position.fromString('B'), Error);
    assert.throws(() => Position.fromString('B1a'), Error);
  });

  test('x and y coordinate getters', () => {
    for (let index = 0; index < 32; index++) {
      const p = Position.fromIndex(index);
      const x = p.x;
      const y = p.y;
      assert.equal(
        Position.isValid(x, y),
        true,
        `Index ${index} coordinates (${x}, ${y}) must be valid`,
      );

      // Recompute index from recovered coordinates
      const computedIndex = Math.floor(x / 2) + 4 * y;
      assert.equal(computedIndex, index, `Index ${index} should round-trip to (${x}, ${y})`);
    }
  });

  test('hash method', () => {
    const p = Position.fromIndex(10);
    assert.equal(p.hash(), 10);
  });

  test('toString method algebraic notation format', () => {
    assert.equal(Position.fromCoords(0, 0).toString(), 'A1');
    assert.equal(Position.fromCoords(1, 1).toString(), 'B2');
    assert.equal(Position.fromCoords(6, 6).toString(), 'G7');
  });

  test('equals method', () => {
    const p1 = Position.fromIndex(5);
    const p2 = Position.fromIndex(5);
    const p3 = Position.fromIndex(6);

    assert.equal(p1.equals(p2), true);
    assert.equal(p1.equals(p3), false);
  });

  test('compare method for sorting', () => {
    const p1 = Position.fromIndex(5);
    const p2 = Position.fromIndex(10);

    assert.equal(p1.compare(p2) < 0, true);
    assert.equal(p2.compare(p1) > 0, true);
    assert.equal(p1.compare(p1), 0);
  });

  test('Position.allValid precomputed instances list', () => {
    const all = Position.allValid();
    assert.equal(all.length, 32);
    for (let i = 0; i < 32; i++) {
      assert.equal(all[i] instanceof Position, true);
      assert.equal(all[i].hash(), i);
    }
    // Verify read-only / frozen properties
    assert.throws(() => {
      all[0] = null;
    });
  });
});
