import { describe, test, expect } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  GameDriver,
  isOneDameEachDraw,
  moveRecordMatches,
  parsePieces,
  parseSideToMove,
} from '../../cli/cli.mjs';
import { Board } from '../../core/board.mjs';
import { Position } from '../../core/position.mjs';
import { PieceColor, PieceType } from '../../core/piece.mjs';
import { readFile } from 'node:fs/promises';

const demoJson = async (name) => JSON.parse(await readFile(`examples/demos/${name}.json`, 'utf8'));

const demo1Json = () => demoJson('demo1');
const demo2Json = () => demoJson('demo2');
const demo3Json = () => demoJson('demo3');
const demo4Json = () => demoJson('demo4');

describe('GameDriver initialization', () => {
  test('standard setup: White to move, 7 opening moves', () => {
    const driver = new GameDriver();
    const state = driver.getState();
    expect(state.player).toBe(PieceColor.WHITE);
    expect(state.moves.length).toBe(7);
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.isGameOver).toBe(false);
  });

  test('custom demo setup loads pieces and metadata', async () => {
    const driver = new GameDriver(await demo1Json());
    const state = driver.getState();
    expect(state.player).toBe(PieceColor.WHITE);
    expect(state.moves.length).toBe(2);
    expect(driver.metadata.id).toBe('demo1');
    expect(driver.metadata.title).toContain('branching chain capture');
  });

  test('invalid demo JSON: unknown piece color throws', () => {
    const bad = { pieces: [['D5', { color: 'PURPLE', type: 'PION' }]] };
    expect(() => new GameDriver(bad)).toThrow(/Invalid piece color/);
  });

  test('invalid demo JSON: bad square string throws', () => {
    const bad = { pieces: [['Z9', { color: 'WHITE', type: 'PION' }]] };
    expect(() => new GameDriver(bad)).toThrow();
  });

  test('invalid demo JSON: duplicate squares throw', () => {
    const bad = {
      pieces: [
        ['D5', { color: 'WHITE', type: 'PION' }],
        ['D5', { color: 'BLACK', type: 'PION' }],
      ],
    };
    expect(() => new GameDriver(bad)).toThrow(/Duplicate/);
  });

  test('unrecognized input shape throws', () => {
    expect(() => new GameDriver({ foo: 'bar' })).toThrow(/Unrecognized/);
  });
});

describe('Move execution', () => {
  test('playMoveIndex advances state and enables undo', () => {
    const driver = new GameDriver();
    const before = driver.getState();
    const after = driver.playMoveIndex(0);
    expect(after.player).toBe(PieceColor.BLACK);
    expect(after.canUndo).toBe(true);
    expect(after.canRedo).toBe(false);
    expect(after.board).not.toBe(before.board);
  });

  test('playMoveIndex out of range throws', () => {
    const driver = new GameDriver();
    const count = driver.getMoves().length;
    expect(() => driver.playMoveIndex(count)).toThrow(RangeError);
    expect(() => driver.playMoveIndex(-1)).toThrow(RangeError);
  });

  test('ambiguous coordinate move requires a choice', async () => {
    const driver = new GameDriver(await demo1Json());
    try {
      driver.playMovePosition('e4', 'e8');
      assert.fail('expected AmbiguousMoveError');
    } catch (error) {
      expect(error.code).toBe('AMBIGUOUS_MOVE');
      expect(error.candidates.length).toBe(2);
    }
  });

  test('ambiguous coordinate move with choice plays the selected route', async () => {
    const driver = new GameDriver(await demo1Json());
    const state = driver.playMovePosition('e4', 'e8', 1);
    expect(state.moves.length).toBeGreaterThan(0);
    expect(driver.history().length).toBe(1);
    const played = driver.history()[0];
    expect(played.path.map((p) => p.toString())).toEqual(['E4', 'C6', 'E8']);
  });

  test('ambiguous choice out of range throws', async () => {
    const driver = new GameDriver(await demo1Json());
    expect(() => driver.playMovePosition('e4', 'e8', 3)).toThrow(RangeError);
  });

  test('invalid coordinate move throws', async () => {
    const driver = new GameDriver(await demo1Json());
    expect(() => driver.playMovePosition('e4', 'a6')).toThrow(/No legal move/);
  });
});

