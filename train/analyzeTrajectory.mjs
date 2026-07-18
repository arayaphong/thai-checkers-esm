import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { trajectoryBias, validateTrajectory } from './trajectory.mjs';

const DEFAULT_PATH = fileURLToPath(new URL('./trajectory.json', import.meta.url));

export const ANALYZE_USAGE = `Usage: node train/analyzeTrajectory.mjs [options] [file]

Options:
  --trajectory <path>  Trajectory file to analyze (default: train/trajectory.json)
  --top <count>        Number of strongest/most-visited entries to show (default: 10)
  --json               Print the analysis as JSON
  --help               Show this help`;

const parsePositiveInteger = (value, flag) => {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires an integer value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new RangeError(`${flag} must be a positive safe integer`);
  }
  return parsed;
};

export const parseAnalyzeArgs = (args) => {
  if (!Array.isArray(args)) throw new TypeError('Analysis arguments must be an array');
  const options = { trajectoryPath: DEFAULT_PATH, top: 10, json: false, help: false };
  let positionalPath;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--top') options.top = parsePositiveInteger(args[++index], argument);
    else if (argument === '--trajectory') {
      const value = args[++index];
      if (value === undefined || value.length === 0 || value.startsWith('--')) {
        throw new Error('--trajectory requires a path');
      }
      options.trajectoryPath = value;
    } else if (argument.startsWith('--')) {
      throw new Error(`Unknown analysis option: ${argument}`);
    } else if (positionalPath === undefined) positionalPath = argument;
    else throw new Error(`Unexpected positional argument: ${argument}`);
  }

  if (positionalPath !== undefined) options.trajectoryPath = positionalPath;
  return options;
};

const percentage = (part, total) => (total === 0 ? 0 : (part / total) * 100);

const visitBucket = (visits) => {
  if (visits === 1) return '1';
  if (visits <= 4) return '2-4';
  if (visits <= 9) return '5-9';
  if (visits <= 19) return '10-19';
  if (visits <= 29) return '20-29';
  return '30+';
};

const summarizeStats = (key, stats, bias) => ({
  key,
  visits: stats.visits,
  wins: stats.wins,
  losses: stats.losses,
  draws: stats.draws,
  lossRate: percentage(stats.losses, stats.visits),
  valueSum: stats.valueSum,
  ...(bias === undefined ? {} : { bias }),
});

export const analyzeTrajectoryData = (trajectory, options = {}) => {
  validateTrajectory(trajectory);
  const top = options.top ?? 10;
  const stateEntries = Object.entries(trajectory.states);
  const edgeEntries = Object.entries(trajectory.edges);
  const stateVisits = stateEntries.map(([, stats]) => stats.visits);
  const edgeVisits = edgeEntries.map(([, stats]) => stats.visits);
  const totalStateVisits = stateVisits.reduce((sum, visits) => sum + visits, 0);
  const totalEdgeVisits = edgeVisits.reduce((sum, visits) => sum + visits, 0);
  const edgeVisitBuckets = {
    '1': 0,
    '2-4': 0,
    '5-9': 0,
    '10-19': 0,
    '20-29': 0,
    '30+': 0,
  };
  edgeVisits.forEach((visits) => edgeVisitBuckets[visitBucket(visits)]++);

  const policy = trajectory.config.hardPrune;
  const hardPruneCandidates = edgeEntries
    .filter(([, stats]) =>
      stats.visits >= policy.minVisits &&
      stats.losses >= policy.minLosses &&
      stats.losses / stats.visits >= policy.minLossRate,
    )
    .map(([key, stats]) => summarizeStats(key, stats));
  const hardPruneCandidateKeys = new Set(hardPruneCandidates.map(({ key }) => key));

  const nearHardPrune = edgeEntries
    .filter(([, stats]) => stats.visits >= Math.min(10, policy.minVisits))
    .filter(([key]) => !hardPruneCandidateKeys.has(key))
    .sort(
      ([, left], [, right]) =>
        right.losses / right.visits - left.losses / left.visits ||
        right.visits - left.visits,
    )
    .slice(0, top)
    .map(([key, stats]) => summarizeStats(key, stats));

  const topStatesByVisits = [...stateEntries]
    .sort(([, left], [, right]) => right.visits - left.visits)
    .slice(0, top)
    .map(([key, stats]) => summarizeStats(key, stats, trajectoryBias(trajectory, key)));

  const strongestStateBiases = stateEntries
    .map(([key, stats]) => ({ key, stats, bias: trajectoryBias(trajectory, key) }))
    .sort((left, right) => Math.abs(right.bias) - Math.abs(left.bias))
    .slice(0, top)
    .map(({ key, stats, bias }) => summarizeStats(key, stats, bias));

  const singletonEdges = edgeVisitBuckets['1'];
  const conclusions = [];
  if (trajectory.games.total === 0) conclusions.push('No games have been recorded yet.');
  else {
    const indexedGames = Object.keys(trajectory.gameIds).length;
    conclusions.push(
      indexedGames === trajectory.games.total
        ? 'Every recorded game has a fingerprint for duplicate prevention.'
        : 'Some legacy game statistics do not have retrospective fingerprints.',
    );
    if (edgeEntries.length > 0 && singletonEdges / edgeEntries.length >= 0.75) {
      conclusions.push('Edge coverage is broad, but most edges still have only one observation.');
    }
    conclusions.push(
      hardPruneCandidates.length === 0
        ? 'No edges currently meet the hard-prune threshold.'
        : `${hardPruneCandidates.length} ${hardPruneCandidates.length === 1 ? 'edge' : 'edges'} currently ${hardPruneCandidates.length === 1 ? 'qualifies' : 'qualify'} for hard-pruning.`,
    );
  }

  return {
    source: {
      path: options.trajectoryPath ?? null,
      bytes: options.bytes ?? null,
      version: trajectory.version,
    },
    config: trajectory.config,
    games: {
      ...trajectory.games,
      whiteWinRate: percentage(trajectory.games.whiteWins, trajectory.games.total),
      blackWinRate: percentage(trajectory.games.blackWins, trajectory.games.total),
      drawRate: percentage(trajectory.games.draws, trajectory.games.total),
      indexedGameIds: Object.keys(trajectory.gameIds).length,
    },
    coverage: {
      states: stateEntries.length,
      edges: edgeEntries.length,
      totalStateVisits,
      totalEdgeVisits,
      averageStateVisits: stateEntries.length === 0 ? 0 : totalStateVisits / stateEntries.length,
      averageEdgeVisits: edgeEntries.length === 0 ? 0 : totalEdgeVisits / edgeEntries.length,
      maxStateVisits: stateVisits.reduce((maximum, visits) => Math.max(maximum, visits), 0),
      maxEdgeVisits: edgeVisits.reduce((maximum, visits) => Math.max(maximum, visits), 0),
      edgeVisitBuckets,
    },
    hardPrune: {
      policy,
      candidateCount: hardPruneCandidates.length,
      candidates: hardPruneCandidates.slice(0, top),
      nearCandidates: nearHardPrune,
    },
    topStatesByVisits,
    strongestStateBiases,
    conclusions,
  };
};

