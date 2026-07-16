import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createGameController } from '../../controller/gameController.mjs';
import { createGameState } from '../../model/gameState.mjs';
import { MoveEngine } from '../../model/moveEngine.mjs';
import { DEFAULT_CONFIG } from '../../model/types.mjs';
import { createGameViewBinder } from '../../view/gameViewBinder.mjs';
import { createHtmlGameView } from '../../view/html/htmlGameViewFactory.mjs';
import {
  createFromController,
  createBoardState,
  createStatusState,
  createControlPanelState,
  createMoveDisplay,
} from '../../view/gameViewStateFactory.mjs';

const fullHumanConfig = Object.freeze({
  whiteIsAI: false,
  blackIsAI: false,
  aiDifficulty: DEFAULT_CONFIG.aiDifficulty,
});

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

const fakeController = (state, selectedPiece = null) => ({
  state,
  selectedPiece,
});

const samePos = (a, b) => a && b && a.r === b.r && a.c === b.c;

const includesPos = (positions, pos) => positions.some((p) => samePos(p, pos));

const createGameFlowSmokeSteps = () => {
  return [
    {
      label: 'index.html points at existing runtime assets',
      run: async () => {
        const indexHtml = await readFile('index.html', 'utf8');
        const assetPaths = [
          ...[...indexHtml.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
          ...[...indexHtml.matchAll(/src="([^"]+)"/g)].map((match) => match[1]),
        ]
          .filter((assetPath) => assetPath.startsWith('./'))
          .map((assetPath) => assetPath.slice(2));

        assert.ok(assetPaths.includes('view/css/tailwind.css'));
        assert.ok(assetPaths.includes('view/css/game.css'));
        assert.ok(assetPaths.includes('main.mjs'));
        assert.equal(typeof createHtmlGameView, 'function');

        for (const assetPath of assetPaths) {
          await access(path.join(process.cwd(), assetPath));
        }
      },
    },
    {
      label: 'setup display state starts expanded',
      run: () => {
        const controller = createGameController(fullHumanConfig);
        const viewState = createFromController(controller, {
          gameStarted: false,
          isAIThinking: false,
        });

        assert.equal('screen' in viewState, false);
        assert.equal(viewState.controlPanel.collapsed, false);
        assert.equal(viewState.status.status, 'PLAYING');
        assert.equal(viewState.status.turn, 'white');
        assert.equal(viewState.status.pieceCounts.white, 8);
        assert.equal(viewState.status.isRestartVisible, false);
      },
    },
    {
      label: 'all game modes map into display config',
      run: () => {
        const controller = createGameController(fullHumanConfig);
        const modes = [
          { whiteIsAI: false, blackIsAI: false },
          { whiteIsAI: false, blackIsAI: true },
          { whiteIsAI: true, blackIsAI: false },
          { whiteIsAI: true, blackIsAI: true },
        ];

        for (const mode of modes) {
          controller.updateConfig(mode);
          const controlPanel = createControlPanelState(controller, {
            gameStarted: false,
          });
          assert.equal(controlPanel.gameConfig.whiteIsAI, mode.whiteIsAI);
          assert.equal(controlPanel.gameConfig.blackIsAI, mode.blackIsAI);
        }
      },
    },
    {
      label: 'normal human move updates turn and board display state',
      run: async () => {
        const controller = createGameController(fullHumanConfig);
        const move = controller.state.validMoves.find((m) => !m.isCapture);
        assert.ok(move, 'expected an opening walk move');

        assert.equal(controller.selectPiece({ r: move.fromR, c: move.fromC }), true);

        const selectedBoard = createBoardState(controller);
        assert.ok(includesPos(selectedBoard.targetSquares, { r: move.toR, c: move.toC }));

        await controller.attemptMove({ r: move.toR, c: move.toC });

        assert.equal(controller.state.turn, -1);
        assert.equal(controller.selectedPiece, null);
        assert.equal(controller.state.board[move.fromR][move.fromC], 0);
        assert.equal(Math.sign(controller.state.board[move.toR][move.toC]), 1);
      },
    },
    {
      label: 'wrong-turn piece cannot be selected',
      run: () => {
        const controller = createGameController(fullHumanConfig);
        const blackPos = controller.state.board
          .flatMap((row, r) => row.map((piece, c) => ({ r, c, piece })))
          .find(({ piece }) => piece < 0);

        assert.equal(controller.selectPiece({ r: blackPos.r, c: blackPos.c }), false);
        assert.equal(controller.selectedPiece, null);
      },
    },
    {
      label: 'forced capture exposes capture target display state',
      run: () => {
        const board = emptyBoard();
        board[5][0] = 1;
        board[4][1] = -1;
        board[7][6] = -1;
        const state = createGameState({ board, turn: 1, config: fullHumanConfig });
        const controller = fakeController(state, { r: 5, c: 0 });
        const boardState = createBoardState(controller);

        assert.equal(state.validMoves.length, 1);
        assert.equal(state.validMoves[0].isCapture, true);
        assert.deepEqual(boardState.targetSquares, []);
        assert.ok(includesPos(boardState.captureTargets, { r: 3, c: 2 }));
      },
    },
    {
      label: 'multi-capture keeps the same piece locked and shows notice state',
      run: () => {
        const board = emptyBoard();
        board[5][0] = 1;
        board[4][1] = -1;
        board[2][3] = -1;
        board[7][6] = -1;
        const state = createGameState({ board, turn: 1, config: fullHumanConfig });
        const next = state.applyMove(state.validMoves[0]);
        const controller = fakeController(next, next.mustMovePiece);

        assert.deepEqual(next.mustMovePiece, { r: 3, c: 2 });
        assert.equal(next.turn, 1);

        const statusState = createStatusState(controller, {
          isAIThinking: false,
        });
        const boardState = createBoardState(controller);

        assert.deepEqual(statusState.mustMovePiece, { r: 3, c: 2 });
        assert.ok(includesPos(boardState.captureTargets, { r: 1, c: 4 }));
      },
    },
    {
      label: 'promotion is reflected as a king in display state',
      run: () => {
        const board = emptyBoard();
        board[1][0] = 1;
        board[7][6] = -1;
        const state = createGameState({ board, turn: 1, config: fullHumanConfig });
        const promotionMove = state.validMoves.find((m) => m.toR === 0);
        const next = state.applyMove(promotionMove);
        const controller = fakeController(next);
        const boardState = createBoardState(controller);
        const promoted = boardState.pieces.find((piece) =>
          samePos(piece.position, { r: promotionMove.toR, c: promotionMove.toC }),
        );

        assert.equal(next.board[promotionMove.toR][promotionMove.toC], 2);
        assert.equal(promoted.rank, 'king');
      },
    },
    {
      label: 'game-over state reports the winner',
      run: () => {
        const board = emptyBoard();
        board[2][1] = 1;
        board[1][2] = -1;
        const state = createGameState({ board, turn: 1, config: fullHumanConfig });
        const capture = state.validMoves.find((m) => m.isCapture);
        const next = state.applyMove(capture);
        const statusState = createStatusState(fakeController(next), {
          isAIThinking: false,
        });

        assert.equal(next.status, 'WHITE_WINS');
        assert.equal(statusState.status, 'WHITE_WINS');
        assert.equal(statusState.pieceCounts.black, 0);
        assert.equal(statusState.isRestartVisible, true);
      },
    },
    {
      label: 'ai-thinking and game-started flags map to view state',
      run: () => {
        const controller = createGameController({ ...fullHumanConfig, blackIsAI: true });
        const aiThinking = createFromController(controller, {
          gameStarted: true,
          isAIThinking: true,
        });

        assert.equal(aiThinking.status.isAIThinking, true);
        assert.equal(aiThinking.controlPanel.collapsed, true);
      },
    },
    {
      label: 'move display includes captured-piece and landing positions for animation',
      run: () => {
        const board = emptyBoard();
        board[5][0] = 1;
        board[4][1] = -1;
        board[7][6] = -1;
        const state = createGameState({ board, turn: 1, config: fullHumanConfig });
        const move = state.validMoves[0];
        const next = state.applyMove(move);
        const display = createMoveDisplay(fakeController(next), move);

        assert.deepEqual(display.from, { r: 5, c: 0 });
        assert.deepEqual(display.to, { r: 3, c: 2 });
        assert.deepEqual(display.victimPosition, { r: 4, c: 1 });
        assert.equal(display.piece.color, 'white');
        assert.equal(display.victimDisplay.color, 'black');
      },
    },
    {
      label: 'MoveEngine keeps board and model invariants sane after smoke moves',
      run: () => {
        const controller = createGameController(fullHumanConfig);
        assert.equal(MoveEngine.countPieces(controller.state.board, 1).total, 8);
        assert.equal(MoveEngine.countPieces(controller.state.board, -1).total, 8);
        assert.equal(
          controller.state.validMoves.every((move) => !move.isCapture),
          true,
        );
      },
    },
    {
      label: 'setup panel isCancelable flag and config restore on cancel',
      run: async () => {
        const controller = createGameController(fullHumanConfig);
        const initialControlState = createControlPanelState(controller, {
          gameStarted: false,
          isCancelable: false,
        });
        assert.equal(initialControlState.isCancelable, false);

        const editingControlState = createControlPanelState(controller, {
          gameStarted: false,
          isCancelable: true,
        });
        assert.equal(editingControlState.isCancelable, true);

        let pauseCalled = 0;
        let resumeCalled = 0;
        const originalPause = controller.pause;
        const originalResume = controller.resume;
        controller.pause = () => {
          pauseCalled++;
          originalPause();
        };
        controller.resume = () => {
          resumeCalled++;
          originalResume();
        };

        const calls = [];
        const mockGameView = {
          refresh: (s) => calls.push({ type: 'refresh', state: s }),
          refreshBoard: () => {},
          refreshStatus: () => {},
          stopAnimation: () => {},
          isAnimating: () => false,
          waitForAnimation: () => Promise.resolve(),
          waitForPaint: () => Promise.resolve(),
        };

        const binder = createGameViewBinder(
          controller,
          {
            createFromController: (c, f) => ({
              controlPanel: createControlPanelState(c, f),
            }),
          },
          mockGameView,
        );

        binder.markGameStarted();
        assert.equal(binder.isGameStarted(), true);

        await binder.markSetupExpanded();
        assert.equal(binder.isGameStarted(), false);
        assert.equal(pauseCalled, 1);
        const lastCall = calls[calls.length - 1];
        assert.equal(lastCall.type, 'refresh');
        assert.equal(lastCall.state.controlPanel.isCancelable, true);

        controller.updateConfig({ whiteIsAI: false, blackIsAI: true });
        assert.equal(controller.state.config.blackIsAI, true);

        binder.markSetupCollapsed();
        assert.equal(binder.isGameStarted(), true);
        assert.equal(resumeCalled, 1);
        assert.equal(controller.state.config.blackIsAI, false);
      },
    },

    {
      label: 'demo initialization loads board layout and preserves it on reset',
      run: async () => {
        const demo1 = JSON.parse(
          await readFile(path.join(process.cwd(), 'examples/demos/demo1.json'), 'utf8'),
        );
        const board = Array.from({ length: 8 }, () => Array(8).fill(0));
        const COLOR_MAP = { WHITE: 1, BLACK: -1 };
        const TYPE_MAP = { PION: 1, DAME: 2 };

        for (const [square, info] of demo1.pieces) {
          const col = square.toUpperCase().charCodeAt(0) - 65;
          const row = 8 - parseInt(square.substring(1), 10);
          const colorSign = COLOR_MAP[info.color.toUpperCase()];
          const pieceType = TYPE_MAP[info.type.toUpperCase()];
          board[row][col] = colorSign * pieceType;
        }
        const turn = demo1.sideToMove === 'BLACK' ? -1 : 1;

        const controller = createGameController({
          board,
          turn,
          config: fullHumanConfig,
        });

        const viewState = createFromController(controller, {
          gameStarted: true,
          isAIThinking: false,
        });
        assert.equal(viewState.controlPanel.collapsed, true);

        const boardState = createBoardState(controller);

        const whitePiece = boardState.pieces.find((p) => samePos(p.position, { r: 4, c: 5 }));
        assert.ok(whitePiece);
        assert.equal(whitePiece.color, 'white');
        assert.equal(whitePiece.rank, 'man');

        const blackPiece = boardState.pieces.find((p) => samePos(p.position, { r: 3, c: 4 }));
        assert.ok(blackPiece);
        assert.equal(blackPiece.color, 'black');

        controller.selectPiece({ r: 4, c: 5 });
        await controller.attemptMove({ r: 2, c: 3 });

        await controller.reset();

        const resetBoardState = createBoardState(controller);
        const whitePieceAfterReset = resetBoardState.pieces.find((p) =>
          samePos(p.position, { r: 4, c: 5 }),
        );
        assert.ok(whitePieceAfterReset);
        assert.equal(whitePieceAfterReset.color, 'white');
      },
    },
  ];
};

describe('game-flow smoke', () => {
  for (const { label, run } of createGameFlowSmokeSteps()) {
    test(label, async () => {
      await run();
    });
  }
});