describe('History navigation', () => {
  test('undo and redo return to the same state', () => {
    const driver = new GameDriver();
    const root = driver.getState().board;
    driver.playMoveIndex(0);
    const moved = driver.getState().board;
    const undo = driver.undo();
    expect(undo.changed).toBe(true);
    expect(undo.state.board.equals(root)).toBe(true);
    const redo = driver.redo();
    expect(redo.changed).toBe(true);
    expect(redo.state.board.equals(moved)).toBe(true);
  });

  test('undo at the beginning is a no-op', () => {
    const driver = new GameDriver();
    const result = driver.undo();
    expect(result.changed).toBe(false);
    expect(result.state.canUndo).toBe(false);
  });

  test('redo at the latest state is a no-op', () => {
    const driver = new GameDriver();
    driver.playMoveIndex(0);
    const result = driver.redo();
    expect(result.changed).toBe(false);
  });

  test('playing a new move after undo clears redo entries', () => {
    const driver = new GameDriver();
    driver.playMoveIndex(0);
    driver.playMoveIndex(0);
    driver.undo();
    expect(driver.getState().canRedo).toBe(true);
    driver.playMoveIndex(1);
    expect(driver.getState().canRedo).toBe(false);
    expect(driver.history().length).toBe(2);
  });
});

describe('Save / Load', () => {
  test('toJSON / load round-trips identical state', async () => {
    const driver = new GameDriver(await demo1Json());
    driver.playMovePosition('e4', 'e8', 1);
    const json = driver.toJSON();
    expect(json.format).toBe('thai-checkers-cli-session-v1');
    expect(json.moveSequence.length).toBe(1);
    expect(json.currentIndex).toBe(1);

    const fresh = new GameDriver();
    fresh.load(json);
    const loaded = fresh.getState();
    expect(loaded.board.equals(driver.getState().board)).toBe(true);
    expect(loaded.player).toBe(driver.getState().player);
    expect(fresh.history().length).toBe(1);
  });

  test('saved session preserves currentIndex and redo history', () => {
    const driver = new GameDriver();
    driver.playMoveIndex(0);
    driver.playMoveIndex(0);
    driver.undo();
    const json = driver.toJSON();
    expect(json.currentIndex).toBe(1);
    expect(json.moveSequence.length).toBe(2);

    const fresh = new GameDriver();
    fresh.load(json);
    expect(fresh.getState().canRedo).toBe(true);
    expect(fresh.toJSON().currentIndex).toBe(1);
    const redo = fresh.redo();
    expect(redo.changed).toBe(true);
  });

  test('loading validates saved move records against replayed legal moves', () => {
    const driver = new GameDriver();
    driver.playMoveIndex(0);
    const json = driver.toJSON();
    // Corrupt a saved record's path to force a mismatch.
    json.moveSequence[0].path = ['D5', 'E4'];
    const fresh = new GameDriver();
    expect(() => fresh.load(json)).toThrow(/incompatible/);
  });

  test('loading rejects currentIndex out of range', () => {
    const driver = new GameDriver();
    driver.playMoveIndex(0);
    const json = driver.toJSON();
    json.currentIndex = 5;
    const fresh = new GameDriver();
    expect(() => fresh.load(json)).toThrow(RangeError);
  });
});

