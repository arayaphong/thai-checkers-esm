import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { Position } from '../../../core/Position.mjs';
import { expandRoute, singleRoute } from '../../../core/moves/expand.mjs';

describe('core/moves/expand', () => {
  test('expandRoute with empty waypoints', () => {
    assert.deepEqual(expandRoute([]), []);
  });

  test('expandRoute with single waypoint', () => {
    const p = Position.fromString('C1');
    assert.deepEqual(expandRoute([p]), [p]);
  });

  test('expandRoute with multiple adjacent waypoints', () => {
    const p1 = Position.fromString('C1'); // (2, 0)
    const p2 = Position.fromString('D2'); // (3, 1)
    const p3 = Position.fromString('E3'); // (4, 2)

    // adjacent squares (1 step apart)
    assert.deepEqual(expandRoute([p1, p2, p3]), [p1, p2, p3]);
  });

  test('expandRoute with multi-step gaps', () => {
    const p1 = Position.fromString('C1'); // (2, 0)
    const p2 = Position.fromString('F4'); // (5, 3) - distance 3

    const expanded = expandRoute([p1, p2]);
    assert.equal(expanded.length, 4);
    assert.equal(expanded[0].toString(), 'C1');
    assert.equal(expanded[1].toString(), 'D2');
    assert.equal(expanded[2].toString(), 'E3');
    assert.equal(expanded[3].toString(), 'F4');
  });

  test('singleRoute finds unique match', () => {
    const p1 = Position.fromString('C1');
    const p2 = Position.fromString('E3');

    const moves = [
      {
        from: p1,
        to: p2,
        path: [p1, p2],
      },
      {
        from: Position.fromString('D2'),
        to: Position.fromString('F4'),
        path: [Position.fromString('D2'), Position.fromString('F4')],
      },
    ];

    const route = singleRoute(moves, 'C1', 'E3');
    assert.notEqual(route, null);
    assert.equal(route.length, 3);
    assert.equal(route[0].toString(), 'C1');
    assert.equal(route[1].toString(), 'D2');
    assert.equal(route[2].toString(), 'E3');
  });

  test('singleRoute returns null on no match or ambiguous match', () => {
    const p1 = Position.fromString('C1');
    const p2 = Position.fromString('E3');

    const moves = [
      {
        from: p1,
        to: p2,
        path: [p1, p2],
      },
      {
        // Ambiguous move (same endpoints, e.g. different captured pieces)
        from: p1,
        to: p2,
        path: [p1, Position.fromString('D2'), p2],
      },
    ];

    // Ambiguous match returns null
    assert.equal(singleRoute(moves, 'C1', 'E3'), null);

    // No match returns null
    assert.equal(singleRoute(moves, 'C1', 'F4'), null);
  });
});
