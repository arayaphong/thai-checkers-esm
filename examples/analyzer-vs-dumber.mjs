// Example: pit "Dumber", a random-move player (WHITE, moves first), against
// "Analyzer", a single Analyzer at depth 8 (BLACK), and play the game out to
// completion.
//
// Run with: node examples/analyzer-vs-dumber.mjs [--no-board]
import { GameDriver, renderBoard, moveKey } from '../cli/cli.mjs';
import { Analyzer } from '../core/analyzer.mjs';
import { PieceColor, toStringPieceColor } from '../core/piece.mjs';

const SHOW_BOARD = !process.argv.includes('--no-board');
const depthArg = process.argv.find((arg) => arg.startsWith('--depth='));
const SEARCH_DEPTH = depthArg ? parseInt(depthArg.split('=')[1], 10) : 8;
const ANALYZER_COLOR = PieceColor.BLACK;
const PLAYER_NAMES = { [PieceColor.WHITE]: 'Dumber', [PieceColor.BLACK]: 'Analyzer' };
const playArg = process.argv.find((arg) => arg.startsWith('--max-plies='));
const MAX_PLIES = playArg ? parseInt(playArg.split('=')[1], 10) : 200;
const MAX_GAMES = 1;

const playPly = (driver, ply) => {
  const state = driver.getState();
  if (state.isGameOver || ply >= MAX_PLIES) return ply;

  const mover = state.player;
  const moverLabel = `${PLAYER_NAMES[mover]} (${toStringPieceColor(mover)})`;
  process.stdout.write(`${SHOW_BOARD ? '\n' : ''}Ply ${ply + 1}: ${moverLabel} is thinking...`);
  const turnStart = performance.now();

  const { index, note } =
    mover === ANALYZER_COLOR
      ? (() => {
          const analyzer = new Analyzer(driver.game);
          const { move, score } = analyzer.analyze(SEARCH_DEPTH);
          const idx = state.moves.findIndex((m) => moveKey(m) === moveKey(move));
          const thinkSeconds = ((performance.now() - turnStart) / 1000).toFixed(2);
          return {
            index: idx,
            note: `[score=${score}, nodes=${analyzer.nodeCount}, time=${thinkSeconds}s]`,
          };
        })()
      : { index: Math.floor(Math.random() * state.moves.length), note: '(random)' };

  const move = state.moves[index];
  driver.playMoveIndex(index);

  const captureNote = move.captured.length ? ` (captures ${move.captured.length})` : '';
  console.log(
    `\r\x1b[KPly ${ply + 1}: ${moverLabel} plays ${move.from} -> ${move.to}${captureNote}  ${note}`,
  );
  if (SHOW_BOARD) console.log(renderBoard(driver.game.board()));

  return playPly(driver, ply + 1);
};

const runGame = (gameNumber) => {
  if (gameNumber > MAX_GAMES) return;

  console.log(`\n=== Game ${gameNumber}/${MAX_GAMES} ===`);

  const driver = new GameDriver();
  if (SHOW_BOARD) console.log(renderBoard(driver.game.board()));

  const gameStart = performance.now();
  const ply = playPly(driver, 0);
  const totalSeconds = ((performance.now() - gameStart) / 1000).toFixed(2);

  const state = driver.getState();
  const analyzerLost = state.isGameOver && state.winner !== ANALYZER_COLOR && !state.isDraw;

  const resultMessage = state.isGameOver
    ? state.isDraw
      ? `Draw by ${state.drawReason} in ${ply} plies`
      : `${PLAYER_NAMES[state.winner]} wins in ${ply} plies`
    : `Stopped after reaching the ${MAX_PLIES}-ply safety cap with no result.`;

  console.log(`\n${resultMessage}`);
  console.log(`Game ${gameNumber} time: ${totalSeconds}s`);

  if (analyzerLost) {
    console.log(`\nAnalyzer lost — stopping after game ${gameNumber}.`);
    return;
  }
  runGame(gameNumber + 1);
};

runGame(1);
