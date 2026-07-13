import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Game } from '../../core/Game.mjs';
import { Analyzer, MAX_ANALYSIS_DEPTH } from '../../core/Analyzer.mjs';

describe('core/analyzer', () => {
  test('MAX_ANALYSIS_DEPTH constant validation', () => {
    assert.equal(MAX_ANALYSIS_DEPTH, 16);
  });

  test('analyze method throws RangeError for invalid depth', () => {
    const game = new Game();
    const analyzer = new Analyzer(game);

    assert.throws(() => analyzer.analyze(0), RangeError);
    assert.throws(() => analyzer.analyze(17), RangeError);
    assert.throws(() => analyzer.analyze(1.5), RangeError);
    assert.throws(() => analyzer.analyze(null), RangeError);
  });

  test('analyze returns null if no moves are available', () => {
    const emptyBoard = Board.empty();
    const game = Game.from(emptyBoard, PieceColor.WHITE);
    const analyzer = new Analyzer(game);

    assert.equal(analyzer.analyze(1), null);
  });

  test('analyzer selects the best move in a simple setup', () => {
    // Setup: White pion at C3, Black pion at D4.
    // There is only 1 capture move, which is C3 -> E5 capturing D4.
    // It is White's turn.
    const whitePos = Position.fromString('C3');
    const blackPos = Position.fromString('D4');
    const board = Board.fromPieces([
      [whitePos, { color: PieceColor.WHITE, type: PieceType.PION }],
      [blackPos, { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);
    const game = Game.from(board, PieceColor.WHITE);
    const analyzer = new Analyzer(game);

    const result = analyzer.analyze(1);
    assert.notEqual(result, null);
    assert.equal(result.move.from.toString(), 'C3');
    assert.equal(result.move.to.toString(), 'E5');
    assert.deepEqual(result.move.captured, [blackPos]);
    assert.equal(analyzer.nodeCount > 0, true);
  });

  test('analyzer correct negamax search with depth pruning', () => {
    const game = new Game(); // Standard setup
    const analyzer = new Analyzer(game);

    const result = analyzer.analyze(2);
    assert.notEqual(result, null);
    assert.equal(result.move !== undefined, true);
    assert.equal(typeof result.score, 'number');
    assert.equal(analyzer.nodeCount > 0, true);
  });
});
