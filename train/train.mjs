import { Analyzer, MAX_ANALYSIS_DEPTH } from '../core/Analyzer.mjs';
import { PieceColor, toStringPieceColor } from '../core/piece.mjs';
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';
import { renderBoard } from '../cli/cli.mjs';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  loadTrajectory,
  recordCompletedGame,
  saveTrajectory,
  trajectoryBias,
} from './trajectory.mjs';

export const DEFAULT_TRAINING_CONFIG = Object.freeze({
  games: 1,
  whiteDepth: 6,
  blackDepth: 6,
  maxPlies: 1024,
  trajectoryPath: fileURLToPath(new URL('./trajectory.json', import.meta.url)),
});

export const TRAINING_USAGE = `Usage: node train/train.mjs [options]

Options:
  --depth <1-${MAX_ANALYSIS_DEPTH}>        Search depth for both players (default: 6)
  --white-depth <1-${MAX_ANALYSIS_DEPTH}>  Override White's search depth
  --black-depth <1-${MAX_ANALYSIS_DEPTH}>  Override Black's search depth
  --games <count>       Number of self-play games (default: 1)
  --max-plies <count>   Draw safety cap per game (default: 1024)
  --trajectory <path>   Trajectory JSON path (default: train/trajectory.json)
  --no-board            Do not print the board after every move
  --help                Show this help`;

const assertPositiveInteger = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive safe integer: ${String(value)}`);
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
    else if (flag === '--games') parsed.games = parseIntegerOption(args[++index], flag);
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
  assertPositiveInteger(config.games, 'games');
  assertDepth(config.whiteDepth, 'whiteDepth');
  assertDepth(config.blackDepth, 'blackDepth');
  assertPositiveInteger(config.maxPlies, 'maxPlies');
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
  return config;
};

const depthForPlayer = (config, player) =>
  player === PieceColor.WHITE ? config.whiteDepth : config.blackDepth;

/**
 * Plays and learns from one self-play game. Persistence is owned by runTraining
 * so callers can also use this function with an in-memory trajectory.
 * @param {ReturnType<import('./trajectory.mjs').createEmptyTrajectory>} trajectory
 * @param {object} options
 */
export const playTrainingGame = (trajectory, options = {}) => {
  const config = normalizedTrainingConfig({ ...options, games: 1 });
  const driver = config.createDriver?.() ?? new GameDriver();
  const records = [];
  let ply = 0;

  while (ply < config.maxPlies) {
    const state = driver.getState();
    if (state.isGameOver) break;

    const analyzer = new Analyzer(driver.game, {
      positionBias: (positionKey) => trajectoryBias(trajectory, positionKey),
    });
    const analysis = analyzer.analyze(depthForPlayer(config, state.player));
    if (analysis === null) {
      throw new Error('Analyzer returned no move for a game reported as in progress');
    }

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

  for (let gameNumber = 1; gameNumber <= config.games; gameNumber++) {
    const result = playTrainingGame(trajectory, config);
    await saveTrajectory(config.trajectoryPath, trajectory);
    results.push(result);
    config.onGameComplete?.({ gameNumber, result, trajectory });
  }

  return { trajectory, results };
};

const runFromCommandLine = async () => {
  const config = parseTrainingArgs(process.argv.slice(2));
  if (config.help) {
    console.log(TRAINING_USAGE);
    return;
  }

  console.log(
    `Training ${config.games} game(s): White depth ${config.whiteDepth}, Black depth ${config.blackDepth}`,
  );
  console.log(`Trajectory: ${config.trajectoryPath}`);

  await runTraining({
    ...config,
    onPly: ({ ply, player, move, score, nodeCount, board }) => {
      const captureNote = move.captured.length > 0 ? ` x${move.captured.length}` : '';
      console.log(
        `Ply ${ply}: ${toStringPieceColor(player)} ${move.from} -> ${move.to}${captureNote} [score=${score}, nodes=${nodeCount}]`,
      );
      if (config.showBoard) console.log(renderBoard(board));
    },
    onGameComplete: ({ gameNumber, result }) => {
      const outcome =
        result.winner === null
          ? `draw (${result.drawReason})`
          : `${toStringPieceColor(result.winner)} wins`;
      console.log(`Game ${gameNumber}/${config.games}: ${outcome} in ${result.plies} plies`);
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
