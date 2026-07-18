import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createBoardSurface } from '../../view/html/surfaces/htmlBoardSurface.mjs';
import { boardClassMap } from '../../view/html/styles/boardClassMap.mjs';

describe('HtmlBoardSurface', () => {
  test('initialization creates 64 squares and marks playable positions as dark', () => {
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
        style: {},
        setAttribute: () => {},
        querySelector: () => null,
        append: () => {},
        appendChild: () => {},
        insertAdjacentHTML: () => {},
      }),
      createElementNS: (ns, tag) => globalThis.document.createElement(tag),
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
      const isPlayable = (position.r + position.c) % 2 === 1;
      assert.equal(
        element.className === boardClassMap.squareDark,
        isPlayable,
        `square ${position.r},${position.c} has the wrong playable color`,
      );
    }
  });

  test('render method updates the SVG path coordinates for lastMovePath', () => {
    const previousDocument = globalThis.document;
    const squares = new Map();
    const board = {
      children: [],
      append(element) {
        this.children.push(element);
      },
    };

    const pathLineMock = {
      attributes: new Map(),
      setAttribute(name, val) { this.attributes.set(name, val); },
      getAttribute(name) { return this.attributes.get(name); },
    };

    globalThis.document = {
      createElement: (tag) => {
        const classList = {
          classes: new Set(),
          add(...names) { names.forEach(n => this.classes.add(n)); },
          remove(...names) { names.forEach(n => this.classes.delete(n)); },
          contains(name) { return this.classes.has(name); }
        };
        const el = {
          tagName: tag.toUpperCase(),
          className: '',
          classList,
          dataset: {},
          style: {},
          insertAdjacentHTML: () => {},
          querySelector: (sel) => {
            if (sel === '#movePathLine') return pathLineMock;
            return null;
          },
          append: () => {},
          appendChild: () => {},
          querySelectorAll: () => [],
          setAttribute: (name, val) => { el.attributes[name] = val; },
          attributes: {},
        };
        return el;
      },
      createElementNS: (ns, tag) => globalThis.document.createElement(tag),
    };

    try {
      const surface = createBoardSurface({
        getBoard: () => board,
        registerSquare: (position, element) => {
          squares.set(`${position.r},${position.c}`, element);
        },
        getSquare: (position) => squares.get(`${position.r},${position.c}`),
      });

      // Render a state with path coordinates
      surface.render({
        pieces: [],
        selectedPosition: null,
        moveablePositions: [],
        mandatoryCapturePosition: null,
        targetSquares: [],
        captureTargets: [],
        lastMovePath: [{ r: 2, c: 3 }, { r: 3, c: 4 }],
        lastCapturedPieces: [],
      });

      // Verify path coordinates correctly generated
      assert.equal(pathLineMock.getAttribute('d'), 'M 35 25 L 45 35');

    } finally {
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
    }
  });
});
