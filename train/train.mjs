import { Analyzer, MAX_ANALYSIS_DEPTH } from '../core/Analyzer.mjs';
import { PieceColor, toStringPieceColor } from '../core/piece.mjs';
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';
import { renderBoard } from '../cli/cli.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  loadTrajectory,
  hardPruneMoveIndices,
  recordCompletedGame,
  saveTrajectory,
  trajectoryBias,
} from './trajectory.mjs';

export const DEFAULT_TRAINING_CONFIG = Object.freeze({
  epochs: 1,
  games: 1,
  whiteDepth: 6,
  blackDepth: 6,
  maxPlies: 1024,
  exploration: 0.15,
  explorationDecay: 0.9,
  explorationPlies: 12,
  explorationTop: 3,
  seed: null,
  trajectoryPath: fileURLToPath(new URL('./trajectory.json', import.meta.url)),
});

export const TRAINING_USAGE = `Usage: node train/train.mjs [options]

Options:
  --depth <1-${MAX_ANALYSIS_DEPTH}>        Search depth for both players (default: 6)
  --white-depth <1-${MAX_ANALYSIS_DEPTH}>  Override White's search depth
  --black-depth <1-${MAX_ANALYSIS_DEPTH}>  Override Black's search depth
  --epochs <count>      Number of training rounds (default: 1)
  --games <count>       Games per epoch (default: 1)
  --exploration <0..1>        Initial exploration probability (default: 0.15)
  --exploration-decay <0..1>  Probability multiplier per epoch (default: 0.9)
  --exploration-plies <count> Explore only within these opening plies (default: 12)
  --exploration-top <count>   Rank-weighted candidates to explore (default: 3)
  --seed <integer>      Reproducible unsigned 32-bit random seed
  --max-plies <count>   Draw safety cap per game (default: 1024)
  --trajectory <path>   Trajectory JSON path (default: train/trajectory.json)
  --no-board            Do not print the board after every move
  --help                Show this help`;

const assertPositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer: ${String(value)}`);
  }
};

const assertNonNegativeInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer: ${String(value)}`);
  }
};

const assertProbability = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1: ${String(value)}`);
  }
};

const assertDepth = (depth, label) => {
  if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_ANALYSIS_DEPTH) {
    throw new RangeError(
      `${label} must be an integer between 1 and ${MAX_ANALYSIS_DEPTH}: ${String(depth)}`,
    );
  }
};

const parseIntegerOption = (value, flag) => {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${flag} requires an integer value`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`${flag} is outside the safe range`);
  return parsed;
};

const parseProbabilityOption = (value, flag) => {
  if (value === undefined || value.trim() === '') {
    throw new Error(`${flag} requires a numeric value`);
  }
  const parsed = Number(value);
  assertProbability(parsed, flag);
  return parsed;
};

export const parseTrainingArgs = (args) => {
  if (!Array.isArray(args)) throw new TypeError('Training arguments must be an array');
  let sharedDepth;
  let whiteDepth;
  let blackDepth;
  const parsed = { showBoard: true, help: false };

  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--no-board') parsed.showBoard = false;
    else if (flag === '--help') parsed.help = true;
    else if (flag === '--depth') sharedDepth = parseIntegerOption(args[++index], flag);
    else if (flag === '--white-depth') whiteDepth = parseIntegerOption(args[++index], flag);
    else if (flag === '--black-depth') blackDepth = parseIntegerOption(args[++index], flag);
    else if (flag === '--epochs') parsed.epochs = parseIntegerOption(args[++index], flag);
    else if (flag === '--games') parsed.games = parseIntegerOption(args[++index], flag);
    else if (flag === '--exploration') {
      parsed.exploration = parseProbabilityOption(args[++index], flag);
    } else if (flag === '--exploration-decay') {
      parsed.explorationDecay = parseProbabilityOption(args[++index], flag);
    } else if (flag === '--exploration-plies') {
      parsed.explorationPlies = parseIntegerOption(args[++index], flag);
    } else if (flag === '--exploration-top') {
      parsed.explorationTop = parseIntegerOption(args[++index], flag);
    } else if (flag === '--seed') parsed.seed = parseIntegerOption(args[++index], flag);
    else if (flag === '--max-plies') parsed.maxPlies = parseIntegerOption(args[++index], flag);
    else if (flag === '--trajectory') {
      const trajectoryPath = args[++index];
      if (
        trajectoryPath === undefined ||
        trajectoryPath.length === 0 ||
        trajectoryPath.startsWith('--')
      ) {
        throw new Error('--trajectory requires a path');
      }
      parsed.trajectoryPath = trajectoryPath;
    } else {
      throw new Error(`Unknown training option: ${String(flag)}`);
    }
  }

  if (sharedDepth !== undefined) {
    parsed.whiteDepth = sharedDepth;
    parsed.blackDepth = sharedDepth;
  }
  if (whiteDepth !== undefined) parsed.whiteDepth = whiteDepth;
  if (blackDepth !== undefined) parsed.blackDepth = blackDepth;

  const validated = normalizedTrainingConfig(parsed);
  return { ...validated, showBoard: parsed.showBoard, help: parsed.help };
};

