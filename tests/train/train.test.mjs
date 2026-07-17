import { afterEach, beforeEach, describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GameDriver } from '../../cli/GameDriver.mjs';
import { PieceColor } from '../../core/piece.mjs';
import {
  parseTrainingArgs,
  playTrainingGame,
  runTraining,
} from '../../train/train.mjs';
import { createEmptyTrajectory, loadTrajectory } from '../../train/trajectory.mjs';

const execFileAsync = promisify(execFile);

const winningCaptureDriver = (sideToMove) => {
  const whiteToMove = sideToMove === PieceColor.WHITE;
  return new GameDriver({
    sideToMove: whiteToMove ? 'WHITE' : 'BLACK',
    pieces: whiteToMove
      ? [
          ['C3', { color: 'WHITE', type: 'PION' }],
          ['D4', { color: 'BLACK', type: 'PION' }],
        ]
      : [
          ['D6', { color: 'WHITE', type: 'PION' }],
          ['C7', { color: 'BLACK', type: 'PION' }],
        ],
  });
};

describe('self-play trainer', () => {
  let temporaryDirectory;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'thai-trainer-test-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('parses shared depth with per-side overrides independent of flag order', () => {
    const first = parseTrainingArgs([
      '--white-depth',
      '7',
      '--depth',
      '4',
      '--games',
      '3',
      '--max-plies',
      '20',
      '--trajectory',
      'custom.json',
      '--no-board',
    ]);
    const second = parseTrainingArgs(['--depth', '4', '--black-depth', '8']);

    assert.equal(first.whiteDepth, 7);
    assert.equal(first.blackDepth, 4);
    assert.equal(first.games, 3);
    assert.equal(first.maxPlies, 20);
    assert.equal(first.trajectoryPath, 'custom.json');
    assert.equal(first.showBoard, false);
    assert.equal(second.whiteDepth, 4);
    assert.equal(second.blackDepth, 8);
  });

  test('validates CLI values and rejects unknown or incomplete flags', () => {
    assert.throws(() => parseTrainingArgs(['--depth', '0']), /whiteDepth/);
    assert.throws(() => parseTrainingArgs(['--depth', '17']), /whiteDepth/);
    assert.throws(() => parseTrainingArgs(['--games', '1.5']), /integer value/);
    assert.throws(() => parseTrainingArgs(['--max-plies', '0']), /maxPlies/);
    assert.throws(() => parseTrainingArgs(['--trajectory']), /requires a path/);
    assert.throws(() => parseTrainingArgs(['--unknown']), /Unknown training option/);
  });

  test('credits a forced White win to the side that made the recorded decision', () => {
    const trajectory = createEmptyTrajectory();
    const result = playTrainingGame(trajectory, {
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 4,
      createDriver: () => winningCaptureDriver(PieceColor.WHITE),
    });

    assert.equal(result.winner, PieceColor.WHITE);
    assert.equal(result.isDraw, false);
    assert.equal(result.plies, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].player, PieceColor.WHITE);
    assert.equal(trajectory.games.whiteWins, 1);
    assert.equal(Object.values(trajectory.states)[0].wins, 1);
    assert.equal(Object.values(trajectory.edges)[0].wins, 1);
  });

  test('credits a forced Black win to the side that made the recorded decision', () => {
    const trajectory = createEmptyTrajectory();
    const result = playTrainingGame(trajectory, {
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 4,
      createDriver: () => winningCaptureDriver(PieceColor.BLACK),
    });

    assert.equal(result.winner, PieceColor.BLACK);
    assert.equal(result.isDraw, false);
    assert.equal(result.plies, 1);
    assert.equal(result.records[0].player, PieceColor.BLACK);
    assert.equal(trajectory.games.blackWins, 1);
    assert.equal(Object.values(trajectory.states)[0].wins, 1);
  });

  test('treats an unfinished game at maxPlies as a draw', () => {
    const trajectory = createEmptyTrajectory();
    const result = playTrainingGame(trajectory, {
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 1,
    });

    assert.equal(result.winner, null);
    assert.equal(result.isDraw, true);
    assert.equal(result.drawReason, 'max-plies');
    assert.equal(result.records.length, 1);
    assert.equal(trajectory.games.draws, 1);
    assert.equal(Object.values(trajectory.states)[0].draws, 1);
  });

  test('runTraining persists after every completed game', async () => {
    const trajectoryPath = path.join(temporaryDirectory, 'batch', 'trajectory.json');
    const completedGames = [];
    await runTraining({
      games: 2,
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 4,
      trajectoryPath,
      createDriver: () => winningCaptureDriver(PieceColor.WHITE),
      onGameComplete: ({ gameNumber }) => completedGames.push(gameNumber),
    });

    const saved = await loadTrajectory(trajectoryPath);
    assert.equal(saved.games.total, 2);
    assert.equal(saved.games.whiteWins, 2);
    assert.equal(Object.values(saved.states)[0].visits, 2);
    assert.deepEqual(completedGames, [1, 2]);
  });

  test('the executable CLI runs a bounded game and writes its trajectory', async () => {
    const trajectoryPath = path.join(temporaryDirectory, 'cli-trajectory.json');
    await execFileAsync(
      process.execPath,
      [
        path.join(process.cwd(), 'train', 'train.mjs'),
        '--depth',
        '1',
        '--games',
        '1',
        '--max-plies',
        '1',
        '--trajectory',
        trajectoryPath,
        '--no-board',
      ],
      { cwd: process.cwd() },
    );

    const saved = await loadTrajectory(trajectoryPath);
    assert.equal(saved.games.total, 1);
    assert.equal(saved.games.draws, 1);
    assert.equal(Object.keys(saved.states).length, 1);
    assert.equal(Object.keys(saved.edges).length, 1);
  });
});
