import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Game } from '../../core/Game.mjs';
import { Analyzer, MAX_ANALYSIS_DEPTH, NO_PROGRESS_THRESHOLD } from '../../core/Analyzer.mjs';
import { MATE_SCORE, MATE_SCORE_THRESHOLD } from '../../core/evaluation.mjs';

const position = (square) => Position.fromString(square);

const scriptedMove = (from, to, captured = []) => ({
  from: position(from),
  to: position(to),
  captured: captured.map(position),
  path: [position(from), position(to)],
});

const oppositeColor = (color) => (color === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE);

class LinearSearchGame {
  #ply = 0;
  #board;
  #rootPlayer;
  #moveAtPly;
  #positionKeyAtPly;
  #positionKeyHistory;

  constructor({
    board,
    rootPlayer = PieceColor.WHITE,
    moveAtPly,
    positionKeyAtPly = (ply) => 10_000n + BigInt(ply),
    positionKeyHistory,
  }) {
    this.#board = board;
    this.#rootPlayer = rootPlayer;
    this.#moveAtPly = moveAtPly;
    this.#positionKeyAtPly = positionKeyAtPly;
    this.#positionKeyHistory = positionKeyHistory ?? [positionKeyAtPly(0)];
  }

  board() {
    return this.#board;
  }

  player() {
    return this.#ply % 2 === 0 ? this.#rootPlayer : oppositeColor(this.#rootPlayer);
  }

