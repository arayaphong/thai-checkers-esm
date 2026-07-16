// Thai Checkers CLI — Node-only REPL command layer.
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import process from 'node:process';
import { Position } from '../core/Position.mjs';
import { PieceColor, pieceSymbol } from '../core/piece.mjs';
import {
  GameDriver,
  moveKey,
  isOneDameEachDraw,
  moveRecordMatches,
  parsePieces,
  parseSideToMove,
  SaveIncompatibilityError,
  AmbiguousMoveError,
} from './GameDriver.mjs';
import { WsGameDriver, wsPortUrl } from '../controller/WsGameDriver.mjs';

export {
  GameDriver,
  moveKey,
  isOneDameEachDraw,
  moveRecordMatches,
  parsePieces,
  parseSideToMove,
  SaveIncompatibilityError,
  AmbiguousMoveError,
};

// ─────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────

// '.' marks a non-playable (light) square; a blank marks an empty playable
// (dark) square; a piece glyph marks an occupied one.
// Row 8 is printed first (top) through row 1 (bottom), matching the
// standard algebraic notation where Black starts at the top (rows 7-8)
// and White starts at the bottom (rows 1-2).
export const renderBoard = (board) => {
  const pieceAt = (x, y) => {
    const pos = Position.fromCoords(x, y);
    return board.isOccupied(pos)
      ? pieceSymbol(board.isBlackPiece(pos), board.isDamePiece(pos))
      : ' ';
  };

  const cell = (x, y) => (Position.isValid(x, y) ? pieceAt(x, y) : '.');

  // Print from y=7 (row 8) down to y=0 (row 1)
  const cells = (_, i) => {
    const y = 7 - i;
    return `${y + 1} ${Array.from({ length: 8 }, (_, x) => cell(x, y)).join(' ')}`;
  };

  const rows = Array.from({ length: 8 }, cells);
  return ['  A B C D E F G H', ...rows].join('\n');
};

// Promotion row for a color: White promotes on y=7 (row 8), Black on y=0 (row 1).
const promotionRowOf = (color) => (color === PieceColor.WHITE ? 7 : 0);

// True when the moving piece is not already a dame and the landing square is
// that color's promotion row.
const isPromotion = (board, move) => {
  const movingIsDame = board.isDamePiece(move.from);
  if (movingIsDame) {
    return false;
  }
  const movingIsBlack = board.isBlackPiece(move.from);
  const color = movingIsBlack ? PieceColor.BLACK : PieceColor.WHITE;
  return move.to.y === promotionRowOf(color);
};

// Format a single move for display: full path, captures prefixed with x, and a
// promotion marker * on the final landing square.
// Example: `D5 -> B3 -> D1* (x C4 x C2)`
export const formatMove = (move, board) => {
  const path = move.path && move.path.length > 0 ? move.path : [move.from, move.to];
  const promo = isPromotion(board, move) ? '*' : '';
  const route = path.map((pos) => pos.toString()).join(' -> ');
  const captures =
    move.captured.length === 0
      ? ''
      : ` (${move.captured.map((pos) => `x${pos.toString()}`).join(' ')})`;
  return `${route}${promo}${captures}`;
};

// Format the candidate-route list shown when a coordinate command is ambiguous.
// Each candidate is a one-based local choice among the endpoint-matching routes.
export const formatCandidateRoutes = (candidates, board) =>
  candidates.map(({ choice, move }) => `  ${choice}) ${formatMove(move, board)}`).join('\n');

// ─────────────────────────────────────────────────────────────────────────
// REPL command layer (Node-only)
// ─────────────────────────────────────────────────────────────────────────

const COLOR_LABEL = new Map([
  [PieceColor.WHITE, 'WHITE'],
  [PieceColor.BLACK, 'BLACK'],
]);

const HELP_LINE =
  'Commands: <n> (move by number) | <from> <to> [choice] (move by square) | ' +
  'ai [depth] | undo | redo | history | save <file> | load <file> | exit | quit';

