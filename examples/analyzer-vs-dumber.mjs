// Example: pit "Dumber", a random-move player (WHITE, moves first), against
// "Analyzer", a single Analyzer at depth 8 (BLACK), and play the game out to
// completion.
//
// Run with: node examples/analyze-vs-random.mjs [--no-board]
import { Game } from '../core/game.mjs';
import { Analyzer } from '../core/analyzer.mjs';
import { PieceColor, toStringPieceColor } from '../core/piece.mjs';
import { renderBoard, moveKey } from './common.mjs';

const SHOW_BOARD = !process.argv.includes('--no-board');
const SEARCH_DEPTH = 6;
const ANALYZER_COLOR = PieceColor.BLACK;
const PLAYER_NAMES = { [PieceColor.WHITE]: 'Dumber', [PieceColor.BLACK]: 'Analyzer' };
// Safety net: core/ has no repetition/no-progress draw tracking outside the
// search engine's own isImmediateDraw, so an actual game between these two
// players has no built-in stop condition beyond "no legal moves". Cap plies
// so a drifting random-vs-random-ish endgame can't loop forever.
const MAX_PLIES = 200;
const MAX_GAMES = 5;

const playPly = (game, analyzer, ply) => {
  const moves = game.getMoves();
  if (moves.length === 0 || ply >= MAX_PLIES) return ply;

  const mover = game.player();
  const moverLabel = `${PLAYER_NAMES[mover]} (${toStringPieceColor(mover)})`;
  process.stdout.write(`${SHOW_BOARD ? '\n' : ''}Ply ${ply + 1}: ${moverLabel} is thinking...`);
  const turnStart = performance.now();

  const { index, note } = mover === ANALYZER_COLOR
    ? (() => {
        const { move, score } = analyzer.analyze(SEARCH_DEPTH);
        const idx = moves.findIndex((m) => moveKey(m) === moveKey(move));
        const thinkSeconds = ((performance.now() - turnStart) / 1000).toFixed(2);
        return { index: idx, note: `[score=${score}, nodes=${analyzer.nodeCount}, time=${thinkSeconds}s]` };
      })()
    : { index: Math.floor(Math.random() * moves.length), note: '(random)' };

  const move = moves[index];
  game.selectMove(index);

  const captureNote = move.captured.length ? ` (captures ${move.captured.length})` : '';
  console.log(`\rPly ${ply + 1}: ${moverLabel} plays ${move.from} -> ${move.to}${captureNote}  ${note}`);
  if (SHOW_BOARD) console.log(renderBoard(game.board()));

  return playPly(game, analyzer, ply + 1);
};

const runGame = (gameNumber) => {
  if (gameNumber > MAX_GAMES) return;

  console.log(`\n=== Game ${gameNumber}/${MAX_GAMES} ===`);

  const game = new Game();
  const analyzer = new Analyzer(game);
  if (SHOW_BOARD) console.log(renderBoard(game.board()));

  const gameStart = performance.now();
  const ply = playPly(game, analyzer, 0);
  const totalSeconds = ((performance.now() - gameStart) / 1000).toFixed(2);

  const noMovesLeft = game.getMoves().length === 0;
  const loserColor = game.player();
  const winnerColor = loserColor === PieceColor.WHITE ? PieceColor.BLACK : PieceColor.WHITE;
  const analyzerLost = noMovesLeft && winnerColor !== ANALYZER_COLOR;

  const resultMessage = noMovesLeft
    ? `${PLAYER_NAMES[winnerColor]} wins in ${ply} plies`
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
