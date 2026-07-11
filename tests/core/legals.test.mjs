import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { Position } from '../../core/position.mjs';
import { CaptureTrace, Legals } from '../../core/legals.mjs';

describe('core/legals', () => {
  describe('CaptureTrace', () => {
    test('valid constructor and properties', () => {
      const p1 = Position.fromString('C4'); // captured
      const p2 = Position.fromString('D5'); // landing
      const p3 = Position.fromString('E6'); // captured
      const p4 = Position.fromString('F7'); // landing

      const trace = new CaptureTrace([p1, p2, p3, p4]);

      assert.equal(trace.length, 2);
      assert.deepEqual(trace.sequence, [p1, p2, p3, p4]);
      assert.deepEqual(trace.captured, [p1, p3]);

      const from = Position.fromString('B3');
      assert.deepEqual(trace.path(from), [from, p2, p4]);
      assert.equal(trace.finalLanding.equals(p4), true);

      assert.equal(trace.toString(), '×C4 →D5 ×E6 →F7');
    });

    test('invalid constructor parameters throw', () => {
      assert.throws(() => new CaptureTrace([]), Error);
      assert.throws(() => new CaptureTrace([Position.fromString('C4')]), Error); // odd length
      assert.throws(() => new CaptureTrace([null, Position.fromString('D5')]), TypeError); // non-Position
    });
  });

  describe('Legals', () => {
    test('constructor token check', () => {
      assert.throws(() => new Legals(Symbol('wrong'), [], false), TypeError);
    });

    test('fromRegularMoves factory', () => {
      const p1 = Position.fromString('B3');
      const p2 = Position.fromString('D3');

      const legals = Legals.fromRegularMoves([p1, p2]);

      assert.equal(legals.size(), 2);
      assert.equal(legals.empty(), false);
      assert.equal(legals.hasCaptured(), false);

      assert.equal(legals.getPosition(0).equals(p1), true);
      assert.equal(legals.getPosition(1).equals(p2), true);

      // getCapturePieces throws for regular moves
      assert.throws(() => legals.getCapturePieces(0), Error);

      // getTrace returns undefined for regular moves
      assert.equal(legals.getTrace(0), undefined);

      // getMoveInfo returns correct MoveInfo structure
      const moveInfo = legals.getMoveInfo(0);
      assert.equal(moveInfo.targetPosition.equals(p1), true);
      assert.deepEqual(moveInfo.capturedPositions, []);
      assert.deepEqual(moveInfo.path, [p1]);
    });

    test('fromCaptures factory', () => {
      const cap1 = Position.fromString('C4');
      const land1 = Position.fromString('D5');
      const cap2 = Position.fromString('E6');
      const land2 = Position.fromString('F7');

      const seq1 = [cap1, land1];
      const seq2 = [cap1, land1, cap2, land2];

      const legals = Legals.fromCaptures([seq1, seq2]);

      assert.equal(legals.size(), 2);
      assert.equal(legals.empty(), false);
      assert.equal(legals.hasCaptured(), true);

      assert.equal(legals.getPosition(0).equals(land1), true);
      assert.equal(legals.getPosition(1).equals(land2), true);

      assert.deepEqual(legals.getCapturePieces(0), [cap1]);
      assert.deepEqual(legals.getCapturePieces(1), [cap1, cap2]);

      const trace1 = legals.getTrace(0);
      assert.equal(trace1 instanceof CaptureTrace, true);
      assert.deepEqual(trace1.sequence, seq1);

      const trace2 = legals.getTrace(1);
      assert.equal(trace2 instanceof CaptureTrace, true);
      assert.deepEqual(trace2.sequence, seq2);
    });

    test('iterator implementation', () => {
      const p1 = Position.fromString('B3');
      const p2 = Position.fromString('D3');
      const legals = Legals.fromRegularMoves([p1, p2]);

      const list = [...legals];
      assert.equal(list.length, 2);
      assert.equal(list[0].targetPosition.equals(p1), true);
      assert.equal(list[1].targetPosition.equals(p2), true);
    });

    test('out of bounds checks', () => {
      const legals = Legals.fromRegularMoves([Position.fromString('B3')]);
      assert.throws(() => legals.getPosition(-1), RangeError);
      assert.throws(() => legals.getPosition(1), RangeError);
      assert.throws(() => legals.getPosition(1.5), RangeError);
    });
  });
});