// Print the current state: player, board, move list, and game-over status.
const printState = (driver) => {
  const state = driver.getState();
  const colorName = COLOR_LABEL.get(state.player);
  console.log(`\nPlayer to move: ${colorName}`);
  console.log(renderBoard(state.board));

  if (state.isGameOver) {
    if (state.isDraw) {
      console.log('Game over: forced draw (ONE_DAME_EACH).');
    } else {
      const winnerName = COLOR_LABEL.get(state.winner);
      console.log(`Game over: ${winnerName} wins.`);
    }
    return;
  }

  const moves = state.moves;
  console.log('Moves:');
  moves.forEach((move, i) => {
    console.log(`[${i + 1}] ${formatMove(move, state.board)}`);
  });
};

const printHistory = (driver) => {
  const played = driver.history();
  if (played.length === 0) {
    console.log('No moves played yet.');
    return;
  }
  const currentIndex = driver.toJSON().currentIndex;
  const board = driver.getState().board;
  played.forEach((move, i) => {
    const marker = i + 1 === currentIndex ? '*' : ' ';
    console.log(`${marker} ${i + 1}. ${formatMove(move, board)}`);
  });
};

// Parse a single input line into a command descriptor.
const parseCommand = (line) => {
  const tokens = line
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) {
    return { kind: 'noop' };
  }
  const head = tokens[0].toLowerCase();
  if (head === 'exit' || head === 'quit') {
    return { kind: 'exit' };
  }
  if (head === 'undo') {
    return { kind: 'undo' };
  }
  if (head === 'redo') {
    return { kind: 'redo' };
  }
  if (head === 'history') {
    return { kind: 'history' };
  }
  if (head === 'ai') {
    const depth = tokens[1] !== undefined ? Number(tokens[1]) : 6;
    return { kind: 'ai', depth };
  }
  if (head === 'save') {
    if (tokens[1] === undefined) {
      return { kind: 'error', message: 'save requires a file path' };
    }
    return { kind: 'save', file: tokens[1] };
  }
  if (head === 'load') {
    if (tokens[1] === undefined) {
      return { kind: 'error', message: 'load requires a file path' };
    }
    return { kind: 'load', file: tokens[1] };
  }
  // Move by number: a single positive integer.
  if (tokens.length === 1 && /^\d+$/.test(tokens[0])) {
    const n = Number(tokens[0]);
    if (n < 1) {
      return { kind: 'error', message: 'Move number must be a positive integer' };
    }
    return { kind: 'moveIndex', index: n };
  }
  // Move by position: two or three tokens, both squares (optionally a choice).
  if (
    tokens.length >= 2 &&
    /^[a-hA-H][1-8]$/.test(tokens[0]) &&
    /^[a-hA-H][1-8]$/.test(tokens[1])
  ) {
    const choice = tokens[2] !== undefined ? Number(tokens[2]) : undefined;
    if (tokens[2] !== undefined && (!Number.isInteger(choice) || choice < 1)) {
      return { kind: 'error', message: 'Choice must be a positive integer' };
    }
    return { kind: 'movePosition', from: tokens[0], to: tokens[1], choice };
  }
  return { kind: 'unknown' };
};

// Runs one AI move: via the configured WS engine if `wsUrl` is set (letting
// any failure, including an unreachable engine, propagate rather than
// falling back to local analysis), otherwise today's direct/local path.
const runAiMove = async (driver, depth, wsUrl) => {
  if (!wsUrl) return driver.playAiMove(depth);

  const choice = await new WsGameDriver({ session: driver.toJSON(), url: wsUrl }).playAiMove(depth);
  if (!choice.played) return { played: false };
  const moves = driver.getMoves();
  const move = moves[choice.matchIndex];
  if (!move || moveKey(move) !== choice.moveKey) {
    throw new Error('WS engine returned a move not present in current legal moves');
  }
  const board = driver.getState().board;
  driver.playMoveIndex(choice.matchIndex);
  return {
    played: true,
    choice: choice.matchIndex + 1,
    move,
    board,
    score: choice.score,
    nodes: choice.nodes,
    time: choice.elapsedMs / 1000,
  };
};

