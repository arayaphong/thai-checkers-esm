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

  test('control-panel renders correct difficulty selection colors', () =>
    withFakeDocument(() => {
      const panel = createFakeElement();
      const gameArea = createFakeElement();
      const surface = createControlPanelSurface({
        getSetupPanel: () => panel,
        getGameArea: () => gameArea,
      });

      surface.buildDifficultyButtons([
        { key: 'easy', label: 'Easy', description: 'Easy desc' },
        { key: 'medium', label: 'Medium', description: 'Medium desc' },
        { key: 'hard', label: 'Hard', description: 'Hard desc' },
      ]);

      const state = (selectedDifficulty) => ({
        isCollapsed: false,
        gameConfig: {
          whiteText: 'White',
          blackText: 'Black',
          difficultyLabel: 'Easy',
        },
        selectedMode: 'eve',
        selectedDifficulty,
        isDifficultyVisible: true,
        isCancelable: false,
      });

      const expandedEl = panel.children[1];
      const difficultyRowEl = expandedEl.children[4];
      const easyBtn = difficultyRowEl.children[0];
      const mediumBtn = difficultyRowEl.children[1];
      const hardBtn = difficultyRowEl.children[2];

      // 1. Easy selected
      surface.render(state('easy'));
      assert.match(easyBtn.className, /emerald/);
      assert.match(mediumBtn.className, /neutral-800/);
      assert.match(hardBtn.className, /neutral-800/);

      // 2. Medium selected
      surface.render(state('medium'));
      assert.match(easyBtn.className, /neutral-800/);
      assert.match(mediumBtn.className, /amber/);
      assert.match(hardBtn.className, /neutral-800/);

      // 3. Hard selected
      surface.render(state('hard'));
      assert.match(easyBtn.className, /neutral-800/);
      assert.match(mediumBtn.className, /neutral-800/);
      assert.match(hardBtn.className, /rose/);
    }));
});
