import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GameDriver } from '../../cli/GameDriver.mjs';
import { Position } from '../../core/position.mjs';
import { PieceColor, PieceType } from '../../core/piece.mjs';
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
} from '../../controller/GameDriverBridge.mjs';

const emptyBoard = () => Array.from({ length: 8 }, () => Array(8).fill(0));

describe('GameDriverBridge', () => {
  test('coordinate mappings round-trip known squares', () => {
    const cases = [
      [{ r: 4, c: 4 }, 'E4'],
      [{ r: 0, c: 0 }, 'A8'],
      [{ r: 7, c: 7 }, 'H1'],
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
    board[4][4] = 1;
    board[2][2] = -2;
    board[7][7] = 2;

    const json = demoJsonFromModelBoard(board, -1);
    assert.equal(json.sideToMove, 'BLACK');
    const driver = createDriverForModelBoard(board, -1);
    const state = driver.getState();

    assert.equal(state.player, PieceColor.BLACK);
    assert.equal(state.board.isBlackPiece(Position.fromString('C6')), true);
    assert.equal(state.board.isDamePiece(Position.fromString('C6')), true);
    assert.equal(state.board.isBlackPiece(Position.fromString('E4')), false);
    assert.equal(state.board.isDamePiece(Position.fromString('H1')), true);
  });

  test('atomic capture chain expands into exact model hops', async () => {
    const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
    const driver = new GameDriver(demo);
    const move = driver.getMoves().find((candidate) =>
      candidate.captured.map((position) => position.toString()).toSorted().join(',') === 'D5,D7');
    const hops = expandDriverMoveToModelHops(move);

    assert.deepEqual(hops, [
      { fromR: 4, fromC: 4, toR: 2, toC: 2, isCapture: true, jumpedR: 3, jumpedC: 3 },
      { fromR: 2, fromC: 2, toR: 0, toC: 4, isCapture: true, jumpedR: 1, jumpedC: 3 },
    ]);
  });

  test('human captured set resolves either ambiguous demo1 route', async () => {
    const demo = JSON.parse(await readFile('examples/demos/demo1.json', 'utf8'));
    const cases = [
      { capturedSquares: ['D7', 'D5'], path: ['E4', 'C6', 'E8'] },
      { capturedSquares: ['F7', 'F5'], path: ['E4', 'G6', 'E8'] },
    ];

    for (const { capturedSquares, path } of cases) {
      const driver = new GameDriver(demo);
      playHumanTurnOnDriver(driver, {
        fromSquare: 'E4',
        toSquare: 'E8',
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
      () => playHumanTurnOnDriver(driver, {
        fromSquare: 'E4',
        toSquare: 'E8',
        capturedSquares: ['A2'],
      }),
      /model\/ and core\/ move generation have diverged/,
    );
  });
});