// Execute a parsed command against the driver. Returns true to continue, false to quit.
const executeCommand = async (driver, cmd, wsUrl) => {
  switch (cmd.kind) {
    case 'noop':
      return true;
    case 'exit':
      return false;
    case 'undo': {
      const result = driver.undo();
      if (!result.changed) {
        console.log('Already at the initial position.');
      }
      return true;
    }
    case 'redo': {
      const result = driver.redo();
      if (!result.changed) {
        console.log('Already at the latest position.');
      }
      return true;
    }
    case 'history':
      printHistory(driver);
      return true;
    case 'ai': {
      const result = await runAiMove(driver, cmd.depth, wsUrl);
      if (!result.played) {
        console.log('No legal moves; AI could not play.');
      } else {
        const secondsStr = result.time.toFixed(3);
        const moveStr = formatMove(result.move, result.board);
        console.log(
          `AI played: [${result.choice}] ${moveStr} [score=${result.score} nodes=${result.nodes} time=${secondsStr}s]`,
        );
      }
      return true;
    }
    case 'save': {
      const json = driver.toJSON();
      await writeFile(cmd.file, JSON.stringify(json, null, 2) + '\n', 'utf8');
      console.log(`Saved session to ${cmd.file}`);
      return true;
    }
    case 'load': {
      const raw = await readFile(cmd.file, 'utf8');
      const parsed = JSON.parse(raw);
      driver.load(parsed);
      console.log(`Loaded session from ${cmd.file}`);
      return true;
    }
    case 'moveIndex': {
      driver.playMoveIndex(cmd.index - 1);
      return true;
    }
    case 'movePosition': {
      driver.playMovePosition(cmd.from, cmd.to, cmd.choice);
      return true;
    }
    case 'error':
      console.log(`Error: ${cmd.message}`);
      return true;
    case 'unknown':
    default:
      console.log(`Unknown command. ${HELP_LINE}`);
      return true;
  }
};

// Print a friendly message for a driver error, surfacing ambiguous routes.
const handleDriverError = (driver, error) => {
  if (error.code === 'AMBIGUOUS_MOVE' && Array.isArray(error.candidates)) {
    const board = driver.getState().board;
    console.log(`Ambiguous move: ${error.message}`);
    error.candidates.forEach(({ choice, move, index }) => {
      console.log(`  ${choice}) [${index + 1}] ${formatMove(move, board)}`);
    });
    console.log('Retry with e.g. "d5 d1 1".');
    return;
  }
  console.log(`Error: ${error.message}`);
};

const replLoop = async (driver, rl, wsUrl) => {
  printState(driver);
  const line = await rl.question('> ').catch(() => null);
  if (line === null) {
    rl.close();
    return;
  }
  const cmd = parseCommand(line);
  try {
    const keepGoing = await executeCommand(driver, cmd, wsUrl);
    if (!keepGoing) {
      rl.close();
      return;
    }
  } catch (error) {
    handleDriverError(driver, error);
  }
  await replLoop(driver, rl, wsUrl);
};

const runRepl = async (driver, wsUrl) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const meta = driver.metadata;
  if (meta !== null && meta !== undefined) {
    if (meta.title) {
      console.log(meta.title);
    }
    if (meta.description) {
      console.log(meta.description);
    }
  }
  await replLoop(driver, rl, wsUrl);
};

// ─────────────────────────────────────────────────────────────────────────
// Entry-point guard: importing this module in tests must not start the REPL.
// ─────────────────────────────────────────────────────────────────────────

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  // Parse an optional `-ws <port>` flag out of the argv, leaving the
  // remaining positional argument as today's optional startup-file path.
  const args = process.argv.slice(2);
  const wsFlagIndex = args.indexOf('-ws');
  let wsUrl;
  if (wsFlagIndex !== -1) {
    const port = args[wsFlagIndex + 1];
    args.splice(wsFlagIndex, 2);
    if (port !== undefined && /^\d+$/.test(port)) {
      wsUrl = wsPortUrl(port);
    }
  }

  const startupFile = args[0];
  const startDriver = async () => {
    if (startupFile === undefined) {
      return new GameDriver();
    }
    const raw = await readFile(startupFile, 'utf8');
    const parsed = JSON.parse(raw);
    return new GameDriver(parsed);
  };
  startDriver()
    .then((driver) => runRepl(driver, wsUrl))
    .catch((error) => {
      console.error(`Startup failed: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      // A successful WS request leaves the shared socket open for reuse
      // (fine for a long-lived browser tab) — but this is a one-shot
      // process, and an open socket is an active handle that would keep
      // the event loop (and the process) alive forever after 'quit'.
      WsGameDriver.terminate();
    });
}
