import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { Position } from '../../core/Position.mjs';
import { Board } from '../../core/Board.mjs';
import { Game } from '../../core/Game.mjs';
import { Analyzer, MAX_ANALYSIS_DEPTH, NO_PROGRESS_THRESHOLD } from '../../core/Analyzer.mjs';
import { MATE_SCORE, MATE_SCORE_THRESHOLD } from '../../core/evaluation.mjs';
import { promotionRow } from '../../core/directions.mjs';

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
  #boardHistory;
  #terminalAtPly;

  constructor({
    board,
    rootPlayer = PieceColor.WHITE,
    moveAtPly,
    positionKeyAtPly = (ply) => 10_000n + BigInt(ply),
    positionKeyHistory,
    boardHistory,
    terminalAtPly = Infinity,
  }) {
    this.#board = board;
    this.#rootPlayer = rootPlayer;
    this.#moveAtPly = moveAtPly;
    this.#positionKeyAtPly = positionKeyAtPly;
    this.#positionKeyHistory = positionKeyHistory ?? [positionKeyAtPly(0)];
    this.#boardHistory = boardHistory ?? [board];
    this.#terminalAtPly = terminalAtPly;
  }

  board() {
    return this.#board;
  }

  player() {
    return this.#ply % 2 === 0 ? this.#rootPlayer : oppositeColor(this.#rootPlayer);
  }

  getMoves() {
    return this.#ply >= this.#terminalAtPly
      ? []
      : [this.#moveAtPly(this.#ply, this.player())];
  }

  moveCount() {
    return this.getMoves().length;
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

  getBoardHistory() {
    return [...this.#boardHistory];
  }

  get ply() {
    return this.#ply;
  }
}

class RepeatedRootMovesGame {
  #selectedMove = null;
  #includeChildPositionsInHistory;
  #board = Board.fromPieces([
    [position('A1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
    [position('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
  ]);
  #rootMoves = [scriptedMove('A1', 'B2'), scriptedMove('A1', 'C3')];

  constructor({ includeChildPositionsInHistory = true } = {}) {
    this.#includeChildPositionsInHistory = includeChildPositionsInHistory;
  }

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
    return this.#includeChildPositionsInHistory ? [2n, 3n, 1n] : [1n];
  }

  getBoardHistory() {
    return [this.#board];
  }

  get selectedMove() {
    return this.#selectedMove;
  }
}

const analyzeScriptedGame = (scriptedGame, depth, options) => {
  const originalCopy = Game.copy;
  Game.copy = () => scriptedGame;
  try {
    return new Analyzer(new Game(), options).analyze(depth);
  } finally {
    Game.copy = originalCopy;
  }
};

const playMove = (game, from, to) => {
  const moves = game.getMoves();
  const index = moves.findIndex(
    (move) => move.from.toString() === from && move.to.toString() === to,
  );
  assert.notEqual(index, -1, `Expected legal move ${from}-${to}`);
  const move = moves[index];
  game.selectMove(index);
  return move;
};

const PLAYED_NO_PROGRESS_MOVES = [
  ['A1', 'D4'],
  ['B4', 'D6'],
  ['D4', 'E3'],
  ['D6', 'E5'],
  ['E3', 'C5'],
  ['E5', 'F4'],
  ['C5', 'D4'],
  ['F4', 'D2'],
  ['D4', 'E5'],
  ['D2', 'E3'],
  ['E5', 'C3'],
];

const PLAYED_PROMOTION_FIXTURE_MOVES = [
  ['A1', 'B2'],
  ['B4', 'A3'],
  ['B2', 'A1'],
  ['A3', 'C1'],
  ['A1', 'C3'],
  ['C1', 'A3'],
  ['C3', 'D2'],
  ['A3', 'B2'],
  ['D2', 'C1'],
  ['B2', 'A1'],
  ['C1', 'A3'],
  ['A1', 'C3'],
  ['A3', 'C1'],
  ['C3', 'E1'],
  ['C1', 'B2'],
];

const buildPlayedNoProgressGame = (moveCount) => {
  const board = Board.fromPieces([
    [position('B4'), { color: PieceColor.WHITE, type: PieceType.DAME }],
    [position('A1'), { color: PieceColor.BLACK, type: PieceType.DAME }],
  ]);
  const game = Game.from(board, PieceColor.BLACK);
  const quietMoves = PLAYED_NO_PROGRESS_MOVES.slice(0, moveCount).map(([from, to]) =>
    playMove(game, from, to),
  );
  return { game, quietMoves };
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

  test('constructor validates optional position bias configuration', () => {
    const game = new Game();

    assert.throws(() => new Analyzer(game, null), /options/);
    assert.throws(() => new Analyzer(game, { positionBias: 1 }), /positionBias/);
    assert.throws(() => new Analyzer(game, { pruneMoves: true }), /pruneMoves/);
  });

  test('a zero position bias preserves the analyzer result', () => {
    const game = new Game();
    const withoutProvider = new Analyzer(game).analyze(2);
    const withZeroProvider = new Analyzer(game, { positionBias: () => 0 }).analyze(2);

    assert.notEqual(withoutProvider, null);
    assert.notEqual(withZeroProvider, null);
    assert.equal(withZeroProvider.score, withoutProvider.score);
    assert.equal(withZeroProvider.move.from.toString(), withoutProvider.move.from.toString());
    assert.equal(withZeroProvider.move.to.toString(), withoutProvider.move.to.toString());
  });

  test('analyzeCandidates ranks every surviving root move and preserves analyze best move', () => {
    const game = new Game();
    const candidates = new Analyzer(game).analyzeCandidates(1);
    const best = new Analyzer(game).analyze(1);

    assert.equal(candidates.length, game.getMoves().length);
    assert.equal(candidates.every(({ score }) => typeof score === 'number'), true);
    assert.equal(
      candidates.every((candidate, index) => index === 0 || candidates[index - 1].score >= candidate.score),
      true,
    );
    assert.notEqual(best, null);
    assert.equal(candidates[0].move.from.toString(), best.move.from.toString());
    assert.equal(candidates[0].move.to.toString(), best.move.to.toString());
    assert.equal(candidates[0].score, best.score);
  });

  test('analyzeCandidates returns an empty list for a terminal position', () => {
    const game = Game.from(Board.empty(), PieceColor.WHITE);
    assert.deepEqual(new Analyzer(game).analyzeCandidates(1), []);
  });

  test('position bias receives side-to-move keys and can change root move selection', () => {
    const game = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });
    const visitedKeys = [];
    const result = analyzeScriptedGame(game, 1, {
      positionBias: (positionKey) => {
        visitedKeys.push(positionKey);
        return positionKey === 2n ? -100 : 100;
      },
    });

    assert.notEqual(result, null);
    assert.equal(result.move.to.toString(), 'B2');
    assert.deepEqual(new Set(visitedKeys), new Set([2n, 3n]));
    assert.equal(game.selectedMove, null);
  });

  test('position bias must return a finite number at a static leaf', () => {
    const game = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });

    assert.throws(
      () => analyzeScriptedGame(game, 1, { positionBias: () => Number.NaN }),
      /finite number/,
    );
  });

  test('hard pruning removes selected root moves from consideration', () => {
    const game = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });
    const result = analyzeScriptedGame(game, 1, {
      pruneMoves: (positionKey, moves) => {
        assert.equal(positionKey, 1n);
        assert.equal(moves.length, 2);
        return [0];
      },
    });

    assert.notEqual(result, null);
    assert.equal(result.move.to.toString(), 'C3');
    assert.equal(game.selectedMove, null);
  });

  test('hard pruning cannot remove every legal root move', () => {
    const game = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });
    const result = analyzeScriptedGame(game, 1, { pruneMoves: () => [0, 1] });

    assert.notEqual(result, null);
    assert.equal(result.move.to.toString(), 'C3');
  });

  test('hard pruning validates provider output and move indices', () => {
    const invalidGame = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });
    assert.throws(
      () => analyzeScriptedGame(invalidGame, 1, { pruneMoves: () => null }),
      /iterable/,
    );

    const outOfRangeGame = new RepeatedRootMovesGame({ includeChildPositionsInHistory: false });
    assert.throws(
      () => analyzeScriptedGame(outOfRangeGame, 1, { pruneMoves: () => [2] }),
      /invalid move index/,
    );
  });

  test('terminal and repetition policy scores bypass position bias', () => {
    const board = Board.fromPieces([
      [position('A1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('H8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const terminalGame = new LinearSearchGame({
      board,
      moveAtPly: () => scriptedMove('A1', 'B2'),
      terminalAtPly: 1,
    });
    const failIfCalled = () => {
      throw new Error('position bias must not be called');
    };

    const terminal = analyzeScriptedGame(terminalGame, 1, { positionBias: failIfCalled });
    const repeated = analyzeScriptedGame(new RepeatedRootMovesGame(), 1, {
      positionBias: failIfCalled,
    });

    assert.notEqual(terminal, null);
    assert.equal(terminal.score, MATE_SCORE - 1);
    assert.notEqual(repeated, null);
    assert.equal(repeated.score, -MATE_SCORE + 1);
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

  test('the 16th simulated no-progress ply is a root loss but the 15th is evaluated', () => {
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
    assert.equal(depth16.score, -MATE_SCORE + NO_PROGRESS_THRESHOLD);
    assert.equal(depth16Game.ply, 0);
  });

  test('played quiet plies count toward the no-progress threshold at normal search depth', () => {
    const { game, quietMoves } = buildPlayedNoProgressGame(10);

    assert.equal(quietMoves.every((move) => move.captured.length === 0), true);
    assert.equal(
      new Set(game.getPositionKeyHistory()).size,
      game.getPositionKeyHistory().length,
    );

    const searchDepth = NO_PROGRESS_THRESHOLD - quietMoves.length;
    const result = new Analyzer(game).analyze(searchDepth);

    assert.notEqual(result, null);
    assert.equal(result.score, -MATE_SCORE + searchDepth);
  });

  test('no-progress remains a root loss when reached on an odd search ply', () => {
    const { game, quietMoves } = buildPlayedNoProgressGame(11);
    const searchDepth = NO_PROGRESS_THRESHOLD - quietMoves.length;

    const result = new Analyzer(game).analyze(searchDepth);

    assert.notEqual(result, null);
    assert.equal(result.score, -MATE_SCORE + searchDepth);
  });

  test('all no-progress root choices remain legal losing fallbacks', () => {
    const board = Board.fromPieces([
      [position('A1'), { color: PieceColor.BLACK, type: PieceType.DAME }],
      [position('B4'), { color: PieceColor.WHITE, type: PieceType.DAME }],
    ]);
    const game = Game.from(board, PieceColor.BLACK);
    PLAYED_PROMOTION_FIXTURE_MOVES.forEach(([from, to]) => playMove(game, from, to));
    const legalMoves = game.getMoves();
    const analyzer = new Analyzer(game);

    const result = analyzer.analyze(6);

    assert.notEqual(result, null);
    assert.equal(
      legalMoves.some(
        (move) => move.from.equals(result.move.from) && move.to.equals(result.move.to),
      ),
      true,
    );
    assert.equal(result.score, -MATE_SCORE + 1);
    assert.equal(analyzer.nodeCount, 0);
  });

  test('played no-progress history prefers promotion and resets the counter', () => {
    const board = Board.fromPieces([
      [position('A1'), { color: PieceColor.BLACK, type: PieceType.DAME }],
      [position('B4'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.PION }],
    ]);
    const game = Game.from(board, PieceColor.BLACK);
    const quietMoves = PLAYED_PROMOTION_FIXTURE_MOVES.map(([from, to]) =>
      playMove(game, from, to),
    );

    assert.equal(quietMoves.every((move) => move.captured.length === 0), true);
    assert.equal(
      new Set(game.getPositionKeyHistory()).size,
      game.getPositionKeyHistory().length,
    );

    const result = new Analyzer(game).analyze(6);

    assert.notEqual(result, null);
    assert.equal(result.move.from.toString(), 'C7');
    assert.equal(result.move.to.y, promotionRow(PieceColor.WHITE));
    assert.equal(game.board().isDamePiece(result.move.from), false);
    assert.equal(Math.abs(result.score) < MATE_SCORE_THRESHOLD, true);

    playMove(game, result.move.from.toString(), result.move.to.toString());
    assert.equal(game.board().isDamePiece(result.move.to), true);

    const afterPromotion = new Analyzer(game).analyze(2);
    assert.notEqual(afterPromotion, null);
    assert.equal(Math.abs(afterPromotion.score) < MATE_SCORE_THRESHOLD, true);
  });

  test('a capture in played history resets the no-progress counter', () => {
    const board = Board.fromPieces([
      [position('A1'), { color: PieceColor.BLACK, type: PieceType.DAME }],
      [position('B4'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.PION }],
    ]);
    const game = Game.from(board, PieceColor.BLACK);
    const quietMoves = PLAYED_PROMOTION_FIXTURE_MOVES.map(([from, to]) =>
      playMove(game, from, to),
    );
    assert.equal(quietMoves.every((move) => move.captured.length === 0), true);

    const capture = playMove(game, 'E1', 'G3');
    assert.deepEqual(capture.captured.map((pos) => pos.toString()), ['F2']);

    const analyzer = new Analyzer(game);
    const result = analyzer.analyze(1);

    assert.notEqual(result, null);
    assert.equal(Math.abs(result.score) < MATE_SCORE_THRESHOLD, true);
    assert.equal(analyzer.nodeCount > 0, true);
  });

  test('a real terminal win takes precedence over the no-progress policy', () => {
    const board = Board.fromPieces([
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const game = new LinearSearchGame({
      board,
      moveAtPly: () => scriptedMove('C7', 'D8'),
      boardHistory: Array.from({ length: NO_PROGRESS_THRESHOLD }, () => board),
      terminalAtPly: 1,
    });

    const result = analyzeScriptedGame(game, 1);

    assert.notEqual(result, null);
    assert.equal(result.score, MATE_SCORE - 1);
    assert.equal(game.ply, 0);
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

  test('repetition takes precedence when the same move also reaches no-progress', () => {
    const board = Board.fromPieces([
      [position('C7'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [position('F2'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    const game = new LinearSearchGame({
      board,
      moveAtPly: (_ply, player) =>
        player === PieceColor.WHITE ? scriptedMove('C7', 'D8') : scriptedMove('F2', 'E1'),
      positionKeyAtPly: (ply) => BigInt(ply === NO_PROGRESS_THRESHOLD ? 0 : ply),
    });

    const result = analyzeScriptedGame(game, NO_PROGRESS_THRESHOLD);

    assert.notEqual(result, null);
    assert.equal(result.score, MATE_SCORE - NO_PROGRESS_THRESHOLD);
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
