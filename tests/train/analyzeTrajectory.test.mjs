import { afterEach, beforeEach, describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  analyzeTrajectoryData,
  analyzeTrajectoryFile,
  formatTrajectoryReport,
  parseAnalyzeArgs,
} from '../../train/analyzeTrajectory.mjs';
import { createEmptyTrajectory } from '../../train/trajectory.mjs';

const stats = ({ visits, wins, losses, draws = 0, valueSum = 0 }) => ({
  visits,
  wins,
  losses,
  draws,
  valueSum,
});

const analysisFixture = () => {
  const trajectory = createEmptyTrajectory();
  trajectory.games = { total: 2, whiteWins: 1, blackWins: 1, draws: 0 };
  trajectory.gameIds = { ['a'.repeat(64)]: true, ['b'.repeat(64)]: true };
  trajectory.states = {
    '10': stats({ visits: 2, wins: 2, losses: 0, valueSum: 2 }),
    '20': stats({ visits: 1, wins: 0, losses: 1, valueSum: -1 }),
  };
  trajectory.edges = {
    '10:bad': stats({ visits: 30, wins: 3, losses: 27, valueSum: -20 }),
    '10:near': stats({ visits: 20, wins: 8, losses: 12, valueSum: -5 }),
    '20:rare': stats({ visits: 1, wins: 0, losses: 1, valueSum: -1 }),
  };
  return trajectory;
};

describe('trajectory analyzer', () => {
  let temporaryDirectory;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'trajectory-analysis-test-'));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  test('parses file, top, JSON, and help options', () => {
    assert.deepEqual(parseAnalyzeArgs(['--trajectory', 'custom.json', '--top', '5', '--json']), {
      trajectoryPath: 'custom.json',
      top: 5,
      json: true,
      help: false,
    });
    assert.equal(parseAnalyzeArgs(['positional.json']).trajectoryPath, 'positional.json');
    assert.equal(parseAnalyzeArgs(['--help']).help, true);
    assert.throws(() => parseAnalyzeArgs(['--top', '0']), /positive/);
    assert.throws(() => parseAnalyzeArgs(['--unknown']), /Unknown/);
    assert.throws(() => parseAnalyzeArgs(['one.json', 'two.json']), /Unexpected/);
  });

  test('summarizes outcomes, coverage, visits, biases, and hard-prune candidates', () => {
    const analysis = analyzeTrajectoryData(analysisFixture(), {
      top: 2,
      trajectoryPath: 'fixture.json',
      bytes: 123,
    });

    assert.equal(analysis.games.total, 2);
    assert.equal(analysis.games.whiteWinRate, 50);
    assert.equal(analysis.games.blackWinRate, 50);
    assert.equal(analysis.games.indexedGameIds, 2);
    assert.equal(analysis.coverage.states, 2);
    assert.equal(analysis.coverage.edges, 3);
    assert.equal(analysis.coverage.edgeVisitBuckets['1'], 1);
    assert.equal(analysis.coverage.edgeVisitBuckets['20-29'], 1);
    assert.equal(analysis.coverage.edgeVisitBuckets['30+'], 1);
    assert.equal(analysis.hardPrune.candidateCount, 1);
    assert.equal(analysis.hardPrune.candidates[0].key, '10:bad');
    assert.equal(analysis.hardPrune.nearCandidates[0].key, '10:near');
    assert.equal(analysis.topStatesByVisits[0].key, '10');
    assert.equal(analysis.strongestStateBiases[0].bias, 40);
  });

  test('formats a readable English report', () => {
    const report = formatTrajectoryReport(
      analyzeTrajectoryData(analysisFixture(), { trajectoryPath: 'fixture.json', bytes: 123 }),
    );

    assert.match(report, /Trajectory Analysis/);
    assert.match(report, /White wins: 1 \(50%\)/);
    assert.match(report, /Edges: 3/);
    assert.match(report, /Candidates: 1/);
    assert.match(report, /10:bad/);
    assert.match(report, /Learned State Biases/);
  });

  test('loads and analyzes a trajectory file with byte metadata', async () => {
    const filePath = path.join(temporaryDirectory, 'trajectory.json');
    const source = JSON.stringify(analysisFixture());
    await writeFile(filePath, source, 'utf8');

    const analysis = await analyzeTrajectoryFile(filePath, { top: 1 });

    assert.equal(analysis.source.path, filePath);
    assert.equal(analysis.source.bytes, Buffer.byteLength(source));
    assert.equal(analysis.topStatesByVisits.length, 1);
    assert.equal(analysis.strongestStateBiases.length, 1);
  });

  test('handles an empty trajectory without division errors', () => {
    const analysis = analyzeTrajectoryData(createEmptyTrajectory());

    assert.equal(analysis.games.whiteWinRate, 0);
    assert.equal(analysis.coverage.averageStateVisits, 0);
    assert.equal(analysis.coverage.averageEdgeVisits, 0);
    assert.equal(analysis.hardPrune.candidateCount, 0);
    assert.match(analysis.conclusions[0], /No games/);
  });
});
