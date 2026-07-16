import { describe, test, afterEach } from '@jest/globals';
import assert from 'node:assert/strict';
import { createGameController } from '../../controller/gameController.mjs';
import { Position } from '../../core/Position.mjs';
import { PieceColor } from '../../core/piece.mjs';
import { positionOfModelPos } from '../../controller/gameDriverBridge.mjs';
import { WorkerGameDriver } from '../../controller/WorkerGameDriver.mjs';

const humanConfig = Object.freeze({
  whiteIsAI: false,
  blackIsAI: false,
  aiDifficulty: 'easy',
});

const blackAiConfig = Object.freeze({
  whiteIsAI: false,
  blackIsAI: true,
  aiDifficulty: 'easy',
});

const whiteAiConfig = Object.freeze({
  whiteIsAI: true,
  blackIsAI: false,
  aiDifficulty: 'easy',
});

const bothAiConfig = Object.freeze({
  whiteIsAI: true,
  blackIsAI: true,
  aiDifficulty: 'easy',
});

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

const assertControllerAndDriverEquivalent = async (controller) => {
  const driverState = await controller.driver.getState();
  const expectedTurn = driverState.player === PieceColor.WHITE ? 1 : -1;
  assert.equal(controller.state.turn, expectedTurn, 'side to move differs');

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (!Position.isValid(c, 7 - r)) continue;
      if (!driverState.board.isOccupied(positionOfModelPos({ r, c }))) {
        assert.equal(controller.state.board[r][c], 0, `expected empty at ${r},${c}`);
      } else {
        const isBlack = driverState.board.isBlackPiece(positionOfModelPos({ r, c }));
        const isDame = driverState.board.isDamePiece(positionOfModelPos({ r, c }));
        const expected = (isBlack ? -1 : 1) * (isDame ? 2 : 1);
        assert.equal(controller.state.board[r][c], expected, `piece differs at ${r},${c}`);
      }
    }
  }
};

const Barrier = () => {
  const { promise, resolve } = Promise.withResolvers();
  return { promise, resolve };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

const waitFor = async (predicate, maxWaits = 50, waitMs = 10) => {
  let waits = 0;
  while (!predicate() && waits < maxWaits) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    waits += 1;
  }
};

const makeCountingBarrier = () => {
  const firstBarrier = Barrier();
  let callCount = 0;
  const listener = () => {
    callCount += 1;
    if (callCount === 1) return firstBarrier.promise;
    return Promise.resolve();
  };
  return {
    listener,
    calls: () => callCount,
    release: () => firstBarrier.resolve(),
  };
};

afterEach(() => {
  WorkerGameDriver.terminate();
});

