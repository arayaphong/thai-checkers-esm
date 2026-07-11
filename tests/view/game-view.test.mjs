import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createGameView } from '../../view/GameView.mjs';

// Fake animation surface: each effect returns a controllable promise.
// Tests resolve individual stages to drive the strict lift → slide →
// land → fade sequence.
const createFakeAnimationView = () => {
  const calls = [];
  const pending = new Map();

  const makeEffect = (name) => (...args) => {
    const signal = args[args.length - 1];
    const { promise, resolve, reject } = Promise.withResolvers();
    pending.set(name, { resolve, reject, promise });
    calls.push({ name, args });
    signal?.addEventListener('abort', () => resolve(), { once: true });
    return promise;
  };

  return {
    calls,
    pending,
    resolve: (name) => pending.get(name)?.resolve(),
    reject: (name, reason) => pending.get(name)?.reject(reason),
    resolveAll: async () => {
      let lastSize;
      do {
        lastSize = pending.size;
        for (const { resolve } of pending.values()) resolve();
        await Promise.resolve();
      } while (pending.size > lastSize);
    },
    rejectAll: (reason) => {
      for (const { reject } of pending.values()) reject(reason);
    },
    showMoveRipple: makeEffect('showMoveRipple'),
    showPieceMoving: makeEffect('showPieceMoving'),
    showCapturedPieceFading: makeEffect('showCapturedPieceFading'),
    showPieceLanding: makeEffect('showPieceLanding'),
    clearAnimationLayer: () => calls.push({ name: 'clearAnimationLayer', args: [] }),
  };
};

const createFakeGameView = () => {
  const boardRenders = [];
  const animationView = createFakeAnimationView();
  const gameView = createGameView({
    boardView: { render: (board) => boardRenders.push(board) },
    animationView,
    statusView: { render: () => {} },
    controlPanelView: { render: () => {} },
    layoutSurface: { showGameAreaActive: () => {}, showGameAreaDimmed: () => {} },
  });
  return { gameView, animationView, boardRenders };
};

const moveDisplay = (label, victim = false) => ({
  from: { r: 0, c: 0 },
  to: { r: 1, c: 1 },
  piece: { color: 'white', rank: 'man' },
  victimPosition: victim ? { r: 0, c: 1 } : null,
  victimDisplay: victim ? { color: 'black', rank: 'man' } : null,
  label,
});

const settledViewState = (label, hints = {}) => ({
  board: {
    label,
    pieces: [{ position: { r: 1, c: 1 }, color: 'white', rank: 'man' }],
    selectedPosition: hints.selectedPosition ?? null,
    mandatoryCapturePosition: hints.mandatoryCapturePosition ?? null,
    moveablePositions: hints.moveablePositions ?? [],
    targetSquares: hints.targetSquares ?? [],
    captureTargets: hints.captureTargets ?? [],
  },
  status: {},
  controlPanel: { collapsed: true },
});