const number = (value, digits = 2) =>
  new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value);

const formatEntries = (entries, includeBias) =>
  entries.length === 0
    ? '  (none)'
    : entries
        .map(
          (entry, index) =>
            `  ${index + 1}. ${entry.key}\n` +
            `     visits=${entry.visits}, W/L/D=${entry.wins}/${entry.losses}/${entry.draws}, loss=${number(entry.lossRate)}%` +
            (includeBias ? `, bias=${number(entry.bias, 4)}` : ''),
        )
        .join('\n');

export const formatTrajectoryReport = (analysis) => {
  const { games, coverage, hardPrune } = analysis;
  return [
    '=== Trajectory Analysis ===',
    `File: ${analysis.source.path ?? '(in-memory)'}`,
    `Size: ${analysis.source.bytes === null ? 'unknown' : `${number(analysis.source.bytes, 0)} bytes`}`,
    `Schema version: ${analysis.source.version}`,
    '',
    'Games',
    `  Total: ${games.total}`,
    `  White wins: ${games.whiteWins} (${number(games.whiteWinRate)}%)`,
    `  Black wins: ${games.blackWins} (${number(games.blackWinRate)}%)`,
    `  Draws: ${games.draws} (${number(games.drawRate)}%)`,
    `  Game IDs: ${games.indexedGameIds}`,
    '',
    'Coverage',
    `  States: ${number(coverage.states, 0)}`,
    `  Edges: ${number(coverage.edges, 0)}`,
    `  Average state visits: ${number(coverage.averageStateVisits)}`,
    `  Average edge visits: ${number(coverage.averageEdgeVisits)}`,
    `  Max state visits: ${coverage.maxStateVisits}`,
    `  Max edge visits: ${coverage.maxEdgeVisits}`,
    `  Edge visit buckets: 1=${coverage.edgeVisitBuckets['1']}, 2-4=${coverage.edgeVisitBuckets['2-4']}, 5-9=${coverage.edgeVisitBuckets['5-9']}, 10-19=${coverage.edgeVisitBuckets['10-19']}, 20-29=${coverage.edgeVisitBuckets['20-29']}, 30+=${coverage.edgeVisitBuckets['30+']}`,
    '',
    'Hard-prune',
    `  Threshold: visits>=${hardPrune.policy.minVisits}, losses>=${hardPrune.policy.minLosses}, lossRate>=${number(hardPrune.policy.minLossRate * 100)}%`,
    `  Candidates: ${hardPrune.candidateCount}`,
    formatEntries(hardPrune.candidates, false),
    '',
    'Edges Near the Threshold or with High Loss Rates',
    formatEntries(hardPrune.nearCandidates, false),
    '',
    'Most Visited States',
    formatEntries(analysis.topStatesByVisits, true),
    '',
    'Strongest Learned State Biases',
    formatEntries(analysis.strongestStateBiases, true),
    '',
    'Conclusions',
    ...analysis.conclusions.map((conclusion) => `  - ${conclusion}`),
  ].join('\n');
};

export const analyzeTrajectoryFile = async (trajectoryPath, options = {}) => {
  const source = await readFile(trajectoryPath, 'utf8');
  const trajectory = validateTrajectory(JSON.parse(source));
  return analyzeTrajectoryData(trajectory, {
    ...options,
    trajectoryPath,
    bytes: Buffer.byteLength(source),
  });
};

const runFromCommandLine = async () => {
  const options = parseAnalyzeArgs(process.argv.slice(2));
  if (options.help) {
    console.log(ANALYZE_USAGE);
    return;
  }
  const analysis = await analyzeTrajectoryFile(options.trajectoryPath, options);
  console.log(options.json ? JSON.stringify(analysis, null, 2) : formatTrajectoryReport(analysis));
};

const isMainModule =
  process.argv[1] !== undefined &&
  (await realpath(fileURLToPath(import.meta.url))) === (await realpath(path.resolve(process.argv[1])));

if (isMainModule) {
  runFromCommandLine().catch((error) => {
    console.error(`Trajectory analysis failed: ${error.message}`);
    process.exitCode = 1;
  });
}