describe('GameController turn pacing and synchronization', () => {
  test('listener failures are logged and do not strand the operation', async () => {
    const controller = createGameController(humanConfig);
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);

    const stateChangedCalls = [];
    const moveMadeCalls = [];

    controller.on('moveMade', () => {
      throw new Error('sync boom');
    });
    controller.on('moveMade', () => Promise.reject(new Error('async boom')));
    controller.on('moveMade', (evt) => {
      moveMadeCalls.push(evt);
    });
    controller.on('stateChanged', (evt) => {
      stateChangedCalls.push(evt);
    });

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    await controller.attemptMove({ r: 5, c: 2 });

    console.error = originalError;

    assert.equal(moveMadeCalls.length, 1, 'later moveMade listener still ran');
    assert.equal(
      stateChangedCalls.filter((e) => e.type === 'moveMade').length,
      1,
      'stateChanged listener still ran for moveMade',
    );
    assert.ok(errors.length >= 2, 'both failures were logged');

    // Token must be released: next human can select.
    assert.equal(controller.state.turn, -1);
    assert.equal(controller.selectPiece({ r: 1, c: 2 }), true);
  });

  test('human -> AI: aiThinking waits for the moveMade barrier to resolve', async () => {
    const controller = createGameController(blackAiConfig);
    const { listener, release, calls } = makeCountingBarrier();
    const aiThinkingCalls = [];
    controller.on('moveMade', listener);
    controller.on('aiThinking', () => aiThinkingCalls.push(true));

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    const moveDone = controller.attemptMove({ r: 5, c: 2 });
    await tick();

    assert.equal(calls(), 1, 'moveMade fired');
    assert.equal(aiThinkingCalls.length, 0, 'aiThinking not emitted while human animation pending');

    release(0);
    await moveDone;

    assert.ok(aiThinkingCalls.length >= 1, 'aiThinking emitted after human animation resolves');
    assert.equal(controller.state.turn, 1, 'AI completed its turn and play returned to white');
  });

  test('AI waits for turn hints to render before announcing thinking or moving', async () => {
    const controller = createGameController(blackAiConfig);
    const turnReadyBarrier = Barrier();
    const events = [];

    controller.on('turnReady', (evt) => {
      events.push({ type: evt.type, turn: evt.state.turn, validMoves: evt.state.validMoves });
      return turnReadyBarrier.promise;
    });
    controller.on('aiThinking', () => events.push({ type: 'aiThinking' }));
    controller.on('aiMoved', () => events.push({ type: 'aiMoved' }));

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    const moveDone = controller.attemptMove({ r: 5, c: 2 });
    await tick();

    assert.equal(events.length, 1, 'turnReady is the first AI-turn boundary');
    assert.equal(events[0].type, 'turnReady');
    assert.equal(events[0].turn, -1, 'hints describe the incoming AI player');
    assert.ok(
      events[0].validMoves.length > 0,
      'incoming AI legal pieces are available to highlight',
    );

    turnReadyBarrier.resolve();
    await moveDone;

    assert.deepEqual(
      events.slice(0, 3).map((event) => event.type),
      ['turnReady', 'aiThinking', 'aiMoved'],
    );
  });

  test('human -> human: input is blocked while the final hop animation is pending', async () => {
    const controller = createGameController(humanConfig);
    const { listener, release, calls } = makeCountingBarrier();
    controller.on('moveMade', listener);

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    const moveDone = controller.attemptMove({ r: 5, c: 2 });
    await tick();
    assert.equal(calls(), 1);

    // Next player is black; try to preselect and deselect.
    assert.equal(
      controller.selectPiece({ r: 2, c: 2 }),
      false,
      'selectPiece blocked during animation',
    );
    assert.equal(
      await controller.attemptMove({ r: 3, c: 1 }),
      false,
      'attemptMove blocked during animation',
    );
    const selectedBefore = controller.selectedPiece;
    controller.deselect();
    assert.equal(
      controller.selectedPiece,
      selectedBefore,
      'deselect did not mutate state while blocked',
    );

    release(0);
    await moveDone;

    assert.equal(controller.state.turn, -1);
    assert.equal(controller.selectPiece({ r: 1, c: 2 }), true, 'input accepted after animation');
  });

  test('second interior human-capture click is rejected during the first hop', async () => {
    const board = emptyBoard();
    board[4][5] = 1;
    board[3][4] = -1;
    board[1][4] = -1;
    const controller = createGameController({ board, turn: 1, config: humanConfig });
    const { listener, release, calls } = makeCountingBarrier();
    controller.on('moveMade', listener);

    assert.equal(controller.selectPiece({ r: 4, c: 5 }), true);
    const hop1 = controller.attemptMove({ r: 2, c: 3 });
    await tick();
    assert.equal(calls(), 1);

    // The same piece is locked at (2,3); a premature continuation click is rejected.
    assert.equal(
      await controller.attemptMove({ r: 0, c: 5 }),
      false,
      'interior hop blocked during animation',
    );

    release(0);
    await hop1;

    assert.deepEqual(controller.state.mustMovePiece, { r: 2, c: 3 });
    assert.equal(
      await controller.attemptMove({ r: 0, c: 5 }),
      true,
      'continuation accepted after animation',
    );
    assert.equal(controller.state.turn, -1);
  });

  test('AI multi-capture paused during hop 1 still drains hop 2 and blocks input', async () => {
    const board = emptyBoard();
    board[2][1] = -1;
    board[3][2] = 1;
    board[5][2] = 1;
    const controller = createGameController({ board, turn: -1, config: blackAiConfig });

    const { listener, release, calls } = makeCountingBarrier();
    controller.on('moveMade', (evt) => {
      if (calls() === 0) {
        controller.pause();
      }
      return listener(evt);
    });

    const aiDone = controller.resume();
    await waitFor(() => calls() > 0);
    assert.equal(calls(), 1, 'AI hop 1 emitted moveMade');

    assert.equal(
      controller.selectPiece({ r: 0, c: 0 }),
      false,
      'human input blocked during AI replay',
    );

    release(0);
    await aiDone;

    assert.equal(calls(), 2, 'AI hop 2 also emitted moveMade');
    assert.equal(controller.state.turn, 1, 'black AI turn finished');
    await assertControllerAndDriverEquivalent(controller);
    assert.equal(
      (await controller.driver.history()).length,
      1,
      'exactly one atomic AI turn committed',
    );

    // Paused means no follow-up AI started automatically.
    await controller.waitForQuiescence();
    assert.equal(controller.isAIProcessing, false);
  });

  test('reset from promotion, multiCapture, moveMade, and aiMoved boundaries emits no stale events', async () => {
    const setups = [
      {
        name: 'promotion',
        board: (() => {
          const b = emptyBoard();
          b[2][1] = 1;
          b[1][2] = -1;
          return b;
        })(),
        turn: 1,
        boundary: 'promotion',
        play: (c) => c.selectPiece({ r: 2, c: 1 }) && c.attemptMove({ r: 0, c: 3 }),
        staleEvent: 'moveMade',
      },
      {
        name: 'multiCapture',
        board: (() => {
          const b = emptyBoard();
          b[4][5] = 1;
          b[3][4] = -1;
          b[1][4] = -1;
          return b;
        })(),
        turn: 1,
        boundary: 'multiCapture',
        play: (c) => c.selectPiece({ r: 4, c: 5 }) && c.attemptMove({ r: 2, c: 3 }),
        staleEvent: 'moveMade',
      },
      {
        name: 'moveMade',
        board: emptyBoard(),
        turn: 1,
        boundary: 'moveMade',
        play: (c) => {
          // Standard opening walk so reset happens on a plain moveMade.
          c.selectPiece({ r: 5, c: 1 });
          return c.attemptMove({ r: 4, c: 2 });
        },
        staleEvent: 'gameOver',
      },
      {
        name: 'aiMoved',
        board: (() => {
          const b = emptyBoard();
          b[5][2] = -1;
          return b;
        })(),
        turn: -1,
        boundary: 'aiMoved',
        play: (c) => c.resume(),
        staleEvent: 'moveMade',
      },
    ];

    for (const { name, board, turn, boundary, play, staleEvent } of setups) {
      const config = boundary === 'aiMoved' ? blackAiConfig : humanConfig;
      const controller = createGameController({ board, turn, config });
      const staleCalls = [];
      controller.on(staleEvent, (evt) => staleCalls.push(evt));

      let resetPromise = null;
      controller.on(boundary, () => {
        if (!resetPromise) resetPromise = controller.reset({ paused: true });
      });

      await play(controller);
      if (resetPromise) await resetPromise;

      assert.equal(staleCalls.length, 0, `${name}: no stale ${staleEvent} after reset`);
      assert.equal(controller.isAIProcessing, false, `${name}: operation token released`);
    }
  });

  test('old hop pending -> reset -> new hop: old finally cannot release new lock', async () => {
    const controller = createGameController(humanConfig);
    const oldBarrier = Barrier();
    controller.on('moveMade', () => oldBarrier.promise);

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    const oldMove = controller.attemptMove({ r: 5, c: 2 });
    await tick();

    const resetPromise = controller.reset({ paused: false });
    await resetPromise;

    // New move after reset.
    const newBarrier = Barrier();
    controller.on('moveMade', () => newBarrier.promise);
    assert.equal(controller.selectPiece({ r: 6, c: 3 }), true);
    const newMove = controller.attemptMove({ r: 5, c: 4 });

    // Release the stale barrier; the new operation must still own the lock.
    oldBarrier.resolve();
    await oldMove;
    assert.equal(
      controller.selectPiece({ r: 2, c: 2 }),
      false,
      'new lock still held after stale release',
    );

    newBarrier.resolve();
    await newMove;

    assert.equal(controller.state.turn, -1, 'new move completed');
    assert.equal(controller.selectPiece({ r: 1, c: 2 }), true, 'lock released after new move');
  });

  test('stale AI finally cannot abort the replacement AI started by reset', async () => {
    const board = emptyBoard();
    board[2][1] = -1;
    board[3][2] = 1;
    board[5][2] = 1;
    const controller = createGameController({ board, turn: -1, config: blackAiConfig });

    const oldBarrier = Barrier();
    let moveMadeCalls = 0;
    let aiMovedCalls = 0;
    controller.on('moveMade', () => {
      moveMadeCalls += 1;
      return moveMadeCalls === 1 ? oldBarrier.promise : Promise.resolve();
    });
    controller.on('aiMoved', () => {
      aiMovedCalls += 1;
    });

    const staleAi = controller.resume();
    await waitFor(() => aiMovedCalls > 0);
    assert.equal(aiMovedCalls, 1, 'old AI committed before its first hop animation');
    assert.equal(moveMadeCalls, 1, 'old AI is waiting at its first hop animation');

    // Reset invalidates the old operation and installs a fresh AI delay/token.
    const replacementAi = controller.reset({ paused: false });
    await tick();

    // The stale operation now unwinds. Its finally must not abort the fresh AI.
    oldBarrier.resolve();
    await Promise.all([staleAi, replacementAi]);

    assert.equal(aiMovedCalls, 2, 'replacement AI committed its own turn');
    assert.equal(moveMadeCalls, 3, 'replacement AI replayed both capture hops');
    assert.equal(
      (await controller.driver.history()).length,
      1,
      'fresh driver advanced exactly once',
    );
    assert.equal(controller.state.turn, 1, 'replacement AI completed and passed turn to white');
    assert.equal(controller.isAIProcessing, false);
    await assertControllerAndDriverEquivalent(controller);
  });

  test('reset waits for stateChanged listeners before starting the opening AI', async () => {
    const controller = createGameController(whiteAiConfig);
    const stateChangedBarrier = Barrier();
    const aiThinkingCalls = [];

    controller.on('stateChanged', (evt) => {
      if (evt.type === 'stateChanged' && evt.data?.action === 'reset') {
        return stateChangedBarrier.promise;
      }
      return undefined;
    });
    controller.on('aiThinking', () => aiThinkingCalls.push(true));

    const resetDone = controller.reset({ paused: false });
    await tick();
    assert.equal(aiThinkingCalls.length, 0, 'AI did not start before stateChanged settled');

    stateChangedBarrier.resolve();
    await resetDone;
    assert.equal(aiThinkingCalls.length, 1, 'AI started after stateChanged settled');
  });

  test('consecutive AI players run iteratively through one owned AI sequence', async () => {
    const board = emptyBoard();
    board[2][3] = 1;
    board[0][3] = -1;
    const controller = createGameController({ board, turn: 1, config: bothAiConfig });
    const aiMovedCalls = [];
    controller.on('aiMoved', (evt) => aiMovedCalls.push(evt));

    await controller.reset({ paused: false });

    assert.equal(aiMovedCalls.length, 2, 'white AI and black AI each committed one turn');
    assert.equal((await controller.driver.history()).length, 2);
    assert.equal(controller.state.status, 'BLACK_WINS');
    assert.equal(controller.isAIProcessing, false);
    await assertControllerAndDriverEquivalent(controller);
  });

  test('pause during a completed human animation defers AI until resume', async () => {
    const controller = createGameController(blackAiConfig);
    const barrier = Barrier();
    controller.on('moveMade', () => {
      controller.pause();
      return barrier.promise;
    });

    assert.equal(controller.selectPiece({ r: 6, c: 1 }), true);
    const humanMove = controller.attemptMove({ r: 5, c: 2 });
    await tick();

    barrier.resolve();
    await humanMove;

    assert.equal(
      (await controller.driver.history()).length,
      1,
      'human turn synchronized to driver',
    );
    assert.equal(controller.state.turn, -1, 'turn passed to black');
    assert.equal(controller.isAIProcessing, false, 'AI did not start while paused');

    await controller.resume();

    assert.equal(controller.state.turn, 1, 'AI played after resume');
    assert.equal((await controller.driver.history()).length, 2, 'AI turn committed to driver');
  });

  test('Restart with White AI starts no hidden move; Start clears pause and starts it once', async () => {
    const controller = createGameController(whiteAiConfig);
    const aiThinkingCalls = [];
    const aiMovedCalls = [];
    controller.on('aiThinking', () => aiThinkingCalls.push(true));
    controller.on('aiMoved', () => aiMovedCalls.push(true));

    // Restart (setup-screen Restart intent) keeps the game paused.
    await controller.reset({ paused: true });
    assert.equal(aiThinkingCalls.length, 0, 'Restart did not start AI search');
    assert.equal(aiMovedCalls.length, 0, 'Restart did not play an AI move');

    // Start (setup-screen Start intent) clears pause and starts White AI.
    await controller.reset({ paused: false });
    assert.equal(aiThinkingCalls.length, 1, 'Start triggered exactly one AI turn');
    assert.equal(aiMovedCalls.length, 1, 'AI move committed exactly once');
    assert.equal((await controller.driver.history()).length, 1, 'driver advanced once');
  });
});
