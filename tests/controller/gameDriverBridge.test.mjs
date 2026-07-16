import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameDriver } from '../../cli/GameDriver.mjs';
import { Position } from '../../core/Position.mjs';
import { PieceColor } from '../../core/piece.mjs';
import {
  createDriverForModelBoard,
  demoJsonFromModelBoard,
  expandDriverMoveToModelHops,
  modelPosOfPosition,
  modelPosOfSquare,
  pieceColorOfTurn,
  playHumanTurnOnDriver,
  positionOfModelPos,
  squareOfModelPos,
  turnOfPieceColor,
} from '../../controller/gameDriverBridge.mjs';

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

describe('GameDriverBridge', () => {
  test('coordinate mappings round-trip known squares', () => {
    const cases = [
      [{ r: 4, c: 5 }, 'F4'],
      [{ r: 0, c: 1 }, 'B8'],
      [{ r: 7, c: 6 }, 'G1'],
    ];

    for (const [modelPosition, square] of cases) {
      assert.equal(squareOfModelPos(modelPosition), square);
      assert.deepEqual(modelPosOfSquare(square), modelPosition);
      const corePosition = positionOfModelPos(modelPosition);
      assert.deepEqual(modelPosOfPosition(corePosition), modelPosition);
    }
  });

  test('color mappings round-trip both players', () => {
    assert.equal(pieceColorOfTurn(1), PieceColor.WHITE);
    assert.equal(pieceColorOfTurn(-1), PieceColor.BLACK);
    assert.equal(turnOfPieceColor(PieceColor.WHITE), 1);
    assert.equal(turnOfPieceColor(PieceColor.BLACK), -1);
  });

  test('model board converts to a driver with matching pieces and turn', () => {
    const board = emptyBoard();
    board[4][5] = 1;
    board[2][3] = -2;
    board[7][6] = 2;

    const json = demoJsonFromModelBoard(board, -1);
    assert.equal(json.sideToMove, 'BLACK');
    const driver = createDriverForModelBoard(board, -1);
    const state = driver.getState();

    assert.equal(state.player, PieceColor.BLACK);
    assert.equal(state.board.isBlackPiece(Position.fromString('D6')), true);
    assert.equal(state.board.isDamePiece(Position.fromString('D6')), true);
    assert.equal(state.board.isBlackPiece(Position.fromString('F4')), false);
    assert.equal(state.board.isDamePiece(Position.fromString('G1')), true);
  });

  test('atomic capture chain expands into exact model hops', async () => {
    const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
    const driver = new GameDriver(demo);
    const move = driver.getMoves().find(
      (candidate) =>
        candidate.captured
          .map((position) => position.toString())
          .toSorted()
          .join(',') === 'E5,E7',
    );
    const hops = expandDriverMoveToModelHops(move);

    assert.deepEqual(hops, [
      { fromR: 4, fromC: 5, toR: 2, toC: 3, isCapture: true, jumpedR: 3, jumpedC: 4 },
      { fromR: 2, fromC: 3, toR: 0, toC: 5, isCapture: true, jumpedR: 1, jumpedC: 4 },
    ]);
  });

  test('human captured set resolves either ambiguous demo1 route', async () => {
    const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
    const cases = [
      { capturedSquares: ['E7', 'E5'], path: ['F4', 'D6', 'F8'] },
      { capturedSquares: ['G7', 'G5'], path: ['F4', 'H6', 'F8'] },
    ];

    for (const { capturedSquares, path } of cases) {
      const driver = new GameDriver(demo);
      playHumanTurnOnDriver(driver, {
        fromSquare: 'F4',
        toSquare: 'F8',
        capturedSquares,
      });
      assert.deepEqual(
        driver.history()[0].path.map((position) => position.toString()),
        path,
      );
    }
  });

  test('unmatched captured set reports engine divergence', async () => {
    const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
    const driver = new GameDriver(demo);

    assert.throws(
      () =>
        playHumanTurnOnDriver(driver, {
          fromSquare: 'F4',
          toSquare: 'F8',
          capturedSquares: ['B2'],
        }),
      /model\/ and core\/ move generation have diverged/,
    );
  });
});