  getMoves() {
    return [this.#moveAtPly(this.#ply, this.player())];
  }

  moveCount() {
    return 1;
  }

  selectMove(index) {
    assert.equal(index, 0);
    this.#ply++;
  }

  undoMove() {
    this.#ply--;
  }

  positionKey() {
    return this.#positionKeyAtPly(this.#ply);
  }

  getPositionKeyHistory() {
    return [...this.#positionKeyHistory];
  }

  get ply() {
    return this.#ply;
  }
}

class RepeatedRootMovesGame {
  #selectedMove = null;
  #board = Board.fromPieces([
    [position('A1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
    [position('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
  ]);
  #rootMoves = [scriptedMove('A1', 'B2'), scriptedMove('A1', 'C3')];

  board() {
    return this.#board;
  }

  player() {
    return this.#selectedMove === null ? PieceColor.WHITE : PieceColor.BLACK;
  }

  getMoves() {
    return this.#selectedMove === null ? this.#rootMoves : [scriptedMove('H8', 'G7')];
  }

  moveCount() {
    return this.getMoves().length;
  }

  selectMove(index) {
    assert.equal(this.#selectedMove, null);
    this.#selectedMove = index;
  }

  undoMove() {
    this.#selectedMove = null;
  }

  positionKey() {
    return this.#selectedMove === null ? 1n : BigInt(this.#selectedMove + 2);
  }

  getPositionKeyHistory() {
    return [2n, 3n, 1n];
  }
}

const analyzeScriptedGame = (scriptedGame, depth) => {
  const originalCopy = Game.copy;
  Game.copy = () => scriptedGame;
  try {
    return new Analyzer(new Game()).analyze(depth);
  } finally {
    Game.copy = originalCopy;
  }
};

const playMove = (game, from, to) => {
  const index = game
    .getMoves()
    .findIndex((move) => move.from.toString() === from && move.to.toString() === to);
  assert.notEqual(index, -1, `Expected legal move ${from}-${to}`);
  game.selectMove(index);
};

describe('core/analyzer', () => {
  test('MAX_ANALYSIS_DEPTH constant validation', () => {
    assert.equal(MAX_ANALYSIS_DEPTH, 16);
    assert.equal(NO_PROGRESS_THRESHOLD, 16);
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

  test('analyzer avoids returning to a full position from played history', () => {
    const initialBoard = Board.fromPieces([
      [position('A1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('C1'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [position('E1'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [position('H6'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const game = Game.from(initialBoard, PieceColor.WHITE);

    playMove(game, 'A1', 'D4');
    playMove(game, 'H6', 'G5');
    playMove(game, 'D4', 'A1');
    playMove(game, 'G5', 'H6');

    const seenBeforeAnalysis = new Set(game.getPositionKeyHistory());
    const currentKey = game.positionKey();
    const result = new Analyzer(game).analyze(1);

    assert.notEqual(result, null);
    const selected = Game.copy(game);
    const selectedIndex = selected
      .getMoves()
      .findIndex(
        (move) =>
          move.from.equals(result.move.from) &&
          move.to.equals(result.move.to) &&
          move.captured.length === result.move.captured.length,
      );
    assert.notEqual(selectedIndex, -1);
    selected.selectMove(selectedIndex);

    assert.equal(seenBeforeAnalysis.has(selected.positionKey()), false);
    assert.notEqual(result.move.to.toString(), 'D4');
    assert.equal(game.positionKey(), currentKey);
  });

  test('the 16th simulated no-progress ply loses but the 15th does not', () => {
    const board = Board.fromPieces([
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const quietMove = (_ply, player) =>
      player === PieceColor.WHITE ? scriptedMove('C7', 'D8') : scriptedMove('F2', 'E1');

    const depth15Game = new LinearSearchGame({ board, moveAtPly: quietMove });
    const depth15 = analyzeScriptedGame(depth15Game, 15);
    assert.notEqual(depth15, null);
    assert.equal(Math.abs(depth15.score) < MATE_SCORE_THRESHOLD, true);
    assert.equal(depth15Game.ply, 0);

    const depth16Game = new LinearSearchGame({ board, moveAtPly: quietMove });
    const depth16 = analyzeScriptedGame(depth16Game, 16);
    assert.notEqual(depth16, null);
    // Black makes ply 16 and loses, so the White root sees a win in 16.
    assert.equal(depth16.score, MATE_SCORE - NO_PROGRESS_THRESHOLD);
    assert.equal(depth16Game.ply, 0);
  });

  test('a repetition created inside one search loses for the repeating mover', () => {
    const board = Board.fromPieces([
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const game = new LinearSearchGame({
      board,
      moveAtPly: (_ply, player) =>
        player === PieceColor.WHITE ? scriptedMove('C7', 'D8') : scriptedMove('F2', 'E1'),
      positionKeyAtPly: (ply) => BigInt(ply === 4 ? 0 : ply),
    });

    const result = analyzeScriptedGame(game, 4);

    assert.notEqual(result, null);
    // Black recreates the root position on ply 4 and loses that line.
    assert.equal(result.score, MATE_SCORE - 4);
    assert.equal(game.ply, 0);
  });

  test('capture and promotion reset the simulated no-progress counter', () => {
    const blackPromotionBoard = Board.fromPieces([
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
      [position('B2'), { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);
    const whitePromotionBoard = Board.fromPieces([
      [position('A1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.PION }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);

    const cases = [
      {
        board: blackPromotionBoard,
        rootPlayer: PieceColor.WHITE,
        moveAtPly: (ply, player) => {
          if (ply === 15) return scriptedMove('B2', 'C1');
          return player === PieceColor.WHITE ? scriptedMove('C7', 'D8') : scriptedMove('F2', 'E1');
        },
      },
      {
        board: whitePromotionBoard,
        rootPlayer: PieceColor.BLACK,
        moveAtPly: (ply, player) => {
          if (ply === 15) return scriptedMove('C7', 'D8');
          return player === PieceColor.WHITE ? scriptedMove('A1', 'B2') : scriptedMove('F2', 'E1');
        },
      },
      {
        board: blackPromotionBoard,
        rootPlayer: PieceColor.WHITE,
        moveAtPly: (ply, player) => {
          if (ply === 15) return scriptedMove('F2', 'D4', ['E3']);
          return player === PieceColor.WHITE ? scriptedMove('C7', 'D8') : scriptedMove('F2', 'E1');
        },
      },
    ];

    for (const config of cases) {
      const game = new LinearSearchGame(config);
      const result = analyzeScriptedGame(game, 16);
      assert.notEqual(result, null);
      assert.equal(Math.abs(result.score) < MATE_SCORE_THRESHOLD, true);
      assert.equal(game.ply, 0);
    }
  });

  test('all repeated root choices remain legal losing fallbacks', () => {
    const result = analyzeScriptedGame(new RepeatedRootMovesGame(), 1);

    assert.notEqual(result, null);
    assert.equal(result.move.to.toString(), 'B2');
    assert.equal(result.score, -MATE_SCORE + 1);
  });
});
