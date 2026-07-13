import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createGameViewBinder } from '../../view/gameViewBinder.mjs';

const createFakeController = (state) => {
  const listeners = new Map();
  const controller = {
    state,
    selectedPiece: null,
    listeners,
    on: (event, listener) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(listener);
      return () => {
        const list = listeners.get(event);
        const idx = list.indexOf(listener);
        if (idx !== -1) list.splice(idx, 1);
      };
    },
    emit: (type, data) => {
      const event = { type, state: controller.state, data };
      const run = (listener) => {
        try {
          return Promise.resolve(listener(event));
        } catch (error) {
          return Promise.reject(error);
        }
      };
      (listeners.get(type) ?? []).forEach((l) => run(l).catch(() => {}));
      if (type !== 'stateChanged') {
        (listeners.get('stateChanged') ?? []).forEach((l) => run(l).catch(() => {}));
      }
    },
    pause: () => {},
    resume: () => {},
    updateConfig: () => {},
    waitForQuiescence: () => Promise.resolve(),
  };
  return controller;
};

const createFakeStateFactory = () => ({
  createMoveDisplay: (_controller, move) => move,
  createFromController: (controller, flags) => ({
    board: controller.state.board,
    status: controller.state.status,
    controlPanel: { collapsed: flags.gameStarted },
  }),
  createBoardState: (controller) => controller.state.board,
  createStatusState: (controller, flags) => ({
    ...controller.state.status,
    flags,
  }),
});

