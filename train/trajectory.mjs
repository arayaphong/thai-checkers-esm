import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PieceColor } from '../core/piece.mjs';
import {
  hardPruneMoveIndices,
  normalizedTrajectoryPositionKey as normalizedPositionKey,
  trajectoryBias,
  trajectoryEdgeKey,
} from '../core/trajectoryPolicy.mjs';

export { hardPruneMoveIndices, trajectoryBias, trajectoryEdgeKey };

export const TRAJECTORY_VERSION = 1;

export const DEFAULT_TRAJECTORY_CONFIG = Object.freeze({
  creditCurve: 'logarithmic',
  priorVisits: 8,
  maxBias: 200,
  hardPrune: Object.freeze({
    minVisits: 30,
    minLosses: 27,
    minLossRate: 0.9,
  }),
});

const emptyStats = () => ({
  visits: 0,
  wins: 0,
  losses: 0,
  draws: 0,
  valueSum: 0,
});

export const createEmptyTrajectory = () => ({
  version: TRAJECTORY_VERSION,
  games: {
    total: 0,
    whiteWins: 0,
    blackWins: 0,
    draws: 0,
  },
  config: {
    ...DEFAULT_TRAJECTORY_CONFIG,
    hardPrune: { ...DEFAULT_TRAJECTORY_CONFIG.hardPrune },
  },
  gameIds: {},
  states: {},
  edges: {},
});

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertNonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`);
  }
};

const assertFiniteNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number`);
  }
};

const assertStats = (stats, label) => {
  if (!isRecord(stats)) throw new TypeError(`${label} must be an object`);
  for (const field of ['visits', 'wins', 'losses', 'draws']) {
    assertNonNegativeInteger(stats[field], `${label}.${field}`);
  }
  if (stats.wins + stats.losses + stats.draws !== stats.visits) {
    throw new TypeError(`${label} outcome counts must add up to visits`);
  }
  assertFiniteNumber(stats.valueSum, `${label}.valueSum`);
};

/**
 * Validates a parsed trajectory document and returns it unchanged.
 * Unknown fields are retained so later schema additions remain readable.
 * @param {unknown} value
 * @returns {ReturnType<typeof createEmptyTrajectory>}
 */
export const validateTrajectory = (value) => {
  if (!isRecord(value)) throw new TypeError('Trajectory must be an object');
  if (value.version !== TRAJECTORY_VERSION) {
    throw new Error(`Unsupported trajectory version: ${String(value.version)}`);
  }

  if (!isRecord(value.games)) throw new TypeError('Trajectory games must be an object');
  for (const field of ['total', 'whiteWins', 'blackWins', 'draws']) {
    assertNonNegativeInteger(value.games[field], `games.${field}`);
  }
  if (value.games.whiteWins + value.games.blackWins + value.games.draws !== value.games.total) {
    throw new TypeError('Game outcome counts must add up to games.total');
  }

  if (!isRecord(value.config)) throw new TypeError('Trajectory config must be an object');
  if (value.config.creditCurve !== 'logarithmic') {
    throw new TypeError('config.creditCurve must be "logarithmic"');
  }
  assertFiniteNumber(value.config.priorVisits, 'config.priorVisits');
  if (value.config.priorVisits < 0) {
    throw new RangeError('config.priorVisits must be non-negative');
  }
  assertFiniteNumber(value.config.maxBias, 'config.maxBias');
  if (value.config.maxBias < 0) {
    throw new RangeError('config.maxBias must be non-negative');
  }
  value.config.hardPrune ??= { ...DEFAULT_TRAJECTORY_CONFIG.hardPrune };
  if (!isRecord(value.config.hardPrune)) {
    throw new TypeError('config.hardPrune must be an object');
  }
  assertNonNegativeInteger(value.config.hardPrune.minVisits, 'config.hardPrune.minVisits');
  assertNonNegativeInteger(value.config.hardPrune.minLosses, 'config.hardPrune.minLosses');
  assertFiniteNumber(value.config.hardPrune.minLossRate, 'config.hardPrune.minLossRate');
  if (value.config.hardPrune.minLossRate < 0 || value.config.hardPrune.minLossRate > 1) {
    throw new RangeError('config.hardPrune.minLossRate must be between 0 and 1');
  }

  // Files created before game-level deduplication have no IDs to migrate.
  // Start tracking from their next recorded game without discarding statistics.
  value.gameIds ??= {};
  if (!isRecord(value.gameIds)) throw new TypeError('Trajectory gameIds must be an object');
  for (const [gameId, recorded] of Object.entries(value.gameIds)) {
    if (!/^[a-f0-9]{64}$/.test(gameId) || recorded !== true) {
      throw new TypeError('Trajectory gameIds must map SHA-256 hashes to true');
    }
  }

  for (const collectionName of ['states', 'edges']) {
    const collection = value[collectionName];
    if (!isRecord(collection)) {
      throw new TypeError(`Trajectory ${collectionName} must be an object`);
    }
    for (const [key, stats] of Object.entries(collection)) {
      if (key.length === 0) throw new TypeError(`${collectionName} keys must not be empty`);
      assertStats(stats, `${collectionName}.${key}`);
    }
  }

  return value;
};

