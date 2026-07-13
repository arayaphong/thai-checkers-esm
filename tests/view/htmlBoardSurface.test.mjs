import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createBoardSurface } from '../../view/html/surfaces/htmlBoardSurface.mjs';
import { boardClassMap } from '../../view/html/styles/boardClassMap.mjs';

describe('HtmlBoardSurface initialization', () => {
  test('creates 64 squares and marks playable positions as dark', () => {
    const previousDocument = globalThis.document;
    const squares = [];
    const board = {
      children: [],
      append(element) {
        this.children.push(element);
      },
    };
    globalThis.document = {
      createElement: () => ({
        className: '',
        dataset: {},
        insertAdjacentHTML: () => {},
      }),
    };

    try {
      createBoardSurface({
        getBoard: () => board,
        registerSquare: (position, element) => squares.push({ position, element }),
      });
    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }

    assert.equal(squares.length, 64);
    for (const { position, element } of squares) {
      const isPlayable = (position.r + position.c) % 2 === 0;
      assert.equal(
        element.className === boardClassMap.squareDark,
        isPlayable,
        `square ${position.r},${position.c} has the wrong playable color`,
      );
    }
  });
});
