// Thai Checkers GameDriver — browser-safe adapter over the core engine.
//
// This module intentionally contains no Node built-ins so it can be imported
// by the browser-loaded controller as well as the Node CLI.
import { Game } from '../core/Game.mjs';
import { Board } from '../core/Board.mjs';
import { Position } from '../core/Position.mjs';
import { PieceColor, PieceType } from '../core/piece.mjs';
import { Analyzer, MAX_ANALYSIS_DEPTH } from '../core/Analyzer.mjs';
import { isImmediateDraw } from '../core/evaluation.mjs';

// Move objects returned by Analyzer#analyze come from an internal Game.copy(),
// so they're structurally equal but not the same instances as this game's own
// moves. Match by content to find the right index to play.
// moveKey includes from, to, and the captured-piece set only (not path), so it
// stays compatible with the existing structural matching behavior used by
// analyzer examples.
export const moveKey = (move) =>
  `${move.from.hash()}:${move.to.hash()}:${move.captured.map((p) => p.hash()).toSorted((a, b) => a - b)}`;

// ─────────────────────────────────────────────────────────────────────────
// JSON / serialization helpers (CLI-local, pure where practical)
// ─────────────────────────────────────────────────────────────────────────

const SESSION_FORMAT = 'thai-checkers-cli-session-v2';

const COLOR_NAME_TO_ENUM = new Map([
  ['WHITE', PieceColor.WHITE],
  ['BLACK', PieceColor.BLACK],
]);

const TYPE_NAME_TO_ENUM = new Map([
  ['PION', PieceType.PION],
  ['DAME', PieceType.DAME],
]);

const ENUM_TO_COLOR_NAME = new Map([
  [PieceColor.WHITE, 'WHITE'],
  [PieceColor.BLACK, 'BLACK'],
]);

// Converts omitted/"WHITE"/"BLACK" to PieceColor values and rejects anything else.
export const parseSideToMove = (value) => {
  if (value === undefined || value === null) {
    return PieceColor.WHITE;
  }
  const color = COLOR_NAME_TO_ENUM.get(value);
  if (color === undefined) {
    throw new Error(`Invalid side to move: ${String(value)}`);
  }
  return color;
};

// Converts demo string values to { color: PieceColor, type: PieceType }.
export const parsePieceInfo = (json) => {
  if (typeof json !== 'object' || json === null) {
    throw new TypeError(`Piece info must be an object: ${String(json)}`);
  }
  const color = COLOR_NAME_TO_ENUM.get(json.color);
  if (color === undefined) {
    throw new Error(`Invalid piece color: ${String(json.color)}`);
  }
  const type = TYPE_NAME_TO_ENUM.get(json.type);
  if (type === undefined) {
    throw new Error(`Invalid piece type: ${String(json.type)}`);
  }
  return { color, type };
};

// Converts demo piece arrays to [Position, pieceInfo] pairs for Board.fromPieces().
export const parsePieces = (piecesJson) => {
  if (!Array.isArray(piecesJson)) {
    throw new TypeError('pieces must be an array');
  }
  return piecesJson.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new Error(`Invalid piece entry: ${JSON.stringify(entry)}`);
    }
    const [square, info] = entry;
    const position = Position.fromString(String(square).toUpperCase());
    return [position, parsePieceInfo(info)];
  });
};

// Uses Board.decode(BigInt(initialSetup.board)).
export const boardFromInitialSetup = (initialSetup) => {
  if (
    initialSetup === undefined ||
    initialSetup === null ||
    typeof initialSetup.board !== 'string'
  ) {
    throw new Error('initialSetup.board must be a decimal string');
  }
  return Board.decode(BigInt(initialSetup.board));
};

// Stores rootGame.board().encode().toString() and the string form of
// rootGame.player(). Must be called on the initial/root game, not on the
// current game after moves.
export const initialSetupFromRootGame = (rootGame) => ({
  board: rootGame.board().encode().toString(),
  sideToMove: ENUM_TO_COLOR_NAME.get(rootGame.player()),
});

// Stores zero-based index plus algebraic from, to, captured, and path.
export const moveRecordFromMove = (index, move) => ({
  index,
  from: move.from.toString(),
  to: move.to.toString(),
  captured: move.captured.map((pos) => pos.toString()),
  path: (move.path && move.path.length > 0 ? move.path : [move.from, move.to]).map((pos) =>
    pos.toString(),
  ),
});

