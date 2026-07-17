import { afterEach, beforeEach, describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PieceColor } from '../../core/piece.mjs';
import {
  createEmptyTrajectory,
  hardPruneMoveIndices,
  loadTrajectory,
  logarithmicCreditWeight,
  recordCompletedGame,
  saveTrajectory,
  trajectoryBias,
  trajectoryEdgeKey,
  validateTrajectory,
} from '../../train/trajectory.mjs';

describe('training trajectory', () => {
  let temporaryDirectory;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'thai-trajectory-test-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('creates a valid empty version 1 store', () => {
    const trajectory = createEmptyTrajectory();

    assert.equal(validateTrajectory(trajectory), trajectory);
    assert.deepEqual(trajectory.games, {
      total: 0,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
    });
    assert.deepEqual(trajectory.gameIds, {});
    assert.deepEqual(trajectory.states, {});
    assert.deepEqual(trajectory.edges, {});
  });

  test('rejects unsupported versions and inconsistent counters', () => {
    const unsupported = createEmptyTrajectory();
    unsupported.version = 2;
    assert.throws(() => validateTrajectory(unsupported), /Unsupported trajectory version/);

    const inconsistentGames = createEmptyTrajectory();
    inconsistentGames.games.total = 1;
    assert.throws(() => validateTrajectory(inconsistentGames), /Game outcome counts/);

    const inconsistentState = createEmptyTrajectory();
    inconsistentState.states['1'] = {
      visits: 2,
      wins: 1,
      losses: 0,
      draws: 0,
      valueSum: 1,
    };
    assert.throws(() => validateTrajectory(inconsistentState), /outcome counts/);

    const invalidGameIds = createEmptyTrajectory();
    invalidGameIds.gameIds.invalid = true;
    assert.throws(() => validateTrajectory(invalidGameIds), /gameIds/);
  });

  test('upgrades an older valid store to start tracking game IDs', () => {
    const trajectory = createEmptyTrajectory();
    delete trajectory.gameIds;

    validateTrajectory(trajectory);

    assert.deepEqual(trajectory.gameIds, {});
  });

  test('rejects invalid learning configuration', () => {
    const invalidCurve = createEmptyTrajectory();
    invalidCurve.config.creditCurve = 'linear';
    assert.throws(() => validateTrajectory(invalidCurve), /creditCurve/);

    const invalidPrior = createEmptyTrajectory();
    invalidPrior.config.priorVisits = -1;
    assert.throws(() => validateTrajectory(invalidPrior), /priorVisits/);

    const invalidBias = createEmptyTrajectory();
    invalidBias.config.maxBias = Number.NaN;
    assert.throws(() => validateTrajectory(invalidBias), /maxBias/);

    const invalidPruneRate = createEmptyTrajectory();
    invalidPruneRate.config.hardPrune.minLossRate = 1.1;
    assert.throws(() => validateTrajectory(invalidPruneRate), /minLossRate/);
  });

  test('builds deterministic state and edge keys', () => {
    assert.equal(trajectoryEdgeKey(42n, '1:2:3,4'), '42:1:2:3,4');
    assert.equal(trajectoryEdgeKey('42', '1:2:3,4'), '42:1:2:3,4');
    assert.throws(() => trajectoryEdgeKey('-1', 'move'), /positionKey/);
    assert.throws(() => trajectoryEdgeKey(1n, ''), /moveKey/);
  });

  test('hard-prunes only edges that meet every confidence threshold', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.edges['10:bad'] = {
      visits: 30,
      wins: 2,
      losses: 27,
      draws: 1,
      valueSum: -20,
    };
    trajectory.edges['10:uncertain'] = {
      visits: 29,
      wins: 0,
      losses: 29,
      draws: 0,
      valueSum: -20,
    };

    const pruned = hardPruneMoveIndices(
      trajectory,
      10n,
      ['bad', 'uncertain', 'unknown'],
      (move) => move,
    );

    assert.deepEqual(pruned, new Set([0]));
  });

  test('hard-prune keeps the strongest observed move if every edge qualifies', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.edges['10:worse'] = {
      visits: 30,
      wins: 0,
      losses: 30,
      draws: 0,
      valueSum: -25,
    };
    trajectory.edges['10:less-bad'] = {
      visits: 30,
      wins: 3,
      losses: 27,
      draws: 0,
      valueSum: -20,
    };

    const pruned = hardPruneMoveIndices(
      trajectory,
      '10',
      ['worse', 'less-bad'],
      (move) => move,
    );

    assert.deepEqual(pruned, new Set([0]));
  });

  test('hard-prune never removes a forced move', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.edges['10:forced'] = {
      visits: 100,
      wins: 0,
      losses: 100,
      draws: 0,
      valueSum: -100,
    };

    assert.deepEqual(
      hardPruneMoveIndices(trajectory, 10n, ['forced'], (move) => move),
      new Set(),
    );
  });

  test('aggregates outcomes from each side-to-move perspective', () => {
    const trajectory = createEmptyTrajectory();
    recordCompletedGame(
      trajectory,
      [
        { positionKey: 10n, player: PieceColor.WHITE, moveKey: 'white-move' },
        { positionKey: 20n, player: PieceColor.BLACK, moveKey: 'black-move' },
      ],
      PieceColor.WHITE,
    );

    assert.deepEqual(trajectory.games, {
      total: 1,
      whiteWins: 1,
      blackWins: 0,
      draws: 0,
    });
    assert.equal(trajectory.states['10'].wins, 1);
    assert.equal(trajectory.states['10'].losses, 0);
    assert.equal(trajectory.states['20'].wins, 0);
    assert.equal(trajectory.states['20'].losses, 1);
    assert.equal(trajectory.edges['10:white-move'].wins, 1);
    assert.equal(trajectory.edges['20:black-move'].losses, 1);
    assert.equal(Object.keys(trajectory.gameIds).length, 1);
  });

  test('does not aggregate the same completed game more than once', () => {
    const trajectory = createEmptyTrajectory();
    const records = [
      { positionKey: 10n, player: PieceColor.WHITE, moveKey: 'white-move' },
      { positionKey: 20n, player: PieceColor.BLACK, moveKey: 'black-move' },
    ];

    const first = recordCompletedGame(trajectory, records, PieceColor.WHITE);
    const duplicate = recordCompletedGame(trajectory, records, PieceColor.WHITE);

    assert.equal(first.recorded, true);
    assert.equal(duplicate.recorded, false);
    assert.equal(duplicate.gameId, first.gameId);
    assert.match(first.gameId, /^[a-f0-9]{64}$/);
    assert.equal(trajectory.games.total, 1);
    assert.equal(trajectory.states['10'].visits, 1);
    assert.equal(trajectory.edges['10:white-move'].visits, 1);
    assert.equal(Object.keys(trajectory.gameIds).length, 1);
  });

  test('treats a different result or move sequence as a different game', () => {
    const trajectory = createEmptyTrajectory();
    const records = [{ positionKey: 10n, player: PieceColor.WHITE, moveKey: 'move-a' }];

    const win = recordCompletedGame(trajectory, records, PieceColor.WHITE);
    const loss = recordCompletedGame(trajectory, records, PieceColor.BLACK);
    const otherMove = recordCompletedGame(
      trajectory,
      [{ positionKey: 10n, player: PieceColor.WHITE, moveKey: 'move-b' }],
      PieceColor.WHITE,
    );

    assert.equal(win.recorded, true);
    assert.equal(loss.recorded, true);
    assert.equal(otherMove.recorded, true);
    assert.equal(trajectory.games.total, 3);
    assert.equal(Object.keys(trajectory.gameIds).length, 3);
  });

  test('weights decisions from zero to one along a logarithmic curve', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.config.priorVisits = 0;
    trajectory.config.maxBias = 100;

    recordCompletedGame(
      trajectory,
      [
        { positionKey: 1n, player: PieceColor.WHITE, moveKey: 'first' },
        { positionKey: 2n, player: PieceColor.BLACK, moveKey: 'second' },
        { positionKey: 3n, player: PieceColor.WHITE, moveKey: 'middle' },
        { positionKey: 4n, player: PieceColor.BLACK, moveKey: 'fourth' },
        { positionKey: 5n, player: PieceColor.WHITE, moveKey: 'last' },
      ],
      PieceColor.WHITE,
    );

    assert.equal(trajectory.states['1'].valueSum, 0);
    assert.equal(trajectory.states['2'].valueSum, -Math.log(2) / Math.log(5));
    assert.equal(trajectory.states['3'].valueSum, Math.log(3) / Math.log(5));
    assert.equal(trajectory.states['4'].valueSum, -Math.log(4) / Math.log(5));
    assert.equal(trajectory.states['5'].valueSum, 1);
    assert.equal(trajectoryBias(trajectory, 1n), 0);
    assert.equal(trajectoryBias(trajectory, 5n), 100);
  });

  test('gives a single deciding move full credit and validates weight bounds', () => {
    assert.equal(logarithmicCreditWeight(0, 1), 1);
    assert.equal(logarithmicCreditWeight(0, 5), 0);
    assert.equal(logarithmicCreditWeight(4, 5), 1);
    assert.throws(() => logarithmicCreditWeight(0, 0), /totalDecisions/);
    assert.throws(() => logarithmicCreditWeight(5, 5), /index/);
  });

  test('records draws without adding positive or negative value', () => {
    const trajectory = createEmptyTrajectory();
    recordCompletedGame(
      trajectory,
      [{ positionKey: 5n, player: PieceColor.BLACK, moveKey: 'draw-move' }],
      null,
    );

    assert.equal(trajectory.games.draws, 1);
    assert.equal(trajectory.states['5'].draws, 1);
    assert.equal(trajectory.states['5'].valueSum, 0);
    assert.equal(trajectoryBias(trajectory, 5n), 0);
  });

  test('smooths learned values and clamps malformed extreme input', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.config.priorVisits = 3;
    trajectory.config.maxBias = 200;
    trajectory.states['7'] = {
      visits: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      valueSum: 1,
    };
    assert.equal(trajectoryBias(trajectory, 7n), 50);
    assert.equal(trajectoryBias(trajectory, 8n), 0);

    trajectory.states['7'].valueSum = 100;
    assert.equal(trajectoryBias(trajectory, 7n), 200);
    trajectory.states['7'].valueSum = -100;
    assert.equal(trajectoryBias(trajectory, 7n), -200);
  });

  test('loads a missing file as an empty store', async () => {
    const loaded = await loadTrajectory(path.join(temporaryDirectory, 'missing.json'));
    assert.deepEqual(loaded, createEmptyTrajectory());
  });

  test('reports invalid JSON with its source path', async () => {
    const filePath = path.join(temporaryDirectory, 'broken.json');
    await writeFile(filePath, '{broken', 'utf8');

    await assert.rejects(loadTrajectory(filePath), (error) => {
      assert.equal(error instanceof SyntaxError, true);
      assert.match(error.message, /broken\.json/);
      return true;
    });
  });

  test('atomically saves and loads a validated trajectory', async () => {
    const filePath = path.join(temporaryDirectory, 'nested', 'trajectory.json');
    const trajectory = createEmptyTrajectory();
    recordCompletedGame(
      trajectory,
      [{ positionKey: 99n, player: PieceColor.WHITE, moveKey: 'saved-move' }],
      PieceColor.BLACK,
    );

    await saveTrajectory(filePath, trajectory);

    assert.deepEqual(await loadTrajectory(filePath), trajectory);
    const savedFiles = await readdir(path.dirname(filePath));
    assert.equal(savedFiles.length, 1);
    assert.equal(savedFiles[0], 'trajectory.json');
    const savedSource = await readFile(filePath, 'utf8');
    assert.equal(savedSource.endsWith('\n'), true);
    assert.equal(savedSource.slice(0, -1).includes('\n'), false);
  });
});
