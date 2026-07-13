import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Game } from '../../core/Game.mjs';

describe('core/game', () => {
  test('initialization with default board and player', () => {
    const game = new Game();
    assert.equal(game.player(), PieceColor.WHITE);
    assert.equal(game.board().equals(Board.setup()), true);
    assert.equal(game.getBoardHistory().length, 1);
    assert.equal(game.getEncodedHistory().length, 1);
    assert.equal(game.getMoveSequence().length, 0);
  });

  test('initialization with custom board and explicit player', () => {
    const customBoard = Board.empty();
    const game = Game.from(customBoard, PieceColor.BLACK);
    assert.equal(game.player(), PieceColor.BLACK);
    assert.equal(game.board().equals(customBoard), true);
  });

  test('copy game state', () => {
    const original = new Game();
    const copied = Game.copy(original);
    assert.equal(copied.player(), original.player());
    assert.equal(copied.board().equals(original.board()), true);
    assert.deepEqual(copied.getMoveSequence(), original.getMoveSequence());

    // Ensure changing original doesn't affect copy
    if (original.moveCount() > 0) {
      original.selectMove(0);
      assert.notEqual(copied.getMoveSequence().length, original.getMoveSequence().length);
    }
  });

  test('selectMove, undoMove, and history tracking', () => {
    const game = new Game();
    const initialMovesCount = game.moveCount();
    assert.equal(initialMovesCount > 0, true);

    const initialBoard = game.board();

    // Select the first move
    game.selectMove(0);
    assert.equal(game.getMoveSequence().length, 1);
    assert.equal(game.getMoveSequence()[0], 0);
    assert.equal(game.player(), PieceColor.BLACK); // Turn toggles to BLACK
    assert.equal(game.getBoardHistory().length, 2);
    assert.equal(game.getEncodedHistory().length, 2);

    // Undo the move
    game.undoMove();
    assert.equal(game.getMoveSequence().length, 0);
    assert.equal(game.player(), PieceColor.WHITE);
    assert.equal(game.board().equals(initialBoard), true);
    assert.equal(game.getBoardHistory().length, 1);
    assert.equal(game.getEncodedHistory().length, 1);
  });

  test('positionKey calculations', () => {
    const game = new Game();
    const expectedKey = (game.board().encode() << 1n) | BigInt(game.player());
    assert.equal(game.positionKey(), expectedKey);
  });

  test('getMoves returns valid Move structures', () => {
    const game = new Game();
    const moves = game.getMoves();
    assert.equal(moves.length, game.moveCount());

    if (moves.length > 0) {
      const firstMove = moves[0];
      assert.equal(firstMove.from instanceof Position, true);
      assert.equal(firstMove.to instanceof Position, true);
      assert.equal(Array.isArray(firstMove.captured), true);
      assert.equal(Array.isArray(firstMove.path), true);
    }
  });
});