describe('Draw handling', () => {
  test('ONE_DAME_EACH board reports forced terminal draw', () => {
    const board = Board.fromPieces([
      [Position.fromString('D1'), { color: PieceColor.WHITE, type: PieceType.DAME }],
      [Position.fromString('E8'), { color: PieceColor.BLACK, type: PieceType.DAME }],
    ]);
    expect(isOneDameEachDraw(board)).toBe(true);
    const driver = new GameDriver({
      pieces: [
        ['D1', { color: 'WHITE', type: 'DAME' }],
        ['E8', { color: 'BLACK', type: 'DAME' }],
      ],
    });
    const state = driver.getState();
    expect(state.isGameOver).toBe(true);
    expect(state.isDraw).toBe(true);
    expect(state.drawReason).toBe('ONE_DAME_EACH');
    expect(state.winner).toBe(null);
  });

  test('standard board is not a ONE_DAME_EACH draw', () => {
    const driver = new GameDriver();
    const state = driver.getState();
    expect(state.isDraw).toBe(false);
    expect(state.drawReason).toBe(null);
  });
});

describe('Pure helper functions', () => {
  test('parseSideToMove defaults to WHITE and accepts strings', () => {
    expect(parseSideToMove(undefined)).toBe(PieceColor.WHITE);
    expect(parseSideToMove('BLACK')).toBe(PieceColor.BLACK);
    expect(() => parseSideToMove('RED')).toThrow(/Invalid side/);
  });

  test('parsePieces converts demo entries to Position/pieceInfo pairs', () => {
    const pairs = parsePieces([['D5', { color: 'WHITE', type: 'PION' }]]);
    expect(pairs.length).toBe(1);
    expect(pairs[0][0].toString()).toBe('D5');
    expect(pairs[0][1].color).toBe(PieceColor.WHITE);
    expect(pairs[0][1].type).toBe(PieceType.PION);
  });

  test('moveRecordMatches compares path and captured sets', () => {
    const move = {
      from: Position.fromString('E4'),
      to: Position.fromString('E8'),
      captured: [Position.fromString('F5'), Position.fromString('F7')],
      path: ['E4', 'G6', 'E8'].map((s) => Position.fromString(s)),
    };
    const record = {
      from: 'E4',
      to: 'E8',
      captured: ['F5', 'F7'],
      path: ['E4', 'G6', 'E8'],
    };
    expect(moveRecordMatches(move, record)).toBe(true);
    const badRecord = { ...record, path: ['E4', 'C6', 'E8'] };
    expect(moveRecordMatches(move, badRecord)).toBe(false);
  });
});

