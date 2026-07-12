import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createBoardView } from '../../view/components/board/BoardView.mjs';

describe('BoardView square colors', () => {
  test('marks model-playable positions as dark squares', () => {
    const squares = [];
    const boardView = createBoardView({
      createBoard: () => {},
      createSquare: (position, display) => squares.push({ position, display }),
      render: () => {},
    });

    boardView.showBoard();

    assert.equal(squares.length, 64);
    for (const { position, display } of squares) {
      const isPlayable = (position.r + position.c) % 2 === 0;
      assert.equal(
        display.isDark,
        isPlayable,
        `square ${position.r},${position.c} has the wrong playable color`,
      );
    }
  });
});