const normalizedTrainingConfig = (options = {}) => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('Training options must be an object');
  }
  const config = { ...DEFAULT_TRAINING_CONFIG, ...options };
  assertPositiveInteger(config.epochs, 'epochs');
  assertPositiveInteger(config.games, 'games');
  assertDepth(config.whiteDepth, 'whiteDepth');
  assertDepth(config.blackDepth, 'blackDepth');
  assertPositiveInteger(config.maxPlies, 'maxPlies');
  assertProbability(config.exploration, 'exploration');
  assertProbability(config.explorationDecay, 'explorationDecay');
  assertNonNegativeInteger(config.explorationPlies, 'explorationPlies');
  assertPositiveInteger(config.explorationTop, 'explorationTop');
  if (config.seed === null) config.seed = Math.floor(Math.random() * 0x1_0000_0000);
  assertNonNegativeInteger(config.seed, 'seed');
  if (config.seed > 0xffff_ffff) throw new RangeError('seed must fit in an unsigned 32-bit integer');
  if (config.explorationRate !== undefined) {
    assertProbability(config.explorationRate, 'explorationRate');
  }
  if (typeof config.trajectoryPath !== 'string' || config.trajectoryPath.length === 0) {
    throw new TypeError('trajectoryPath must be a non-empty path string');
  }
  if (config.createDriver !== undefined && typeof config.createDriver !== 'function') {
    throw new TypeError('createDriver must be a function');
  }
  if (config.onPly !== undefined && typeof config.onPly !== 'function') {
    throw new TypeError('onPly must be a function');
  }
  if (config.onGameComplete !== undefined && typeof config.onGameComplete !== 'function') {
    throw new TypeError('onGameComplete must be a function');
  }
  if (config.random !== undefined && typeof config.random !== 'function') {
    throw new TypeError('random must be a function');
  }
  return config;
};

const depthForPlayer = (config, player) =>
  player === PieceColor.WHITE ? config.whiteDepth : config.blackDepth;

export const createSeededRandom = (seed) => {
  assertNonNegativeInteger(seed, 'seed');
  if (seed > 0xffff_ffff) throw new RangeError('seed must fit in an unsigned 32-bit integer');
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
};

export const selectExplorationCandidate = (candidates, topCount, random) => {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('candidates must be a non-empty array');
  }
  assertPositiveInteger(topCount, 'topCount');
  if (typeof random !== 'function') throw new TypeError('random must be a function');
  const eligible = candidates.slice(0, topCount);
  const totalWeight = (eligible.length * (eligible.length + 1)) / 2;
  const randomValue = random();
  if (typeof randomValue !== 'number' || randomValue < 0 || randomValue >= 1) {
    throw new RangeError('random must return a number from 0 inclusive to 1 exclusive');
  }
  let target = randomValue * totalWeight;
  for (let index = 0; index < eligible.length; index++) {
    target -= eligible.length - index;
    if (target < 0) return { candidate: eligible[index], rank: index };
  }
  return { candidate: eligible.at(-1), rank: eligible.length - 1 };
};

/**
 * Plays and learns from one self-play game. Persistence is owned by runTraining
 * so callers can also use this function with an in-memory trajectory.
 * @param {ReturnType<import('./trajectory.mjs').createEmptyTrajectory>} trajectory
 * @param {object} options
 */