const updateStats = (stats, outcome, credit) => {
  stats.visits++;
  if (outcome > 0) stats.wins++;
  else if (outcome < 0) stats.losses++;
  else stats.draws++;
  stats.valueSum += credit;
};

/**
 * Returns a normalized logarithmic weight for a decision's position in a game.
 * The first of multiple decisions has weight 0 and the last has weight 1. A
 * single decision receives weight 1 because it is both the first and deciding move.
 */
export const logarithmicCreditWeight = (index, totalDecisions) => {
  if (!Number.isSafeInteger(totalDecisions) || totalDecisions < 1) {
    throw new RangeError('totalDecisions must be a positive safe integer');
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= totalDecisions) {
    throw new RangeError('index must identify a decision within totalDecisions');
  }
  return totalDecisions === 1 ? 1 : Math.log1p(index) / Math.log(totalDecisions);
};

const completedGameId = (records, winner) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        winner,
        records.map(({ positionKey, player, edgeKey }) => [positionKey, player, edgeKey]),
      ]),
    )
    .digest('hex');

/**
 * Aggregates one completed game's decisions into state and edge statistics.
 * Each record is evaluated from the perspective of the player who made it.
 * @param {ReturnType<typeof createEmptyTrajectory>} trajectory
 * @param {{positionKey: bigint|string, player: number, moveKey: string}[]} records
 * @param {number|null} winner PieceColor, or null for a draw.
 */
export const recordCompletedGame = (trajectory, records, winner) => {
  validateTrajectory(trajectory);
  if (!Array.isArray(records)) throw new TypeError('records must be an array');
  if (winner !== null && winner !== PieceColor.WHITE && winner !== PieceColor.BLACK) {
    throw new TypeError('winner must be PieceColor.WHITE, PieceColor.BLACK, or null');
  }

  const normalizedRecords = records.map((record, index) => {
    if (!isRecord(record)) throw new TypeError(`records[${index}] must be an object`);
    if (record.player !== PieceColor.WHITE && record.player !== PieceColor.BLACK) {
      throw new TypeError(`records[${index}].player must be a PieceColor`);
    }
    const positionKey = normalizedPositionKey(record.positionKey);
    return {
      positionKey,
      player: record.player,
      edgeKey: trajectoryEdgeKey(positionKey, record.moveKey),
    };
  });

  const gameId = completedGameId(normalizedRecords, winner);
  if (trajectory.gameIds[gameId] === true) return { recorded: false, gameId };
  trajectory.gameIds[gameId] = true;

  trajectory.games.total++;
  if (winner === PieceColor.WHITE) trajectory.games.whiteWins++;
  else if (winner === PieceColor.BLACK) trajectory.games.blackWins++;
  else trajectory.games.draws++;

  normalizedRecords.forEach((record, index) => {
    const outcome = winner === null ? 0 : winner === record.player ? 1 : -1;
    const credit = outcome * logarithmicCreditWeight(index, normalizedRecords.length);
    const stateStats = (trajectory.states[record.positionKey] ??= emptyStats());
    const edgeStats = (trajectory.edges[record.edgeKey] ??= emptyStats());
    updateStats(stateStats, outcome, credit);
    updateStats(edgeStats, outcome, credit);
  });

  return { recorded: true, gameId };
};

export const loadTrajectory = async (filePath) => {
  try {
    const source = await readFile(filePath, 'utf8');
    return validateTrajectory(JSON.parse(source));
  } catch (error) {
    if (error?.code === 'ENOENT') return createEmptyTrajectory();
    if (error instanceof SyntaxError) {
      throw new SyntaxError(`Invalid trajectory JSON in ${filePath}: ${error.message}`);
    }
    throw error;
  }
};

/** Writes through a sibling temporary file, then atomically replaces the destination. */
export const saveTrajectory = async (filePath, trajectory) => {
  validateTrajectory(trajectory);
  const directory = path.dirname(filePath);
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporaryPath, `${JSON.stringify(trajectory)}\n`, 'utf8');
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch((cleanupError) => {
      if (cleanupError?.code !== 'ENOENT') throw cleanupError;
    });
    throw error;
  }
};
