// Example: pit "Analyzer" (WHITE, moves first) against another "Analyzer"
// (BLACK), and play the game out to completion.
//
// Run with: node examples/analyzer-vs-analyzer.mjs [--no-board]
import { GameDriver, renderBoard, moveKey } from '../cli/cli.mjs';
import { Analyzer } from '../core/analyzer.mjs';
import { PieceColor, toStringPieceColor } from '../core/piece.mjs';

const SHOW_BOARD = !process.argv.includes('--no-board');
const SEARCH_DEPTH_W = 6;
const SEARCH_DEPTH_B = 6;
const PLAYER_NAMES = { [PieceColor.WHITE]: 'Analyzer W', [PieceColor.BLACK]: 'Analyzer B' };
// Safety net: cap plies to prevent infinite loops in drawish endgames
const MAX_PLIES = 200;
const MAX_GAMES = 5;

const playPly = (driver, ply) => {
  const state = driver.getState();
  if (state.isGameOver || ply >= MAX_PLIES) return ply;

  const mover = state.player;
  const moverLabel = `${PLAYER_NAMES[mover]} (${toStringPieceColor(mover)})`;
  process.stdout.write(`${SHOW_BOARD ? '' : ''}Ply ${ply + 1}: ${moverLabel} is thinking...`);
  const turnStart = performance.now();

  const searchDepth = mover === PieceColor.WHITE ? SEARCH_DEPTH_W : SEARCH_DEPTH_B;

  const analyzer = new Analyzer(driver.game);
  const { move, score } = analyzer.analyze(searchDepth);
  const index = state.moves.findIndex((m) => moveKey(m) === moveKey(move));
  const thinkSeconds = ((performance.now() - turnStart) / 1000).toFixed(2);
  const note = `[score=${score}, nodes=${analyzer.nodeCount}, time=${thinkSeconds}s]`;

  driver.playMoveIndex(index);

  const captureNote = move.captured.length ? ` (captures ${move.captured.length})` : '';
  console.log(`Ply ${ply + 1}: ${moverLabel} plays ${move.from} -> ${move.to}${captureNote}  ${note}`);
  if (SHOW_BOARD) console.log(renderBoard(driver.game.board()));

  return playPly(driver, ply + 1);
};

const runGame = (gameNumber) => {
  if (gameNumber > MAX_GAMES) return;

  console.log(`=== Game ${gameNumber}/${MAX_GAMES} ===`);

  const driver = new GameDriver();

  if (SHOW_BOARD) console.log(renderBoard(driver.game.board()));

  const gameStart = performance.now();
  const ply = playPly(driver, 0);
  const totalSeconds = ((performance.now() - gameStart) / 1000).toFixed(2);

  const state = driver.getState();
  const resultMessage = state.isGameOver
    ? (state.isDraw
        ? `Draw by ${state.drawReason} in ${ply} plies`
        : `${PLAYER_NAMES[state.winner]} wins in ${ply} plies`)
    : `Stopped after reaching the ${MAX_PLIES}-ply safety cap with no result.`;

  console.log(`${resultMessage}`);
  console.log(`Game ${gameNumber} time: ${totalSeconds}s`);

  runGame(gameNumber + 1);
};

runGame(1);