const createFakeGameView = () => {
  const calls = [];
  let animating = false;
  let pendingResolve = null;
  let pendingReject = null;

  return {
    calls,
    isAnimating: () => animating,
    stopAnimation: () => {
      animating = false;
      calls.push({ name: 'stopAnimation' });
      // Mimic the real lifecycle: abort resolves the in-flight animation
      // promise on the next microtask, after the next move has already
      // incremented the binder's render generation.
      const resolve = pendingResolve;
      pendingResolve = null;
      if (resolve) Promise.resolve().then(resolve);
    },
    showMoveMade: (moveDisplay, settledViewState) => {
      animating = true;
      calls.push({ name: 'showMoveMade', moveDisplay, settledViewState });
      const { promise, resolve, reject } = Promise.withResolvers();
      pendingResolve = () => {
        animating = false;
        resolve();
      };
      pendingReject = (e) => {
        animating = false;
        reject(e);
      };
      return promise;
    },
    refresh: (state) => calls.push({ name: 'refresh', state }),
    refreshStatus: (status) => calls.push({ name: 'refreshStatus', status }),
    refreshBoard: (board) => calls.push({ name: 'refreshBoard', board }),
    waitForAnimation: () => Promise.resolve(),
    waitForPaint: () => {
      calls.push({ name: 'waitForPaint' });
      return Promise.resolve();
    },
    resolveMove: () => {
      if (pendingResolve) pendingResolve();
    },
    rejectMove: (e) => {
      if (pendingReject) pendingReject(e);
    },
  };
};

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('GameViewBinder move rendering', () => {
  test('turnReady renders legal-piece hints before waiting for a board paint', async () => {
    const controller = createFakeController({
      board: { label: 'ai-turn', moveablePositions: [{ r: 2, c: 1 }] },
      status: { turn: 'black' },
    });
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    const listener = controller.listeners.get('turnReady')?.[0];
    assert.ok(listener, 'turnReady listener registered');
    await listener({ type: 'turnReady', state: controller.state, data: { player: -1 } });

    assert.deepEqual(
      gameView.calls.slice(-2).map((call) => call.name),
      ['refreshBoard', 'waitForPaint'],
      'the highlighted board is rendered before the paint boundary',
    );
    assert.deepEqual(gameView.calls.at(-2).board.moveablePositions, [{ r: 2, c: 1 }]);
  });

  test('aiThinking renders its message before waiting for a paint', async () => {
    const controller = createFakeController({
      board: { label: 'ai-turn' },
      status: { turn: 'black' },
    });
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    const listener = controller.listeners.get('aiThinking')?.[0];
    assert.ok(listener, 'aiThinking listener registered');
    await listener({ type: 'aiThinking', state: controller.state, data: { player: -1 } });

    assert.deepEqual(
      gameView.calls.slice(-2).map((call) => call.name),
      ['refreshStatus', 'waitForPaint'],
      'thinking status is rendered before the paint boundary',
    );
    assert.equal(gameView.calls.at(-2).status.flags.isAIThinking, true);
    assert.equal('isAnimating' in gameView.calls.at(-2).status.flags, false);
  });

  test('post-move status is deferred until showMoveMade() resolves', async () => {
    const controller = createFakeController({
      board: { label: 'start' },
      status: { turn: 'white' },
    });
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    controller.emit('moveMade', { move: { label: 'm1' } });

    assert.equal(gameView.calls.filter((c) => c.name === 'showMoveMade').length, 1);
    assert.equal(
      gameView.calls.some((c) => c.name === 'refreshStatus'),
      false,
      'status not refreshed immediately',
    );
    assert.equal(
      gameView.calls.some((c) => c.name === 'refresh'),
      false,
      'full refresh not run yet',
    );

    gameView.resolveMove();
    await flush();

    assert.equal(
      gameView.calls.at(-1).name,
      'refresh',
      'final refresh runs after animation resolves',
    );
  });

  test('final refresh still runs when the view promise rejects', async () => {
    const controller = createFakeController({
      board: { label: 'start' },
      status: { turn: 'white' },
    });
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    controller.emit('moveMade', { move: { label: 'm1' } });
    gameView.rejectMove(new Error('animation failed'));

    await flush();

    assert.equal(
      gameView.calls.at(-1).name,
      'refresh',
      'refresh still runs after a rejected animation',
    );
  });

  test('stale moveMade event after synchronous reset is ignored', async () => {
    const originalState = { board: { label: 'original' }, status: { turn: 'white' } };
    const controller = createFakeController(originalState);
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    // Capture the listener so we can hand it a stale event after the
    // controller state has been replaced.
    const moveListener = controller.listeners.get('moveMade')?.[0];
    assert.ok(moveListener);

    controller.state = { board: { label: 'reset' }, status: { turn: 'black' } };
    moveListener({ type: 'moveMade', state: originalState, data: { move: { label: 'stale' } } });

    await flush();

    assert.equal(
      gameView.calls.some((c) => c.name === 'showMoveMade'),
      false,
      'stale event did not start an animation',
    );
  });

  test("cancel-A/start-B/late-A completion does not let A render B's status", async () => {
    const controller = createFakeController({
      board: { label: 'start' },
      status: { turn: 'white' },
    });
    const gameView = createFakeGameView();
    createGameViewBinder(controller, createFakeStateFactory(), gameView);

    controller.emit('moveMade', { move: { label: 'A' } });

    // Before A resolves, move B starts. The binder increments its generation,
    // stops A's animation, and begins B.
    controller.state = { board: { label: 'after-A' }, status: { turn: 'black' } };
    controller.emit('moveMade', { move: { label: 'B' } });

    const refreshesBeforeBResolves = gameView.calls.filter((c) => c.name === 'refresh').length;

    // Now let A's late finally run (it was queued by stopAnimation).
    await flush();
    // B is still pending; A's finally should have been a no-op.
    assert.equal(
      gameView.calls.filter((c) => c.name === 'refresh').length,
      refreshesBeforeBResolves,
      "A's late completion did not refresh",
    );

    gameView.resolveMove();
    await flush();

    const finalRefresh = gameView.calls.at(-1);
    assert.equal(finalRefresh.name, 'refresh');
    assert.equal(finalRefresh.state.status.turn, 'black', "only B's post-move status is rendered");
  });

  test('setup expansion pending -> reset: stale expansion cannot repaint the replacement setup', async () => {
    const controller = createFakeController({
      board: { label: 'start' },
      status: { turn: 'white' },
      config: { whiteIsAI: false, blackIsAI: false },
    });

    let animationResolve = null;
    const animationPromise = new Promise((resolve) => {
      animationResolve = resolve;
    });
    const gameView = {
      ...createFakeGameView(),
      isAnimating: () => true,
      waitForAnimation: () => animationPromise,
    };

    const binder = createGameViewBinder(controller, createFakeStateFactory(), gameView);
    binder.markGameStarted();

    const expansion = binder.markSetupExpanded();
    // A replacement reset/new-game happens while the expansion is still
    // waiting for the animation/quiescence boundary.
    controller.state = { board: { label: 'reset' }, status: { turn: 'black' } };
    controller.emit('stateChanged', { action: 'newGame' });
    const refreshCountBeforeCompletion = gameView.calls.filter((c) => c.name === 'refresh').length;

    animationResolve();
    await expansion;

    assert.equal(
      gameView.calls.filter((c) => c.name === 'refresh').length,
      refreshCountBeforeCompletion,
      'stale expansion did not repaint setup',
    );
    assert.equal(binder.isGameStarted(), true, 'stale expansion did not flip gameStarted');
  });
});