export const playTrainingGame = (trajectory, options = {}) => {
  const config = normalizedTrainingConfig({ ...options, games: 1 });
  const driver = config.createDriver?.() ?? new GameDriver();
  const random = config.random ?? createSeededRandom(config.seed);
  const explorationRate = config.explorationRate ?? config.exploration;
  const records = [];
  let ply = 0;

  while (ply < config.maxPlies) {
    const state = driver.getState();
    if (state.isGameOver) break;

    const analyzer = new Analyzer(driver.game, {
      positionBias: (positionKey) => trajectoryBias(trajectory, positionKey),
      pruneMoves: (positionKey, moves) =>
        hardPruneMoveIndices(trajectory, positionKey, moves, moveKey),
    });
    const candidates = analyzer.analyzeCandidates(depthForPlayer(config, state.player));
    if (candidates.length === 0) {
      throw new Error('Analyzer returned no move for a game reported as in progress');
    }
    const shouldExplore =
      ply < config.explorationPlies && candidates.length > 1 && random() < explorationRate;
    const selection = shouldExplore
      ? selectExplorationCandidate(candidates, config.explorationTop, random)
      : { candidate: candidates[0], rank: 0 };
    const analysis = selection.candidate;

    const selectedMoveKey = moveKey(analysis.move);
    const moveIndex = state.moves.findIndex((move) => moveKey(move) === selectedMoveKey);
    if (moveIndex === -1) {
      throw new Error(`Analyzer selected a move absent from the live game: ${selectedMoveKey}`);
    }

    records.push({
      positionKey: driver.game.positionKey(),
      player: state.player,
      moveKey: selectedMoveKey,
    });
    driver.playMoveIndex(moveIndex);
    ply++;
    config.onPly?.({
      ply,
      player: state.player,
      move: analysis.move,
      score: analysis.score,
      nodeCount: analyzer.nodeCount,
      board: driver.game.board(),
      explored: shouldExplore,
      candidateRank: selection.rank,
      explorationRate,
    });
  }

  const finalState = driver.getState();
  const reachedPlyLimit = !finalState.isGameOver && ply >= config.maxPlies;
  const winner = finalState.isGameOver ? finalState.winner : null;
  const experience = recordCompletedGame(trajectory, records, winner);

  return {
    winner,
    isDraw: reachedPlyLimit,
    drawReason: reachedPlyLimit ? 'max-plies' : null,
    plies: ply,
    records,
    experienceRecorded: experience.recorded,
    gameId: experience.gameId,
    finalState,
  };
};

/**
 * Runs a batch, saving atomically after every completed game so interrupted
 * training loses at most the game currently in progress.
 */
export const runTraining = async (options = {}) => {
  const config = normalizedTrainingConfig(options);
  const trajectory = await loadTrajectory(config.trajectoryPath);
  const results = [];
  const random = config.random ?? createSeededRandom(config.seed);

  for (let epochNumber = 1; epochNumber <= config.epochs; epochNumber++) {
    const explorationRate = config.exploration * config.explorationDecay ** (epochNumber - 1);
    for (let gameNumber = 1; gameNumber <= config.games; gameNumber++) {
      const result = playTrainingGame(trajectory, { ...config, explorationRate, random });
      await saveTrajectory(config.trajectoryPath, trajectory);
      results.push(result);
      config.onGameComplete?.({
        epochNumber,
        gameNumber,
        explorationRate,
        result,
        trajectory,
      });
    }
  }

  return { trajectory, results, seed: config.seed };
};

const runFromCommandLine = async () => {
  const config = parseTrainingArgs(process.argv.slice(2));
  if (config.help) {
    console.log(TRAINING_USAGE);
    return;
  }

  console.log(
    `Training ${config.epochs} epoch(s) x ${config.games} game(s): White depth ${config.whiteDepth}, Black depth ${config.blackDepth}`,
  );
  console.log(`Exploration: ${config.exploration} x ${config.explorationDecay}/epoch, seed ${config.seed}`);
  console.log(`Trajectory: ${config.trajectoryPath}`);

  await runTraining({
    ...config,
    onPly: ({ ply, player, move, score, nodeCount, board, explored, candidateRank }) => {
      const captureNote = move.captured.length > 0 ? ` x${move.captured.length}` : '';
      const explorationNote = explored ? `, explored=rank${candidateRank + 1}` : '';
      console.log(
        `Ply ${ply}: ${toStringPieceColor(player)} ${move.from} -> ${move.to}${captureNote} [score=${score}, nodes=${nodeCount}${explorationNote}]`,
      );
      if (config.showBoard) console.log(renderBoard(board));
    },
    onGameComplete: ({ epochNumber, gameNumber, explorationRate, result }) => {
      const outcome =
        result.winner === null
          ? `draw (${result.drawReason})`
          : `${toStringPieceColor(result.winner)} wins`;
      console.log(
        `Epoch ${epochNumber}/${config.epochs}, game ${gameNumber}/${config.games} (exploration=${explorationRate.toFixed(4)}): ${outcome} in ${result.plies} plies`,
      );
    },
  });
};

const isMainModule =
  process.argv[1] !== undefined &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);

if (isMainModule) {
  runFromCommandLine().catch((error) => {
    console.error(`Training failed: ${error.message}`);
    process.exitCode = 1;
  });
}
