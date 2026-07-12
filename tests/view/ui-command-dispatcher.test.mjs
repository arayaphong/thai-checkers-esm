import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createUiCommandDispatcher } from '../../view/UiCommandDispatcher.mjs';

const createHarness = ({ gameStarted = true, aiThinking = false } = {}) => {
  const calls = [];
  const controller = {
    selectPiece: (position) => calls.push(['selectPiece', position]),
    attemptMove: (position) => calls.push(['attemptMove', position]),
    updateConfig: (config) => calls.push(['updateConfig', config]),
    reset: (config) => calls.push(['reset', config]),
  };
  const binder = {
    isGameStarted: () => gameStarted,
    isAIThinking: () => aiThinking,
    markGameStarted: () => calls.push(['markGameStarted']),
    markGameStopped: () => calls.push(['markGameStopped']),
    markSetupExpanded: () => calls.push(['markSetupExpanded']),
    markSetupCollapsed: () => calls.push(['markSetupCollapsed']),
  };
  const modeOptions = [
    { key: 'pvp', whiteIsAI: false, blackIsAI: false },
    { key: 'pve', whiteIsAI: false, blackIsAI: true },
  ];

  return { calls, dispatch: createUiCommandDispatcher(controller, binder, modeOptions) };
};

describe('UiCommandDispatcher', () => {
  test('maps game commands to controller operations', () => {
    const { calls, dispatch } = createHarness();

    dispatch({ type: 'selectPiece', position: { r: 5, c: 0 } });
    dispatch({ type: 'chooseMoveTarget', position: { r: 4, c: 1 } });
    dispatch({ type: 'chooseGameMode', mode: 'pve' });
    dispatch({ type: 'chooseDifficulty', difficulty: 'hard' });
    dispatch({ type: 'startGame' });
    dispatch({ type: 'restartGame' });
    dispatch({ type: 'expandSetup' });
    dispatch({ type: 'collapseSetup' });

    assert.deepEqual(calls, [
      ['selectPiece', { r: 5, c: 0 }],
      ['attemptMove', { r: 4, c: 1 }],
      ['updateConfig', { whiteIsAI: false, blackIsAI: true }],
      ['updateConfig', { aiDifficulty: 'hard' }],
      ['markGameStarted'],
      ['reset', { paused: false }],
      ['markGameStopped'],
      ['reset', { paused: true }],
      ['markSetupExpanded'],
      ['markSetupCollapsed'],
    ]);
  });

  test('ignores unknown and unavailable-mode commands', () => {
    const { calls, dispatch } = createHarness();

    dispatch({ type: 'chooseGameMode', mode: 'missing' });
    dispatch({ type: 'unknown' });
    dispatch(null);

    assert.deepEqual(calls, []);
  });

  test('blocks board commands outside a playable human turn', () => {
    const stopped = createHarness({ gameStarted: false });
    const thinking = createHarness({ aiThinking: true });

    for (const { dispatch } of [stopped, thinking]) {
      dispatch({ type: 'selectPiece', position: { r: 5, c: 0 } });
      dispatch({ type: 'chooseMoveTarget', position: { r: 4, c: 1 } });
    }

    assert.deepEqual(stopped.calls, []);
    assert.deepEqual(thinking.calls, []);
  });
});
