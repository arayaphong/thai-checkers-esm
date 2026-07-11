import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Position } from '../../core/position.mjs';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { createGameState } from '../../model/GameState.mjs';
import { INITIAL_BOARD } from '../../model/Types.mjs';
import {
  createDriverForModelBoard,
  createStandardDriver,
  expandDriverMoveToModelHops,
  modelPosOfPosition,
  positionOfModelPos,
} from '../../controller/GameDriverBridge.mjs';

const FIXTURES = [
  'examples/demos/demo1.json',
  'examples/demos/demo2.json',
  'examples/demos/demo3.json',
  'examples/demos/demo4.json',
];

const MAX_PLIES = 20;

const modelBoardFromDemo = (demo) => {
  const board = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (const [square, { color, type }] of demo.pieces) {
    const { r, c } = modelPosOfPosition(Position.fromString(square));
    const sign = color === 'WHITE' ? 1 : -1;
    board[r][c] = sign * (type === 'DAME' ? 2 : 1);
  }
  return board;
};

const applyAtomicMoveToModel = (state, move) =>
  expandDriverMoveToModelHops(move).reduce((current, hop) => current.applyMove(hop), state);

const assertEquivalent = (state, driver, label) => {
  const driverState = driver.getState();
  const expectedTurn = driverState.player === PieceColor.WHITE ? 1 : -1;
  assert.equal(state.turn, expectedTurn, `${label}: side to move differs`);

  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const modelPiece = state.board[r][c];
      if (!Position.isValid(c, 7 - r)) {
        assert.equal(modelPiece, 0, `${label}: non-playable model square (${r}, ${c}) is occupied`);
        continue;
      }
      const position = positionOfModelPos({ r, c });
      const corePiece = driverState.board.isOccupied(position)
        ? {
            color: driverState.board.isBlackPiece(position) ? PieceColor.BLACK : PieceColor.WHITE,
            type: driverState.board.isDamePiece(position) ? PieceType.DAME : PieceType.PION,
          }
        : null;
      const expectedPiece = modelPiece === 0
        ? null
        : {
            color: modelPiece > 0 ? PieceColor.WHITE : PieceColor.BLACK,
            type: Math.abs(modelPiece) === 2 ? PieceType.DAME : PieceType.PION,
          };
      assert.deepEqual(corePiece, expectedPiece, `${label}: piece differs at ${position.toString()}`);
    }
  }
};

const runParityGame = ({ label, board, turn, driver }) => {
  let state = createGameState({ board, turn });
  assertEquivalent(state, driver, `${label}, initial position`);

  for (let ply = 1; ply <= MAX_PLIES; ply += 1) {
    const moves = driver.getMoves();
    if (moves.length === 0 || state.status !== 'playing') break;

    const move = moves[0];
    state = applyAtomicMoveToModel(state, move);
    driver.playMoveIndex(0);
    assertEquivalent(state, driver, `${label}, ply ${ply}`);
  }
};

describe('model/core position parity', () => {
  for (const fixture of FIXTURES) {
    test(fixture, async () => {
      const demo = JSON.parse(await readFile(fixture, 'utf8'));
      const board = modelBoardFromDemo(demo);
      const turn = demo.sideToMove === 'BLACK' ? -1 : 1;
      runParityGame({
        label: fixture,
        board,
        turn,
        driver: createDriverForModelBoard(board, turn),
      });
    });
  }

  test('standard opening position', () => {
    const board = structuredClone(INITIAL_BOARD);
    runParityGame({
      label: 'standard opening',
      board,
      turn: 1,
      driver: createStandardDriver(),
    });
  });
});
