import { describe, test, afterEach } from '@jest/globals';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { Position } from '../../core/Position.mjs';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { createGameController } from '../../controller/gameController.mjs';
import { positionOfModelPos } from '../../controller/gameDriverBridge.mjs';
import { WorkerGameDriver } from '../../controller/WorkerGameDriver.mjs';

const humanConfig = Object.freeze({
  whiteIsAI: false,
  blackIsAI: false,
  aiDifficulty: 'easy',
});

const modelBoardFromDemo = (demo) => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (const [square, { color, type }] of demo.pieces) {
    const position = Position.fromString(square);
    const r = 7 - position.y;
    const c = position.x;
    const sign = color === 'WHITE' ? 1 : -1;
    board[r][c] = sign * (type === 'DAME' ? 2 : 1);
  }
  return board;
};

const demo1Setup = async (config = humanConfig) => {
  const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
  return {
    board: modelBoardFromDemo(demo),
    turn: demo.sideToMove === 'BLACK' ? -1 : 1,
    config,
  };
};

const playDemo1LeftRoute = async (controller) => {
  assert.equal(controller.selectPiece({ r: 4, c: 4 }), true);
  assert.equal(await controller.attemptMove({ r: 2, c: 2 }), true);
  assert.equal(await controller.attemptMove({ r: 0, c: 4 }), true);
};

const assertControllerAndDriverEquivalent = async (controller) => {
  const driverState = await controller.driver.getState();
  const expectedTurn = driverState.player === PieceColor.WHITE ? 1 : -1;
  assert.equal(controller.state.turn, expectedTurn, 'side to move differs');

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      if (!Position.isValid(c, 7 - r)) {
        assert.equal(controller.state.board[r][c], 0);
        continue;
      }

      const position = positionOfModelPos({ r, c });
      const corePiece = driverState.board.isOccupied(position)
        ? {
            color: driverState.board.isBlackPiece(position) ? PieceColor.BLACK : PieceColor.WHITE,
            type: driverState.board.isDamePiece(position) ? PieceType.DAME : PieceType.PION,
          }
        : null;
      const modelValue = controller.state.board[r][c];
      const modelPiece =
        modelValue === 0
          ? null
          : {
              color: modelValue > 0 ? PieceColor.WHITE : PieceColor.BLACK,
              type: Math.abs(modelValue) === 2 ? PieceType.DAME : PieceType.PION,
            };
      assert.deepEqual(corePiece, modelPiece, `piece differs at ${position.toString()}`);
    }
  }
};

afterEach(() => {
  WorkerGameDriver.terminate();
});

describe('GameController and GameDriver synchronization', () => {
  test('completed ambiguous human route is replayed exactly once on the driver', async () => {
    const controller = createGameController(await demo1Setup());
    await playDemo1LeftRoute(controller);

    const history = await controller.driver.history();
    assert.equal(history.length, 1);
    assert.deepEqual(
      history[0].path.map((position) => position.toString()),
      ['E4', 'C6', 'E8'],
    );
    assert.deepEqual(
      history[0].captured.map((position) => position.toString()),
      ['D5', 'D7'],
    );
    await assertControllerAndDriverEquivalent(controller);
  });

  test('black AI automatically replies and leaves both engines synchronized', async () => {
    const controller = createGameController(
      await demo1Setup({
        ...humanConfig,
        blackIsAI: true,
      }),
    );
    await playDemo1LeftRoute(controller);

    assert.equal(controller.state.turn, 1);
    assert.equal(controller.state.currentPlayerIsAI, false);
    assert.equal(controller.isAIProcessing, false);
    assert.equal((await controller.driver.history()).length, 2);
    await assertControllerAndDriverEquivalent(controller);
  });

  test('a game-ending human capture still synchronizes the driver', async () => {
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    board[2][2] = 1;
    board[1][3] = -1;
    const controller = createGameController({ board, turn: 1, config: humanConfig });

    assert.equal(controller.selectPiece({ r: 2, c: 2 }), true);
    assert.equal(await controller.attemptMove({ r: 0, c: 4 }), true);

    assert.equal(controller.state.status, 'WHITE_WINS');
    assert.equal((await controller.driver.history()).length, 1);
    await assertControllerAndDriverEquivalent(controller);
  });

  test('legacy ai directory and controller imports stay removed', async () => {
    await assert.rejects(access('ai', constants.F_OK), (error) => error.code === 'ENOENT');
    const source = await readFile('controller/gameController.mjs', 'utf8');
    assert.doesNotMatch(source, /from ['"]\.\.\/ai\//);
  });
});