// Flush enough microtask turns for the chain inside GameView/lifecycle
// (sequential stage renders and the final settle-render) to run.
const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('createGameView animation lifecycle', () => {
  test('refresh/refreshBoard are guarded while in-flight, unguarded again once settled', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();

    const done = gameView.showMoveMade(moveDisplay('A'), settledViewState('A'));
    assert.equal(boardRenders.length, 1, 'lift board render happens synchronously');
    assert.deepEqual(
      boardRenders[0].pieces.map((p) => p.position),
      [{ r: 0, c: 0 }],
      'lift board shows the origin piece',
    );
    assert.equal(gameView.isAnimating(), true);

    gameView.refresh({ board: { label: 'ignored' }, status: {}, controlPanel: { collapsed: true } });
    gameView.refreshBoard({ label: 'ignored-too' });
    assert.equal(boardRenders.length, 1, 'guarded renders are skipped while in-flight');

    animationView.resolve('showMoveRipple');
    await flush();
    assert.equal(boardRenders.length, 2, 'slide board renders after ripple');
    assert.equal(boardRenders[1].pieces.length, 0, 'slide board has no pieces (origin removed)');

    animationView.resolve('showPieceMoving');
    await flush();
    assert.equal(boardRenders.length, 3, 'land board renders after slide');
    assert.deepEqual(
      boardRenders[2].pieces.map((p) => p.position),
      [{ r: 1, c: 1 }],
      'land board shows the destination piece',
    );

    animationView.resolve('showPieceLanding');
    await done;
    await flush();

    assert.equal(gameView.isAnimating(), false);
    assert.equal(boardRenders.length, 4, 'settled board render applied after landing');
    assert.equal(boardRenders.at(-1).label, 'A', "animation's own settle render applied");

    gameView.refreshBoard({ label: 'now-applied' });
    assert.equal(boardRenders.at(-1).label, 'now-applied', 'unguarded again once settled');
  });

  test('landing must resolve before showMoveMade() settles', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();

    const done = gameView.showMoveMade(moveDisplay('A'), settledViewState('A', { moveablePositions: [{ r: 2, c: 2 }] }));
    assert.equal(gameView.isAnimating(), true);

    animationView.resolve('showMoveRipple');
    await flush();
    animationView.resolve('showPieceMoving');
    await flush();

    let settled = false;
    done.then(() => {
      settled = true;
    });
    await flush();
    assert.equal(settled, false, 'showMoveMade is still pending while landing is unresolved');
    assert.equal(gameView.isAnimating(), true);
    assert.equal(boardRenders.at(-1).moveablePositions.length, 0, 'next-turn hints have not rendered');

    animationView.resolve('showPieceLanding');
    await done;
    await flush();

    assert.equal(gameView.isAnimating(), false);
    assert.equal(boardRenders.at(-1).moveablePositions.length, 1, 'settled hints render only after landing');
  });

  test('isAnimating/waitForAnimation go true then false around a full showMoveMade() call', async () => {
    const { gameView, animationView } = createFakeGameView();

    assert.equal(gameView.isAnimating(), false);
    const done = gameView.showMoveMade(moveDisplay('A'), settledViewState('A'));
    assert.equal(gameView.isAnimating(), true);

    animationView.resolve('showMoveRipple');
    await flush();
    animationView.resolve('showPieceMoving');
    await flush();
    animationView.resolve('showPieceLanding');
    await done;
    await gameView.waitForAnimation();
    assert.equal(gameView.isAnimating(), false);
  });

  test('stopAnimation clears isAnimating synchronously and clears the motion layer', () => {
    const { gameView, animationView } = createFakeGameView();

    gameView.showMoveMade(moveDisplay('A'), settledViewState('A'));
    assert.equal(gameView.isAnimating(), true);

    gameView.stopAnimation();
    assert.equal(gameView.isAnimating(), false);
    assert.ok(animationView.calls.some((c) => c.name === 'clearAnimationLayer'));
  });

  test('back-to-back moves: a stale animation resolving late does not clobber the newer one', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();

    gameView.showMoveMade(moveDisplay('A'), settledViewState('A'));
    assert.equal(boardRenders.at(-1).label, 'A');

    // GameViewBinder always calls stopAnimation() before the next
    // showMoveMade() -- this aborts A's in-flight effects.
    gameView.stopAnimation();
    const doneB = gameView.showMoveMade(moveDisplay('B'), settledViewState('B'));
    assert.equal(boardRenders.at(-1).label, 'B');
    assert.equal(gameView.isAnimating(), true, 'reflects B, not A');

    animationView.resolve('showMoveRipple');
    await flush();
    animationView.resolve('showPieceMoving');
    await flush();
    animationView.resolve('showPieceLanding');
    await doneB;
    await flush();

    assert.equal(gameView.isAnimating(), false);
    assert.equal(boardRenders.at(-1).label, 'B', "B's settle render wins, unaffected by A");
  });

  test('rejecting each active effect restores the settled board and remains observable', async () => {
    const effects = ['showMoveRipple', 'showPieceMoving', 'showPieceLanding'];
    for (const failingEffect of effects) {
      const { gameView, animationView, boardRenders } = createFakeGameView();
      const done = gameView.showMoveMade(moveDisplay(failingEffect), settledViewState(failingEffect, { targetSquares: [{ r: 2, c: 2 }] }));

      // Resolve the effects that come before the failing one in the normal flow.
      if (failingEffect !== 'showMoveRipple') {
        animationView.resolve('showMoveRipple');
        await flush();
      }
      if (failingEffect !== 'showPieceMoving') {
        animationView.resolve('showPieceMoving');
        await flush();
      }

      animationView.reject(failingEffect, new Error('boom'));

      await assert.rejects(done, /boom/);
      await flush();

      assert.ok(
        animationView.calls.some((c) => c.name === 'clearAnimationLayer'),
        `${failingEffect}: layer is cleared on rejection`,
      );
      assert.equal(boardRenders.at(-1).label, failingEffect, `${failingEffect}: settled board is restored`);
      assert.equal(gameView.isAnimating(), false);
    }
  });

  test('abort while landing is pending performs no late settled render', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();

    const done = gameView.showMoveMade(moveDisplay('A'), settledViewState('A'));
    animationView.resolve('showMoveRipple');
    await flush();
    animationView.resolve('showPieceMoving');
    await flush();

    const boardCountBeforeAbort = boardRenders.length;
    gameView.stopAnimation();
    await done;
    await flush();

    assert.equal(boardRenders.length, boardCountBeforeAbort, 'aborted run did not add more board renders');
  });

  test('strict lift → slide → land → fade sequence for a capture', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();

    const done = gameView.showMoveMade(moveDisplay('cap', true), settledViewState('cap'));
    assert.equal(boardRenders.length, 1);
    assert.deepEqual(
      boardRenders[0].pieces.map((p) => p.position),
      [
        { r: 0, c: 0 },
        { r: 0, c: 1 },
      ],
      'lift board shows origin and victim',
    );

    animationView.resolve('showMoveRipple');
    await flush();
    assert.equal(boardRenders.length, 2, 'slide board renders after lift');
    assert.deepEqual(
      boardRenders[1].pieces.map((p) => p.position),
      [{ r: 0, c: 1 }],
      'slide board shows only the victim',
    );

    animationView.resolve('showPieceMoving');
    await flush();
    assert.equal(boardRenders.length, 3, 'land board renders after slide');
    assert.deepEqual(
      boardRenders[2].pieces.map((p) => p.position),
      [
        { r: 1, c: 1 },
        { r: 0, c: 1 },
      ],
      'land board shows destination and victim',
    );
    assert.ok(animationView.calls.some((c) => c.name === 'clearAnimationLayer'), 'layer cleared before landing');
    assert.equal(animationView.pending.has('showPieceLanding'), true, 'landing starts after slide');

    animationView.resolve('showPieceLanding');
    await flush();
    assert.equal(animationView.pending.has('showCapturedPieceFading'), true, 'fade starts after landing');
    const fadeCall = animationView.calls.find((call) => call.name === 'showCapturedPieceFading');
    assert.equal(fadeCall.args.length, 2, 'fade receives only position and signal');
    assert.deepEqual(fadeCall.args[0], { r: 0, c: 1 });
    assert.ok(fadeCall.args[1] instanceof AbortSignal);

    // Refresh guards remain active through all four stages.
    const countBeforeRefresh = boardRenders.length;
    gameView.refreshBoard({ label: 'ignored' });
    assert.equal(boardRenders.length, countBeforeRefresh, 'refresh still guarded during fade');

    animationView.resolve('showCapturedPieceFading');
    await done;
    await flush();

    assert.equal(gameView.isAnimating(), false);
    assert.equal(boardRenders.length, countBeforeRefresh + 1, 'settled board renders after fade');
    assert.equal(boardRenders.at(-1).pieces.length, 1, 'settled board has only the destination piece');
  });

  test('capture fade rejection restores the settled board and skips fade completion', async () => {
    const { gameView, animationView, boardRenders } = createFakeGameView();
    const done = gameView.showMoveMade(moveDisplay('cap-fade-reject', true), settledViewState('cap-fade-reject'));

    animationView.resolve('showMoveRipple');
    await flush();
    animationView.resolve('showPieceMoving');
    await flush();
    animationView.resolve('showPieceLanding');
    await flush();

    animationView.reject('showCapturedPieceFading', new Error('fade boom'));
    await assert.rejects(done, /fade boom/);
    await flush();

    assert.ok(animationView.calls.some((c) => c.name === 'clearAnimationLayer'));
    assert.equal(boardRenders.at(-1).label, 'cap-fade-reject', 'settled board restored after fade rejection');
    assert.equal(gameView.isAnimating(), false);
  });
});