describe('Demo scenarios (demo1-demo4)', () => {
  test('demo1: branching chain capture with two routes to E8', async () => {
    const driver = new GameDriver(await demo1Json());
    const state = driver.getState();
    expect(state.moves.length).toBe(2);
    // Both moves share from=E4, to=E8 but differ in path/captures.
    const endpoints = state.moves.map((m) => `${m.from.toString()}-${m.to.toString()}`);
    expect(endpoints.every((e) => e === 'E4-E8')).toBe(true);
    // Playing route 1 captures D5 then D7 (4 black -> 2 black remain).
    const after = driver.playMovePosition('e4', 'e8', 1);
    expect(after.board.getPieces(PieceColor.BLACK).size).toBe(2);
    const played = driver.history()[0];
    expect(played.captured.map((p) => p.toString())).toEqual(['D5', 'D7']);
  });

  test('demo2: dame loop ending on the original square is a single move', async () => {
    const driver = new GameDriver(await demo2Json());
    const state = driver.getState();
    // Equivalent loop routes are reduced to one legal move (E4 -> E4).
    expect(state.moves.length).toBe(1);
    const move = state.moves[0];
    expect(move.from.toString()).toBe('E4');
    expect(move.to.toString()).toBe('E4');
    expect(move.captured.length).toBe(4);
    // playMovePosition with no choice applies the single route directly.
    const after = driver.playMovePosition('e4', 'e4');
    expect(after.board.getPieces(PieceColor.BLACK).size).toBe(0);
    expect(after.player).toBe(PieceColor.BLACK);
  });

  test('demo3: equivalent dame loops reduced to one move (no route prompt)', async () => {
    const driver = new GameDriver(await demo3Json());
    const state = driver.getState();
    // Both ring directions are one legal move; no ambiguity.
    expect(state.moves.length).toBe(1);
    const move = state.moves[0];
    expect(move.from.toString()).toBe('E8');
    expect(move.to.toString()).toBe('E8');
    expect(move.captured.length).toBe(6);
    // Should NOT throw AmbiguousMoveError — applies immediately.
    const after = driver.playMovePosition('e8', 'e8');
    expect(after.board.getPieces(PieceColor.BLACK).size).toBe(0);
    expect(after.board.getPieces(PieceColor.WHITE).size).toBe(1);
  });

  test('demo4: dame loop with central branching is ambiguous', async () => {
    const driver = new GameDriver(await demo4Json());
    const state = driver.getState();
    // The central D5 piece creates genuine branches -> multiple routes.
    expect(state.moves.length).toBeGreaterThan(1);
    const endpoints = state.moves.map((m) => `${m.from.toString()}-${m.to.toString()}`);
    // All branches start at E8; at least one ends elsewhere (not all E8-E8).
    expect(endpoints.every((e) => e.startsWith('E8-'))).toBe(true);
    expect(endpoints.some((e) => e !== 'E8-E8')).toBe(true);
    // Without a choice it must throw AMBIGUOUS_MOVE.
    try {
      driver.playMovePosition('e8', 'e8');
      assert.fail('expected AmbiguousMoveError');
    } catch (error) {
      expect(error.code).toBe('AMBIGUOUS_MOVE');
      expect(error.candidates.length).toBeGreaterThan(1);
    }
    // Choosing route 1 applies a valid capture sequence.
    const after = driver.playMovePosition('e8', 'e8', 1);
    expect(after.board.getPieces(PieceColor.BLACK).size).toBeLessThan(8);
  });

  test('all demos load with correct metadata and WHITE to move', async () => {
    const demos = [
      ['demo1', 'branching chain capture'],
      ['demo2', 'dame loop capture ending on the original square'],
      ['demo3', 'equivalent dame loops reduced to one move'],
      ['demo4', 'dame loop capture with extra central branching'],
    ];
    for (const [name, titleFragment] of demos) {
      const driver = new GameDriver(await demoJson(name));
      const state = driver.getState();
      expect(state.player).toBe(PieceColor.WHITE);
      expect(driver.metadata.id).toBe(name);
      expect(driver.metadata.title).toContain(titleFragment);
      expect(state.isGameOver).toBe(false);
    }
  });

  test('demo save/load round-trips through every demo', async () => {
    for (const name of ['demo1', 'demo2', 'demo3', 'demo4']) {
      const driver = new GameDriver(await demoJson(name));
      // Play the first available move (or route 1 if ambiguous).
      const moves = driver.getMoves();
      if (moves.length === 1) {
        driver.playMoveIndex(0);
      } else {
        driver.playMovePosition(moves[0].from.toString(), moves[0].to.toString(), 1);
      }
      const json = driver.toJSON();
      const fresh = new GameDriver();
      fresh.load(json);
      expect(fresh.getState().board.equals(driver.getState().board)).toBe(true);
      expect(fresh.history().length).toBe(1);
    }
  });

  test('playAiMove returns AI statistics: choice, score, nodes, and time', () => {
    const driver = new GameDriver();
    const result = driver.playAiMove(2);
    expect(result.played).toBe(true);
    expect(result.choice).toBeDefined();
    expect(typeof result.choice).toBe('number');
    expect(result.score).toBeDefined();
    expect(typeof result.score).toBe('number');
    expect(result.nodes).toBeDefined();
    expect(typeof result.nodes).toBe('number');
    expect(result.time).toBeDefined();
    expect(typeof result.time).toBe('number');
  });
});
