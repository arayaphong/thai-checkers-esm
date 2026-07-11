import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { Position } from '../../../core/position.mjs';
import { expandRoute, singleRoute } from '../../../core/moves/expand.mjs';

describe('core/moves/expand', () => {
  test('expandRoute with empty waypoints', () => {
    assert.deepEqual(expandRoute([]), []);
  });

  test('expandRoute with single waypoint', () => {
    const p = Position.fromString('B1');
    assert.deepEqual(expandRoute([p]), [p]);
  });

  test('expandRoute with multiple adjacent waypoints', () => {
    const p1 = Position.fromString('B1'); // (1, 0)
    const p2 = Position.fromString('C2'); // (2, 1)
    const p3 = Position.fromString('D3'); // (3, 2)

    // adjacent squares (1 step apart)
    assert.deepEqual(expandRoute([p1, p2, p3]), [p1, p2, p3]);
  });

  test('expandRoute with multi-step gaps', () => {
    const p1 = Position.fromString('B1'); // (1, 0)
    const p2 = Position.fromString('E4'); // (4, 3) - distance 3

    const expanded = expandRoute([p1, p2]);
    assert.equal(expanded.length, 4);
    assert.equal(expanded[0].toString(), 'B1');
    assert.equal(expanded[1].toString(), 'C2');
    assert.equal(expanded[2].toString(), 'D3');
    assert.equal(expanded[3].toString(), 'E4');
  });

  test('singleRoute finds unique match', () => {
    const p1 = Position.fromString('B1');
    const p2 = Position.fromString('D3');

    const moves = [
      {
        from: p1,
        to: p2,
        path: [p1, p2],
      },
      {
        from: Position.fromString('C2'),
        to: Position.fromString('E4'),
        path: [Position.fromString('C2'), Position.fromString('E4')],
      },
    ];

    const route = singleRoute(moves, 'B1', 'D3');
    assert.notEqual(route, null);
    assert.equal(route.length, 3);
    assert.equal(route[0].toString(), 'B1');
    assert.equal(route[1].toString(), 'C2');
    assert.equal(route[2].toString(), 'D3');
  });

  test('singleRoute returns null on no match or ambiguous match', () => {
    const p1 = Position.fromString('B1');
    const p2 = Position.fromString('D3');

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
        path: [p1, Position.fromString('C2'), p2],
      },
    ];

    // Ambiguous match returns null
    assert.equal(singleRoute(moves, 'B1', 'D3'), null);

    // No match returns null
    assert.equal(singleRoute(moves, 'B1', 'E4'), null);
  });
});
