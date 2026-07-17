import { afterEach, beforeEach, describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PieceColor } from '../../core/piece.mjs';
import {
  createEmptyTrajectory,
  loadTrajectory,
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
  });

  test('rejects invalid learning configuration', () => {
    const invalidDiscount = createEmptyTrajectory();
    invalidDiscount.config.discount = 1.01;
    assert.throws(() => validateTrajectory(invalidDiscount), /discount/);

    const invalidPrior = createEmptyTrajectory();
    invalidPrior.config.priorVisits = -1;
    assert.throws(() => validateTrajectory(invalidPrior), /priorVisits/);

    const invalidBias = createEmptyTrajectory();
    invalidBias.config.maxBias = Number.NaN;
    assert.throws(() => validateTrajectory(invalidBias), /maxBias/);
  });

  test('builds deterministic state and edge keys', () => {
    assert.equal(trajectoryEdgeKey(42n, '1:2:3,4'), '42:1:2:3,4');
    assert.equal(trajectoryEdgeKey('42', '1:2:3,4'), '42:1:2:3,4');
    assert.throws(() => trajectoryEdgeKey('-1', 'move'), /positionKey/);
    assert.throws(() => trajectoryEdgeKey(1n, ''), /moveKey/);
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
  });

  test('discounts decisions according to their distance from the game end', () => {
    const trajectory = createEmptyTrajectory();
    trajectory.config.discount = 0.5;
    trajectory.config.priorVisits = 0;
    trajectory.config.maxBias = 100;

    recordCompletedGame(
      trajectory,
      [
        { positionKey: 1n, player: PieceColor.WHITE, moveKey: 'first' },
        { positionKey: 2n, player: PieceColor.BLACK, moveKey: 'second' },
        { positionKey: 3n, player: PieceColor.WHITE, moveKey: 'last' },
      ],
      PieceColor.WHITE,
    );

    assert.equal(trajectory.states['1'].valueSum, 0.25);
    assert.equal(trajectory.states['2'].valueSum, -0.5);
    assert.equal(trajectory.states['3'].valueSum, 1);
    assert.equal(trajectoryBias(trajectory, 1n), 25);
    assert.equal(trajectoryBias(trajectory, 2n), -50);
    assert.equal(trajectoryBias(trajectory, 3n), 100);
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