// Confirms replayed moves still match the saved algebraic fields, including
// route-level fields such as path.
export const moveRecordMatches = (move, record) => {
  const movePath = (move.path && move.path.length > 0 ? move.path : [move.from, move.to]).map(
    (pos) => pos.toString(),
  );
  const recordPath = record.path;
  if (movePath.length !== recordPath.length) {
    return false;
  }
  const pathMatches = movePath.every((sq, i) => sq === recordPath[i]);
  const capturedMatches =
    move.captured.length === record.captured.length &&
    move.captured
      .map((pos) => pos.toString())
      .toSorted()
      .every((sq, i) => sq === [...record.captured].toSorted()[i]);
  return (
    move.from.toString() === record.from &&
    move.to.toString() === record.to &&
    pathMatches &&
    capturedMatches
  );
};

// Error used when a saved move index exists but the replayed move's from, to,
// captured, or path fields do not match the saved record.
export class SaveIncompatibilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SaveIncompatibilityError';
    this.code = 'SAVE_INCOMPATIBLE';
  }
}

// Error used when a coordinate move matches multiple legal routes and no
// choice was supplied. Carries the matching candidates for the REPL.
export class AmbiguousMoveError extends Error {
  constructor(message, candidates) {
    super(message);
    this.name = 'AmbiguousMoveError';
    this.code = 'AMBIGUOUS_MOVE';
    this.candidates = candidates;
  }
}

// Detect whether input JSON is a saved session or a demo/setup object.
const detectInputShape = (json) => {
  if (json === undefined || json === null) {
    return 'standard';
  }
  if (typeof json !== 'object') {
    throw new TypeError('Input must be an object or undefined');
  }
  if (json.format === SESSION_FORMAT) {
    return 'session';
  }
  if (Array.isArray(json.pieces)) {
    return 'demo';
  }
  throw new Error(
    'Unrecognized input shape: expected a demo/setup object with "pieces" or a saved session with "format"',
  );
};

// ─────────────────────────────────────────────────────────────────────────
// Draw helpers (CLI-level, no core/ changes)
// ─────────────────────────────────────────────────────────────────────────

// The only forced terminal draw case for the CLI: the board contains exactly
// two pieces total, one White dame and one Black dame.
export const isOneDameEachDraw = (board) => {
  const white = board.getPieces(PieceColor.WHITE);
  const black = board.getPieces(PieceColor.BLACK);
  const whiteDames = [...white.values()].filter(({ type }) => type === PieceType.DAME).length;
  const blackDames = [...black.values()].filter(({ type }) => type === PieceType.DAME).length;
  const whiteTotal = white.size;
  const blackTotal = black.size;
  return whiteTotal === 1 && blackTotal === 1 && whiteDames === 1 && blackDames === 1;
};

// ─────────────────────────────────────────────────────────────────────────
// GameDriver
// ─────────────────────────────────────────────────────────────────────────

export class GameDriver {
  #history = [];
  #currentIndex = 0;
  #initialSetup = null;
  #metadata = null;

  constructor(inputJson) {
    const shape = detectInputShape(inputJson);
    if (shape === 'standard') {
      this.#initStandard();
    } else if (shape === 'demo') {
      this.#initDemo(inputJson);
    } else {
      this.#initSession(inputJson);
    }
  }

