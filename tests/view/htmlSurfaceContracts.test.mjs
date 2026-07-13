import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createControlPanelSurface } from '../../view/html/surfaces/htmlControlPanelSurface.mjs';
import { createMotionSurface } from '../../view/html/surfaces/htmlMotionSurface.mjs';
import { layoutClassMap } from '../../view/html/styles/layoutClassMap.mjs';

const createClassList = (element) => {
  const tokens = () => new Set(element.className.split(/\s+/).filter(Boolean));
  const replace = (next) => {
    element.className = [...next].join(' ');
  };

  return {
    add: (...values) => {
      const next = tokens();
      values.forEach((value) => next.add(value));
      replace(next);
    },
    remove: (...values) => {
      const next = tokens();
      values.forEach((value) => next.delete(value));
      replace(next);
    },
    contains: (value) => tokens().has(value),
    toggle: (value, force) => {
      const next = tokens();
      const enabled = force === undefined ? !next.has(value) : force;
      if (enabled) next.add(value);
      else next.delete(value);
      replace(next);
      return enabled;
    },
  };
};

const createFakeElement = (tagName = 'div') => {
  const element = {
    tagName: tagName.toUpperCase(),
    className: '',
    children: [],
    dataset: {},
    style: {},
    textContent: '',
    innerHTML: '',
    append(...children) {
      this.children.push(...children);
    },
  };
  element.classList = createClassList(element);
  return element;
};

const withFakeDocument = (run) => {
  const previousDocument = globalThis.document;
  globalThis.document = { createElement: (tagName) => createFakeElement(tagName) };
  try {
    return run();
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
};

describe('HTML surface contracts', () => {
  test('control-panel render toggles both inactive game-area classes only', () =>
    withFakeDocument(() => {
      const panel = createFakeElement();
      const gameArea = createFakeElement();
      gameArea.className = 'game-area-base unrelated-class';
      const surface = createControlPanelSurface({
        getSetupPanel: () => panel,
        getGameArea: () => gameArea,
      });
      const state = (isCollapsed) => ({
        isCollapsed,
        gameConfig: {
          whiteText: 'White',
          blackText: 'Black',
          difficultyLabel: null,
        },
        selectedMode: 'pvp',
        selectedDifficulty: 'medium',
        isDifficultyVisible: false,
        isCancelable: false,
      });
      const inactiveClasses = layoutClassMap.gameAreaInactiveModifier.split(' ');

      surface.render(state(false));
      inactiveClasses.forEach((className) => {
        assert.equal(gameArea.classList.contains(className), true);
      });
      assert.equal(gameArea.classList.contains('game-area-base'), true);
      assert.equal(gameArea.classList.contains('unrelated-class'), true);

      surface.render(state(true));
      inactiveClasses.forEach((className) => {
        assert.equal(gameArea.classList.contains(className), false);
      });
      assert.equal(gameArea.classList.contains('game-area-base'), true);
      assert.equal(gameArea.classList.contains('unrelated-class'), true);
    }));

  test('motion surface implements the five-method GameView animation contract', () =>
    withFakeDocument(() => {
      const board = createFakeElement();
      const surface = createMotionSurface({ getBoard: () => board });
      const expectedMethods = [
        'showMoveRipple',
        'showPieceMoving',
        'showPieceLanding',
        'showCapturedPieceFading',
        'clearAnimationLayer',
      ].sort();

      assert.deepEqual(Object.keys(surface).sort(), expectedMethods);
      expectedMethods.forEach((method) => assert.equal(typeof surface[method], 'function'));
      assert.equal(board.children.length, 1, 'surface installs one animation layer');
    }));
});
