import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PieceColor } from '../core/piece.mjs';

export const TRAJECTORY_VERSION = 1;

export const DEFAULT_TRAJECTORY_CONFIG = Object.freeze({
  discount: 0.97,
  priorVisits: 8,
  maxBias: 200,
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
  config: { ...DEFAULT_TRAJECTORY_CONFIG },
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
  assertFiniteNumber(value.config.discount, 'config.discount');
  if (value.config.discount < 0 || value.config.discount > 1) {
    throw new RangeError('config.discount must be between 0 and 1');
  }
  assertFiniteNumber(value.config.priorVisits, 'config.priorVisits');
  if (value.config.priorVisits < 0) {
    throw new RangeError('config.priorVisits must be non-negative');
  }
  assertFiniteNumber(value.config.maxBias, 'config.maxBias');
  if (value.config.maxBias < 0) {
    throw new RangeError('config.maxBias must be non-negative');
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

const normalizedPositionKey = (positionKey) => {
  if (typeof positionKey === 'bigint') return positionKey.toString();
  if (typeof positionKey === 'string' && /^(0|[1-9]\d*)$/.test(positionKey)) {
    return positionKey;
  }
  throw new TypeError('positionKey must be a non-negative bigint or decimal string');
};

export const trajectoryEdgeKey = (positionKey, moveKey) => {
  if (typeof moveKey !== 'string' || moveKey.length === 0) {
    throw new TypeError('moveKey must be a non-empty string');
  }
  return `${normalizedPositionKey(positionKey)}:${moveKey}`;
};

const updateStats = (stats, outcome, credit) => {
  stats.visits++;
  if (outcome > 0) stats.wins++;
  else if (outcome < 0) stats.losses++;
  else stats.draws++;
  stats.valueSum += credit;
};

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

  trajectory.games.total++;
  if (winner === PieceColor.WHITE) trajectory.games.whiteWins++;
  else if (winner === PieceColor.BLACK) trajectory.games.blackWins++;
  else trajectory.games.draws++;

  normalizedRecords.forEach((record, index) => {
    const outcome = winner === null ? 0 : winner === record.player ? 1 : -1;
    const distanceFromEnd = normalizedRecords.length - index - 1;
    const credit = outcome * trajectory.config.discount ** distanceFromEnd;
    const stateStats = (trajectory.states[record.positionKey] ??= emptyStats());
    const edgeStats = (trajectory.edges[record.edgeKey] ??= emptyStats());
    updateStats(stateStats, outcome, credit);
    updateStats(edgeStats, outcome, credit);
  });
};

/** Returns a bounded score in the side-to-move perspective encoded by positionKey. */
export const trajectoryBias = (trajectory, positionKey) => {
  const stats = trajectory.states[normalizedPositionKey(positionKey)];
  if (stats === undefined) return 0;
  const mean = stats.valueSum / (stats.visits + trajectory.config.priorVisits);
  const bias = mean * trajectory.config.maxBias;
  return Math.max(-trajectory.config.maxBias, Math.min(trajectory.config.maxBias, bias));
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