  #initStandard() {
    const game = new Game();
    this.#initialSetup = initialSetupFromRootGame(game);
    this.#metadata = null;
    this.#history = [{ game, move: null, moveRecord: null }];
    this.#currentIndex = 0;
  }

  #initDemo(json) {
    const pieces = parsePieces(json.pieces);
    const sideToMove = parseSideToMove(json.sideToMove);
    const board = Board.fromPieces(pieces);
    const game = Game.from(board, sideToMove);
    this.#initialSetup = initialSetupFromRootGame(game);
    this.#metadata = {
      id: json.id ?? null,
      title: json.title ?? null,
      description: json.description ?? null,
    };
    this.#history = [{ game, move: null, moveRecord: null }];
    this.#currentIndex = 0;
  }

  // Recursively replay a saved move sequence, validating each record against
  // the legal moves at that point. Returns the full history array (root + each
  // replayed entry). Throws SaveIncompatibilityError on any mismatch.
  #replaySequence(history, current, sequence, i = 0) {
    if (i >= sequence.length) {
      return history;
    }
    const record = sequence[i];
    const moves = current.getMoves();
    if (record.index < 0 || record.index >= moves.length) {
      throw new SaveIncompatibilityError(
        `Save file is incompatible with the current engine: move ${i + 1} index ${record.index} out of range`,
      );
    }
    const move = moves[record.index];
    if (!moveRecordMatches(move, record)) {
      throw new SaveIncompatibilityError(
        `Save file is incompatible with the current engine: move ${i + 1} no longer matches its saved record`,
      );
    }
    const next = Game.copy(current);
    next.selectMove(record.index);
    const extended = [...history, { game: next, move, moveRecord: record }];
    return this.#replaySequence(extended, next, sequence, i + 1);
  }

  #initSession(json) {
    const board = boardFromInitialSetup(json.initialSetup);
    const sideToMove = parseSideToMove(json.initialSetup.sideToMove);
    const rootGame = Game.from(board, sideToMove);
    this.#initialSetup = initialSetupFromRootGame(rootGame);
    this.#metadata = null;

    const sequence = Array.isArray(json.moveSequence) ? json.moveSequence : [];
    const history = this.#replaySequence(
      [{ game: rootGame, move: null, moveRecord: null }],
      rootGame,
      sequence,
    );

    const currentIndex = json.currentIndex ?? sequence.length;
    if (currentIndex < 0 || currentIndex > sequence.length) {
      throw new RangeError(`currentIndex ${currentIndex} out of range 0..${sequence.length}`);
    }

    this.#history = history;
    this.#currentIndex = currentIndex;
  }

  #currentEntry() {
    return this.#history[this.#currentIndex];
  }

  #currentGame() {
    return this.#currentEntry().game;
  }

  getState() {
    const game = this.#currentGame();
    const board = game.board();
    const player = game.player();
    const moves = game.getMoves();
    const oneDameEach = isOneDameEachDraw(board);
    const noLegalMoves = moves.length === 0;
    const isGameOver = noLegalMoves || oneDameEach;
    const winner = noLegalMoves
      ? player === PieceColor.WHITE
        ? PieceColor.BLACK
        : PieceColor.WHITE
      : null;
    const isDraw = oneDameEach;
    const drawReason = oneDameEach ? 'ONE_DAME_EACH' : null;
    const drawWarning =
      !isGameOver && isImmediateDraw(board, player) ? { reason: 'DRAW_POSSIBLE' } : null;
    return {
      board,
      player,
      moves,
      isGameOver,
      winner,
      isDraw,
      drawReason,
      drawWarning,
      canUndo: this.#currentIndex > 0,
      canRedo: this.#currentIndex < this.#history.length - 1,
    };
  }

  getMoves() {
    return this.#currentGame().getMoves();
  }

  history() {
    return this.#history.slice(1, this.#currentIndex + 1).map((entry) => entry.move);
  }

  undo() {
    if (this.#currentIndex === 0) {
      return { changed: false, state: this.getState() };
    }
    this.#currentIndex -= 1;
    return { changed: true, state: this.getState() };
  }

  redo() {
    if (this.#currentIndex >= this.#history.length - 1) {
      return { changed: false, state: this.getState() };
    }
    this.#currentIndex += 1;
    return { changed: true, state: this.getState() };
  }

  get metadata() {
    return this.#metadata;
  }

  get initialSetup() {
    return this.#initialSetup;
  }

  get game() {
    return this.#currentGame();
  }

  // ─── Move execution ───

  playMoveIndex(index) {
    if (!Number.isInteger(index)) {
      throw new RangeError(`Move index must be an integer: ${String(index)}`);
    }
    const moves = this.getMoves();
    if (index < 0 || index >= moves.length) {
      const range = moves.length > 0 ? `0-${moves.length - 1}` : 'no legal moves';
      throw new RangeError(`Move index ${index} out of range; valid range is ${range}`);
    }
    const move = moves[index];
    const next = Game.copy(this.#currentGame());
    next.selectMove(index);
    const moveRecord = moveRecordFromMove(index, move);
    // Discard redo history if we are not at the latest entry.
    if (this.#currentIndex < this.#history.length - 1) {
      this.#history = this.#history.slice(0, this.#currentIndex + 1);
    }
    this.#history.push({ game: next, move, moveRecord });
    this.#currentIndex = this.#history.length - 1;
    return this.getState();
  }

  playMovePosition(from, to, choice) {
    const fromPos = Position.fromString(String(from).toUpperCase());
    const toPos = Position.fromString(String(to).toUpperCase());
    const candidates = this.getMoves()
      .map((move, index) => ({ move, index }))
      .filter(({ move }) => move.from.equals(fromPos) && move.to.equals(toPos));
    if (candidates.length === 0) {
      throw new Error(`No legal move from ${fromPos.toString()} to ${toPos.toString()}`);
    }
    if (candidates.length === 1) {
      return this.playMoveIndex(candidates[0].index);
    }
    // Ambiguous: require a one-based choice among matching routes.
    if (choice === undefined || choice === null) {
      throw new AmbiguousMoveError(
        `Ambiguous move from ${fromPos.toString()} to ${toPos.toString()}: ${candidates.length} routes match. Supply a choice.`,
        candidates.map(({ move, index }, i) => ({ choice: i + 1, index, move })),
      );
    }
    if (!Number.isInteger(choice) || choice < 1 || choice > candidates.length) {
      throw new RangeError(`Choice ${choice} out of range; valid range is 1-${candidates.length}`);
    }
    return this.playMoveIndex(candidates[choice - 1].index);
  }

  playAiMove(depth = 6) {
    if (!Number.isSafeInteger(depth) || depth < 1 || depth > MAX_ANALYSIS_DEPTH) {
      throw new RangeError(
        `Analysis depth must be an integer between 1 and ${MAX_ANALYSIS_DEPTH}: ${depth}`,
      );
    }
    const game = this.#currentGame();
    const analyzer = new Analyzer(game);
    const turnStart = performance.now();
    const result = analyzer.analyze(depth);
    const elapsedMs = performance.now() - turnStart;
    if (result === null) {
      return { played: false, state: this.getState() };
    }
    const targetKey = moveKey(result.move);
    const moves = this.getMoves();
    const matchIndex = moves.findIndex((move) => moveKey(move) === targetKey);
    if (matchIndex === -1) {
      throw new Error('Analyzer produced a move not present in current legal moves');
    }
    const board = this.getState().board;
    this.playMoveIndex(matchIndex);
    return {
      played: true,
      state: this.getState(),
      score: result.score,
      nodes: analyzer.nodeCount,
      time: elapsedMs / 1000,
      choice: matchIndex + 1,
      move: result.move,
      board,
      elapsedMs,
      matchIndex,
    };
  }

  // ─── Save / Load ───

  toJSON() {
    const moveSequence = this.#history.slice(1).map((entry) => entry.moveRecord);
    return {
      format: SESSION_FORMAT,
      initialSetup: this.#initialSetup,
      moveSequence,
      currentIndex: this.#currentIndex,
    };
  }

  load(json) {
    if (json === undefined || json === null || typeof json !== 'object') {
      throw new TypeError('Load input must be an object');
    }
    if (json.format !== SESSION_FORMAT) {
      throw new Error(
        `Cannot load input with format ${String(json.format)}; expected ${SESSION_FORMAT}`,
      );
    }
    // Rebuild atomically: build into locals, then assign only on success.
    const board = boardFromInitialSetup(json.initialSetup);
    const sideToMove = parseSideToMove(json.initialSetup.sideToMove);
    const rootGame = Game.from(board, sideToMove);
    const sequence = Array.isArray(json.moveSequence) ? json.moveSequence : [];
    const history = this.#replaySequence(
      [{ game: rootGame, move: null, moveRecord: null }],
      rootGame,
      sequence,
    );
    const currentIndex = json.currentIndex ?? sequence.length;
    if (currentIndex < 0 || currentIndex > sequence.length) {
      throw new RangeError(`currentIndex ${currentIndex} out of range 0..${sequence.length}`);
    }
    this.#initialSetup = initialSetupFromRootGame(rootGame);
    this.#metadata = null;
    this.#history = history;
    this.#currentIndex = currentIndex;
  }
}
