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
  createSeededRandom,
  parseTrainingArgs,
  playTrainingGame,
  runTraining,
  selectExplorationCandidate,
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
      '--epochs',
      '4',
      '--exploration',
      '0.25',
      '--exploration-decay',
      '0.8',
      '--exploration-plies',
      '10',
      '--exploration-top',
      '2',
      '--seed',
      '123',
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
    assert.equal(first.epochs, 4);
    assert.equal(first.exploration, 0.25);
    assert.equal(first.explorationDecay, 0.8);
    assert.equal(first.explorationPlies, 10);
    assert.equal(first.explorationTop, 2);
    assert.equal(first.seed, 123);
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
    assert.throws(() => parseTrainingArgs(['--epochs', '0']), /epochs/);
    assert.throws(() => parseTrainingArgs(['--exploration', '1.1']), /between 0 and 1/);
    assert.throws(() => parseTrainingArgs(['--exploration-decay', '-1']), /between 0 and 1/);
    assert.throws(() => parseTrainingArgs(['--exploration-top', '0']), /explorationTop/);
    assert.throws(() => parseTrainingArgs(['--seed', '4294967296']), /unsigned 32-bit/);
    assert.throws(() => parseTrainingArgs(['--trajectory']), /requires a path/);
    assert.throws(() => parseTrainingArgs(['--unknown']), /Unknown training option/);
  });

  test('seeded random generation is deterministic and bounded', () => {
    const first = createSeededRandom(123);
    const second = createSeededRandom(123);
    const firstValues = Array.from({ length: 5 }, () => first());
    const secondValues = Array.from({ length: 5 }, () => second());

    assert.deepEqual(firstValues, secondValues);
    assert.equal(firstValues.every((value) => value >= 0 && value < 1), true);
    assert.equal(new Set(firstValues).size > 1, true);
  });

  test('exploration selects only within top-N using rank weights', () => {
    const candidates = ['first', 'second', 'third', 'excluded'];

    assert.deepEqual(selectExplorationCandidate(candidates, 3, () => 0), {
      candidate: 'first',
      rank: 0,
    });
    assert.deepEqual(selectExplorationCandidate(candidates, 3, () => 0.99), {
      candidate: 'third',
      rank: 2,
    });
    assert.throws(() => selectExplorationCandidate(candidates, 3, () => 1), /random/);
  });

  test('opening exploration can choose a non-best ranked candidate', () => {
    const trajectory = createEmptyTrajectory();
    const randomValues = [0, 0.99];
    const plies = [];
    const result = playTrainingGame(trajectory, {
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 1,
      exploration: 1,
      explorationPlies: 1,
      explorationTop: 3,
      random: () => randomValues.shift(),
      onPly: (event) => plies.push(event),
    });

    assert.equal(result.plies, 1);
    assert.equal(plies[0].explored, true);
    assert.equal(plies[0].candidateRank, 2);
    assert.equal(plies[0].explorationRate, 1);
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
    assert.equal(result.experienceRecorded, true);
    assert.match(result.gameId, /^[a-f0-9]{64}$/);
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
    let createdGames = 0;
    await runTraining({
      games: 2,
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 4,
      trajectoryPath,
      createDriver: () =>
        winningCaptureDriver(createdGames++ === 0 ? PieceColor.WHITE : PieceColor.BLACK),
      onGameComplete: ({ gameNumber }) => completedGames.push(gameNumber),
    });

    const saved = await loadTrajectory(trajectoryPath);
    assert.equal(saved.games.total, 2);
    assert.equal(saved.games.whiteWins, 1);
    assert.equal(saved.games.blackWins, 1);
    assert.equal(Object.keys(saved.gameIds).length, 2);
    assert.deepEqual(completedGames, [1, 2]);
  });

  test('runTraining skips duplicate games across a persisted batch', async () => {
    const trajectoryPath = path.join(temporaryDirectory, 'deduplicated.json');
    const output = await runTraining({
      games: 2,
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 4,
      trajectoryPath,
      createDriver: () => winningCaptureDriver(PieceColor.WHITE),
    });

    const saved = await loadTrajectory(trajectoryPath);
    assert.equal(output.results[0].experienceRecorded, true);
    assert.equal(output.results[1].experienceRecorded, false);
    assert.equal(output.results[1].gameId, output.results[0].gameId);
    assert.equal(saved.games.total, 1);
    assert.equal(saved.games.whiteWins, 1);
    assert.equal(Object.keys(saved.gameIds).length, 1);
  });

  test('runTraining decays exploration once per epoch', async () => {
    const trajectoryPath = path.join(temporaryDirectory, 'epochs.json');
    const rates = [];
    const output = await runTraining({
      epochs: 3,
      games: 1,
      whiteDepth: 1,
      blackDepth: 1,
      maxPlies: 1,
      exploration: 0.4,
      explorationDecay: 0.5,
      explorationPlies: 0,
      seed: 99,
      trajectoryPath,
      onGameComplete: ({ epochNumber, explorationRate }) => {
        rates.push([epochNumber, explorationRate]);
      },
    });

    assert.deepEqual(rates, [
      [1, 0.4],
      [2, 0.2],
      [3, 0.1],
    ]);
    assert.equal(output.results.length, 3);
    assert.equal(output.seed, 99);
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
