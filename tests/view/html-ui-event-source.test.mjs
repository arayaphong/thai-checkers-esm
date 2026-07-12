import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createUiEventSource } from '../../view/html/HtmlUiEventSource.mjs';

const createHarness = () => {
  let handleClick;
  const source = createUiEventSource({
    root: {
      addEventListener: (type, listener) => {
        assert.equal(type, 'click');
        handleClick = listener;
      },
    },
  });
  const commands = [];
  source.onUiCommand((command) => commands.push(command));

  return {
    commands,
    click: (matches) =>
      handleClick({
        target: {
          closest: (selector) => matches[selector] ?? null,
        },
      }),
  };
};

const square = ({ row, col, piece = false, dot = false }) => ({
  dataset: { row, col },
  querySelector: (selector) =>
    (selector === '.piece' && piece) || (selector === '.dot' && dot) ? {} : null,
});

describe('HtmlUiEventSource', () => {
  test('emits model-coordinate board commands', () => {
    const harness = createHarness();

    harness.click({ '[data-row]': square({ row: '5', col: '2', piece: true }) });
    harness.click({ '[data-row]': square({ row: '4', col: '3', dot: true }) });
    harness.click({ '[data-row]': square({ row: '1', col: '6' }) });

    assert.deepEqual(harness.commands, [
      { type: 'selectPiece', position: { r: 5, c: 2 } },
      { type: 'chooseMoveTarget', position: { r: 4, c: 3 } },
      { type: 'chooseMoveTarget', position: { r: 1, c: 6 } },
    ]);
  });

  test('emits config, lifecycle, and setup commands', () => {
    const harness = createHarness();

    harness.click({ '[data-mode]': { dataset: { mode: 'pve' } } });
    harness.click({ '[data-diff]': { dataset: { diff: 'hard' } } });
    harness.click({ '#cancelBtn': {} });
    harness.click({ '#startBtn': {} });
    harness.click({ '#resetBtn': {} });
    harness.click({ '[data-ui-role="setupPanel"]': {} });

    assert.deepEqual(harness.commands, [
      { type: 'chooseGameMode', mode: 'pve' },
      { type: 'chooseDifficulty', difficulty: 'hard' },
      { type: 'collapseSetup' },
      { type: 'startGame' },
      { type: 'restartGame' },
      { type: 'expandSetup' },
    ]);
  });
});
