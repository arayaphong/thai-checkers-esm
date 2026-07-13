# Plan: Retire `ai/` in favor of `GameDriver` (Detailed)

This document is the complete, implementation-ready plan for removing the `ai/`
folder and driving AI turns through `GameDriver` (the atomic-move engine
currently embedded in `cli/cli.mjs`, backed by `core/`), while the
human-vs-view interaction path keeps using `model/` as it does today after the
two pre-existing parity defects documented in §1.3.1 are repaired.
It was written after a full reading of `ai/`, `model/`, `controller/`, `core/`,
`cli/cli.mjs`, and the `view/` layer, and after cross-checking the coordinate
mapping and move-splitting rules against three independent existing test
fixtures (see §1.3). It is meant to be followed without re-deriving the
architecture — the "why" is recorded inline so implementation can proceed
directly to the "what."

## 0. Objective and non-goals

**Objective:** Two decision-makers, one shared rule engine underneath, kept in
lockstep by `controller/`:

1. **View-driven play** (human clicking through `view/`) continues to run
   entirely on `model/gameState.mjs` + `model/moveEngine.mjs`, per-step
   (one walk, or one jump of a chain, per click), exactly as today. No view
   file changes except difficulty label text (§5).
2. **AI-driven play** is decided by `GameDriver` (`cli/GameDriver.mjs` after
   the split in §2), which wraps `core/Game.mjs`'s `Game` and
   `core/Analyzer.mjs`'s `Analyzer`. `GameDriver` moves are atomic — one
   _entire_ turn (including a whole multi-capture chain) is a single
   `getMoves()` entry and a single `selectMove()`/`playMoveIndex()` call.

`controller/gameController.mjs` is the seam: it keeps a `model/GameState`
instance (`state`, unchanged shape, drives the view) and a `GameDriver`
instance (`driver`, new) that mirrors the same position turn-by-turn. Every
completed turn — whether played by a human through `model/` or decided by
`GameDriver`'s `Analyzer` — gets applied to _both_ representations.

**Non-goals (explicitly out of scope, do not implement):**

- `GameDriver`'s `undo()`/`redo()`/`toJSON()`/`load()` are **not** wired into
  `controller/` or the view. `controller/` never exposes undo/redo today, so
  there's nothing to hook them up to. Only `playMovePosition` and
  `playAiMove` are used.
- `GameDriver.getState()`'s `ONE_DAME_EACH` forced-draw and `drawWarning`
  advisory are **not** surfaced to the view. `model/`'s own `status` field
  stays the sole source of truth for game-over/winner in the UI, unchanged.
  (They already agree on _when_ the game ends — see §1.3 — this is just about
  not adding new UI surface for draw detection, which nobody asked for.)
- Apart from the one-line promotion-row correction in `core/Game.mjs`
  (§1.3.1), `core/` is not changed. In particular, no move-generation or
  analyzer rules are changed.
- Apart from correcting the occupied-square parity of `INITIAL_BOARD` in
  `model/types.mjs` (§1.3.1), `model/` is not changed. Its move-generation
  rules already agree with `core/`; the repair only makes the standard
  starting position use the same playable squares as demos and `core/`.
- `cli/cli.mjs`'s REPL behavior is not changed beyond the mechanical split in
  §2.

## 1. Architecture

### 1.1 Why two engines have to stay in sync, not merge

The entire `view/` rendering stack reads `controller.state` shaped exactly
like `model/GameState`: `board` (8×8 numeric array, white positive/black
negative, `2`=dame), `turn` (`1`/`-1`), `mustMovePiece` (`{r,c}` or `null`),
`status` (`'PLAYING'|'WHITE_WINS'|'BLACK_WINS'`), `config`, `validMoves`
(single-hop shape: `{fromR,fromC,toR,toC,isCapture,jumpedR?,jumpedC?}`).
Confirmed consumers: `view/gameViewStateFactory.mjs` (reads `state.board`,
`state.turn`, `state.mustMovePiece`, `state.validMoves`, `state.config`,
`state.pieceCounts` directly), `view/gameViewBinder.mjs` (reads
`move.fromR/fromC/toR/toC/isCapture/jumpedR/jumpedC` per `moveMade` event,
and `controller.state.mustMovePiece` to detect turn completion).

Replacing `model/` with `core/`'s atomic moves would require rewriting all of
that. Instead, `model/` stays authoritative for the view, and `GameDriver`
runs alongside purely as the AI's decision oracle (and, symmetrically, as the
thing a completed human turn gets replayed into once it's done). This is why
`controller/` must hold two live objects and translate between them at every
turn boundary — not fuse them into one.

### 1.2 Coordinate and enum mapping (canonical — do not re-derive)

| Concept     | `model/`                                               | `core/`                                                     |
| ----------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Row/rank    | `r` (0 = rank 8 / black home, 7 = rank 1 / white home) | `y` (0 = rank 1 / white home, 7 = rank 8 / black home)      |
| Column/file | `c` (0 = 'A' … 7 = 'H')                                | `x` (0 = 'A' … 7 = 'H')                                     |
| Relation    | —                                                      | **`y = 7 - r`, `x = c`** (and inverse `r = 7 - y`, `c = x`) |
| White       | `turn === 1`, piece value `> 0`                        | `PieceColor.WHITE === 0`                                    |
| Black       | `turn === -1`, piece value `< 0`                       | `PieceColor.BLACK === 1`                                    |
| Pion        | `abs(piece) === 1`                                     | `PieceType.PION === 0`                                      |
| Dame        | `abs(piece) === 2`                                     | `PieceType.DAME === 1`                                      |

Derivation: `core/Board.mjs` `Board.setup()` puts White on rows 0–1 (bottom)
and Black on rows 6–7 (top) — i.e. White's home is low `y`. `model/types.mjs`
`INITIAL_BOARD` puts Black on `r=0-1` (top) and White on `r=6-7` (bottom) —
i.e. White's home is high `r`. Both put White at the bottom of the physical
board and Black at the top; the `r`/`y` axes just run in opposite
directions, giving `y = 7 - r`.

### 1.3 Validated: `model/` and `core/` already agree on move generation

This was checked, not assumed, since the whole design depends on it:

- **Forced capture rule.** Both apply it board-wide: if _any_ piece has a
  capture, only captures are legal, across the whole side to move (not
  "must take the biggest capture"). `model/MoveEngine.getAllValidMoves`
  groups all moves by `isCapture` and returns only captures if any exist.
  `core/Game.mjs#buildAllMoves` does the same via `#hasMandatoryCapture()`
  over every moveable piece.
- **Dame "short king" capture rule.** Both only allow landing on the single
  empty square immediately behind the captured piece (not a free choice of
  landing square further along the ray). `model/MoveEngine.scanDameRay`
  returns exactly one capture landing per direction and does not keep
  scanning past it; `core/Explorer.mjs#findCapturesInDir`'s dame branch does
  the same (comment: "Thai 'short king' rule — no choice of a farther
  landing square").
- **Promotion ends the capture chain immediately.** Both stop a multi-capture
  sequence the instant a pion reaches the back row, even if further captures
  would otherwise be available as a dame. `model/MoveEngine.executeMove`:
  `canContinue = move.isCapture && !promoted && captures.length > 0`.
  `core/Explorer.mjs#findCapturesFrom`: `if (becameDame) { ...; continue; }`
  ends the recursive search right there.
- **Coordinate/color mapping is correct** (not just derived from source
  reading, but cross-validated against two independent existing tests that
  both load the same fixture, `examples/demos/demo1.json`, through the two
  different engines and land on matching results):
  - `tests/cli/GameDriver.test.mjs` ("demo1: branching chain capture with two
    routes to E8") loads `demo1.json` into `GameDriver` and plays route 1 via
    `driver.playMovePosition('e4', 'e8', 1)`, asserting
    `played.path.map(toString) === ['E4','C6','E8']` and
    `played.captured === ['D5','D7']`.
  - `tests/view/smoke-game-flow.test.mjs` ("demo play turn finalized logging
    with captures") loads the _same_ `demo1.json`, converts it to a `model/`
    board with the same `COLOR_MAP`/`TYPE_MAP`/coordinate transform
    `main.mjs` uses, then plays it through `controller.attemptMove` as two
    human clicks: `{r:4,c:4}→{r:2,c:2}` then `{r:2,c:2}→{r:0,c:4}`, and
    asserts the resulting turn-summary log is exactly
    `'[WHITE] E4->C6->*E8 [xD5 xD7]'`.
  - Both land on **the same route** (E4→C6→E8, capturing D5 then D7) via
    the mapping in §1.2 (`{r:4,c:4}` ⇄ `E4`, `{r:2,c:2}` ⇄ `C6`,
    `{r:0,c:4}` ⇄ `E8`). This is exactly the cross-engine agreement the
    whole bridge design in §3 depends on, already proven by pre-existing
    tests without either test knowing about the other.

The move-generation rules agree, but the first parity-test run found two
pre-existing state-application/setup defects outside move generation. They
must be repaired as described next before the bridge is safe to build. §7's
parity test is the standing regression guard for both the rule agreement and
these repairs.

### 1.3.1 Parity-test findings and required alignment repairs

The initial §7.0 test run (2026-07-11) produced three passing fixtures
(`demo2`, `demo3`, `demo4`) and two failures:

1. **Promotion application differs (`demo1`, ply 1).** Both engines generate
   the same `E4→C6→E8` capture chain and both correctly stop the chain at the
   promotion row, but `model/` leaves a White dame at E8 while
   `core/Game.mjs#executeMove` leaves a White pion. `core/directions.mjs` and
   `model/moveEngine.mjs` agree that White promotes at `y=7`/`r=0` and Black
   at `y=0`/`r=7`; only `core/Game.mjs` has the ternary reversed. Change:

   ```js
   // before (incorrect)
   const promoRow = color === PieceColor.WHITE ? 0 : 7;
   // after
   const promoRow = color === PieceColor.WHITE ? 7 : 0;
   ```

   This is a bug fix in move application, not a rule change: it makes
   execution honor the promotion rule already used by core move generation.

2. **The two standard opening boards occupy opposite checkerboard parities.**
   Under the canonical mapping `y = 7 - r, x = c`, model playable squares
   have `(r+c) % 2 === 0` (for example `{r:4,c:4}` ⇄ E4). Demo conversion,
   core `Position`, and all validated algebraic fixtures use that parity, but
   `model/types.mjs#INITIAL_BOARD` currently places every starting piece on
   `(r+c) % 2 === 1`. Shift each occupied entry one column so the corrected
   rows are:

   ```js
   [-1, 0, -1, 0, -1, 0, -1, 0],
   [0, -1, 0, -1, 0, -1, 0, -1],
   // four empty rows
   [1, 0, 1, 0, 1, 0, 1, 0],
   [0, 1, 0, 1, 0, 1, 0, 1],
   ```

   Do not change the coordinate mapping to hide this defect: changing `x`
   or removing the vertical flip would contradict the established E4/C6/E8
   fixtures and their view logs.

These are prerequisite alignment repairs and form part of implementation
phase 1. After both changes, the full §7.0 parity suite and the existing test
suite must pass before proceeding to the CLI split. If another parity failure
appears after these minimal repairs, stop again and revise this section from
the new evidence rather than broadening the fixes speculatively.

### 1.4 Turn-boundary sync protocol

Two directions, both owned by `controller/`:

**AI turn (driver → model):** `controller` asks `driver.playAiMove(depth)`
_first_. `driver` is already authoritative and already advanced. `controller`
expands the returned atomic move into a sequence of `model/`-shaped hops
(§3) and replays them one at a time through the _same_ per-hop primitive the
human path uses (`applyHop`, §4.2), so `moveMade`/`multiCapture`/`promotion`
events and animation pacing are emitted exactly as they are today. No
model→driver sync needed afterward — driver was the source of truth.

**Human turn (model → driver):** the human plays hop-by-hop through
`model/` as today. `controller` accumulates the turn's path and captured
squares (a new accumulator, owned by `controller`, independent of the
similar-looking one already in `view/gameViewBinder.mjs` — see §4.3 note on
why these are deliberately not shared). Once the turn completes
(`!state.mustMovePiece`), `controller` calls
`driver.playMovePosition(fromSquare, toSquare)`. If `GameDriver` reports
`AMBIGUOUS_MOVE` (same endpoints, multiple routes — see §1.5), `controller`
resolves it by matching the accumulated captured-square set against each
candidate's `move.captured` (exact set match — see §1.5 for why this is
always resolvable).

### 1.5 The two ambiguity cases named in the original design discussion

1. **Same (from, to), genuinely different capture sets** (e.g. `demo1`,
   `demo4`): these remain distinct entries in `driver.getMoves()`.
   `playMovePosition` throws `AmbiguousMoveError` with `candidates`. Resolved
   deterministically because the human's own clicks already pinned down
   exactly which squares got captured — `controller`'s accumulated
   captured-square set will match exactly one candidate's `captured` set
   (order-independent comparison), never zero, never more than one, _as
   long as_ `model/` and `core/` agree on rules (validated in §1.3).
2. **Capture loop returning to the start square, multiple routes, same net
   result** (e.g. `demo2`, `demo3`): `core/Game.mjs`'s `uniqueMoves()` /
   `moveIdentityKey()` dedupes by `` `${from}:${to}:${sortedCapturedSet}` ``
   — order-independent on the captured set. Two routes that capture the
   _same set_ of pieces and land on the same square collapse into a single
   `getMoves()` entry before `GameDriver` ever sees them. No ambiguity ever
   reaches `playMovePosition` for this case — confirmed by
   `tests/cli/GameDriver.test.mjs`'s demo2/demo3 cases ("reduced to one
   move"). `demo4` is the case where a branch piece makes the captured sets
   genuinely differ, so it falls into case 1 instead.

This means `controller`'s ambiguity-resolution code (§3,
`playHumanTurnOnDriver`) only ever needs to handle case 1, and only ever
needs a captured-set match (not a full path match) to disambiguate.

## 2. Split `cli/cli.mjs` → `cli/GameDriver.mjs` + `cli/cli.mjs`

**Why this is required, not optional:** This app is pure ES2025 modules — no
framework, no bundler, and no build step — and is served by a static HTTP
server as documented in `README.md`. `index.html` loads `main.mjs` as a native
`<script type="module">` with no import map. Native browser ESM resolves
every static `import` in the whole module graph eagerly, including bindings
that are never called. `cli/cli.mjs` currently has
`import { readFile, writeFile } from 'node:fs/promises'`,
`import { createInterface } from 'node:readline/promises'`, and
`import process from 'node:process'` at its top — none of which browsers can
resolve (no `node:` scheme, no import map). If `controller/` (which
`main.mjs` loads into the browser) imports `GameDriver` from
`cli/cli.mjs` as it stands today, the browser throws at module-load time,
before any game code runs. `core/` has no such problem — `core/Analyzer.mjs`
and `core/Game.mjs` only import from within `core/`, confirmed via
`grep -rn "from 'node:"` returning zero hits under `core/`. Once §1.3.1's
prerequisite repair is complete, §2 makes no further `core/` changes:
`cli/cli.mjs` is touched via this one mechanical split, extracting the
already-browser-safe `GameDriver` class into its own file. No logic changes —
this is a cut-and-paste plus import/export bookkeeping.

### 2.1 What moves to `cli/GameDriver.mjs` (new file)

Cut verbatim from the current `cli/cli.mjs` (no edits to the moved code):

- The "JSON / serialization helpers" section: `SESSION_FORMAT`,
  `COLOR_NAME_TO_ENUM`, `TYPE_NAME_TO_ENUM`, `ENUM_TO_COLOR_NAME`,
  `ENUM_TO_TYPE_NAME`, `parseSideToMove`, `parsePieceInfo`, `parsePieces`,
  `boardFromInitialSetup`, `initialSetupFromRootGame`, `moveRecordFromMove`,
  `moveRecordMatches`, `SaveIncompatibilityError`, `AmbiguousMoveError`,
  `detectInputShape`.
- The "Draw helpers" section: `isOneDameEachDraw`.
- The `GameDriver` class itself, in full.
- `moveKey` (currently in the "Display helpers" section, but it's used
  _inside_ `GameDriver.playAiMove` — line `const targetKey =
moveKey(result.move);` — so it must travel with the class, not stay
  behind).

Imports the new file needs at its top (carry over verbatim from the current
top-of-file import block, including the two — `toStringPieceColor` /
`toStringPieceType` — that are imported but not actually referenced anywhere
in the current file; preserve them as-is, this is a pure move, not a
cleanup):

```js
import { Game } from '../core/Game.mjs';
import { Board } from '../core/Board.mjs';
import { Position } from '../core/Position.mjs';
import { PieceColor, PieceType, toStringPieceColor, toStringPieceType } from '../core/piece.mjs';
import { Analyzer, MAX_ANALYSIS_DEPTH } from '../core/Analyzer.mjs';
import { isImmediateDraw } from '../core/evaluation.mjs';
```

Export everything listed above (all of it was already exported in
`cli/cli.mjs`; keep the same export keywords).

### 2.2 What stays in `cli/cli.mjs`

Everything else, unchanged in place:

- `renderBoard`, `promotionRowOf`, `isPromotion`, `formatMove`,
  `formatCandidateRoutes` (REPL-only display helpers — `GameDriver` itself
  never calls any of these, confirmed by grep).
- The entire REPL command layer (`COLOR_LABEL`, `HELP_LINE`, `printState`,
  `printHistory`, `parseCommand`, `executeCommand`, `handleDriverError`,
  `replLoop`, `runRepl`) and the `isMainModule` entry-point guard — byte for
  byte unchanged.

New top of `cli/cli.mjs`:

```js
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
```

(`renderBoard` stays defined locally in `cli/cli.mjs`, already exported
there — no change to how it's exported.)

### 2.3 Why the re-export list is exactly this set

Grepped every external reference to `cli/cli.mjs` exports across the repo:
`examples/analyzer-vs-Analyzer.mjs` and `examples/analyzerVsDumber.mjs`
import `{ GameDriver, renderBoard, moveKey }`; `tests/cli/GameDriver.test.mjs`
imports `{ GameDriver, isOneDameEachDraw, moveRecordMatches, parsePieces,
parseSideToMove }`. `tests/cli/repl.test.mjs` spawns `cli/cli.mjs` as a child
process (`node:child_process`) and never imports its exports directly, so it
only depends on REPL I/O behavior, which is untouched. `SaveIncompatibilityError`
/`AmbiguousMoveError` aren't imported by name anywhere today (tests check
`error.code === 'AMBIGUOUS_MOVE'`, not `instanceof`), but re-export them
anyway since they were public exports before — no cost, avoids narrowing the
API surface as a side effect of an unrelated refactor.

### 2.4 Verification for this phase

Run `npm test`. `tests/cli/GameDriver.test.mjs`, `tests/cli/repl.test.mjs`,
and (manually) `node examples/analyzer-vs-Analyzer.mjs` /
`node examples/analyzerVsDumber.mjs` must all pass/run with zero changes
to those files. If anything fails, the split introduced a behavior change —
it shouldn't have; go back and diff against the original `cli/cli.mjs`.

## 3. New file: `controller/gameDriverBridge.mjs`

Pure translation functions, no DOM, no Node built-ins, no game-rule logic of
its own (it only reshapes data and delegates rule decisions to `GameDriver`).

```js
import { Position } from '../core/Position.mjs';
import { PieceColor, PieceType } from '../core/piece.mjs';
import { GameDriver } from '../cli/GameDriver.mjs';

// ─── Coordinate mapping (see retire-ai-for-game-driver.md §1.2) ───
// core Position: x = 0..7 ('A'..'H'), y = 0..7 (rank1..rank8)
// model {r,c}:   r = 0..7 (rank8..rank1), c = 0..7 ('A'..'H')
// Relation: y = 7 - r, x = c.
export const modelPosOfPosition = (pos) => ({ r: 7 - pos.y, c: pos.x });
export const positionOfModelPos = ({ r, c }) => Position.fromCoords(c, 7 - r);

export const squareOfModelPos = (rc) => positionOfModelPos(rc).toString();
export const modelPosOfSquare = (square) =>
  modelPosOfPosition(Position.fromString(square.toUpperCase()));

// ─── Color/type mapping ───
export const pieceColorOfTurn = (turn) => (turn === 1 ? PieceColor.WHITE : PieceColor.BLACK);
export const turnOfPieceColor = (color) => (color === PieceColor.WHITE ? 1 : -1);

// ─── Driver construction from a model board/turn (used at reset/init time
//     to build a GameDriver over a demo/custom starting position) ───
export const demoJsonFromModelBoard = (board, turn) => {
  const pieces = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const value = board[r][c];
      if (value === 0) continue;
      const color = value > 0 ? 'WHITE' : 'BLACK';
      const type = Math.abs(value) === 2 ? 'DAME' : 'PION';
      pieces.push([squareOfModelPos({ r, c }), { color, type }]);
    }
  }
  return { pieces, sideToMove: turn === 1 ? 'WHITE' : 'BLACK' };
};

export const createDriverForModelBoard = (board, turn) =>
  new GameDriver(demoJsonFromModelBoard(board, turn));

export const createStandardDriver = () => new GameDriver();

// ─── Driver move (atomic, whole turn) → model-shaped hops (per-step) ───
// A GameDriver/core move is either a pure walk (captured.length === 0,
// path.length === 2) or a pure capture chain (captured.length === path.length - 1,
// hop i captures move.captured[i] — see retire-ai-for-game-driver.md §1.3/core/Legals.mjs). Never
// mixed within one move, so `isCapture` applies uniformly to every hop.
export const expandDriverMoveToModelHops = (move) => {
  const path = move.path && move.path.length > 0 ? move.path : [move.from, move.to];
  const isCaptureChain = move.captured.length > 0;
  const hops = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = modelPosOfPosition(path[i]);
    const to = modelPosOfPosition(path[i + 1]);
    const hop = { fromR: from.r, fromC: from.c, toR: to.r, toC: to.c, isCapture: isCaptureChain };
    if (isCaptureChain) {
      const jumped = modelPosOfPosition(move.captured[i]);
      hop.jumpedR = jumped.r;
      hop.jumpedC = jumped.c;
    }
    hops.push(hop);
  }
  return hops;
};

// ─── Completed human turn (model hops) → driver move (atomic) ───
// Resolves GameDriver's AMBIGUOUS_MOVE (retire-ai-for-game-driver.md §1.5 case 1) by matching the
// accumulated captured-square set against each candidate's captured set —
// always resolvable exactly once, given model/ and core/ agree on rules
// (retire-ai-for-game-driver.md §1.3). If it isn't resolvable, that indicates the two engines
// have diverged; fail loudly rather than silently desyncing the driver.
export const playHumanTurnOnDriver = (driver, { fromSquare, toSquare, capturedSquares }) => {
  try {
    return driver.playMovePosition(fromSquare, toSquare);
  } catch (error) {
    if (error.code !== 'AMBIGUOUS_MOVE') throw error;
    const wanted = [...capturedSquares].toSorted().join(',');
    const match = error.candidates.find(
      ({ move }) =>
        move.captured
          .map((p) => p.toString())
          .toSorted()
          .join(',') === wanted,
    );
    if (!match) {
      throw new Error(
        `GameDriverBridge: no candidate route for ${fromSquare}->${toSquare} matches ` +
          `captured set [${wanted}]. model/ and core/ move generation have diverged.`,
      );
    }
    return driver.playMovePosition(fromSquare, toSquare, match.choice);
  }
};
```

## 4. Rewrite `controller/gameController.mjs`

### 4.1 What's removed

- Imports of `RandomAI`, `GreedyAI`, `MinimaxAI` (deleted along with the
  `ai/` folder in §6).
- The `aiInstances` map and the public `availableAIs` / `getAI` /
  `registerAI` API. Grepped the whole repo (`getAI|registerAI|availableAIs`)
  — nothing outside `controller/gameController.mjs` itself references these,
  so removing them is a clean deletion, not a deprecation.

### 4.2 What's added

- `driver` — a `GameDriver` instance, constructed alongside `state` (same
  demo-vs-standard branch condition as `state`'s own construction) and
  rebuilt alongside `state` in `reset()`/`startGame()`.
- `turnPath` / `turnCaptured` — a turn accumulator _owned by controller_,
  populated per-hop, read once at turn completion to sync `driver`, then
  reset. (Note: `view/gameViewBinder.mjs` already has its own
  `currentTurnPath`/`currentTurnCaptures` for its turn-summary log — that one
  stays untouched and is not reused here. `controller/` must stay
  self-sufficient and not depend on `view/`, which is downstream of it; a
  four-line accumulator duplicated across two decoupled layers is the
  correct amount of duplication, not premature — this project already
  enforces the view/controller boundary with a dedicated test,
  `tests/view/check-view-boundaries.test.mjs`.)
- `applyHop(move)` — the shared per-hop primitive (state mutation + event
  emission only). Used by both the human path and the AI-replay path. Does
  _not_ decide driver-sync or "trigger next AI turn" — callers own that,
  since the two turn sources resolve "what happens after the last hop"
  differently (human path needs a driver sync that the AI path doesn't,
  because the AI path's driver is already ahead).
- `DIFFICULTY_DEPTH = { easy: 1, medium: 4, hard: 8 }` — replaces the old
  `{ easy: 'random', medium: 'greedy', hard: 'minimax' }` name map.
  `state.config.aiDifficulty` keeps the same string keys
  (`model/types.mjs`'s `DEFAULT_CONFIG.aiDifficulty` is untouched); only the
  thing that key maps _to_ changes, and only inside `controller/`.
- `get driver()` on the returned controller object — read-only observability
  for tests/debugging, mirroring the existing `get state()` /
  `get selectedPiece()` pattern. Not consumed by `view/`.

### 4.3 Full target implementation

```js
import { createGameState } from '../model/gameState.mjs';
import {
  createStandardDriver,
  createDriverForModelBoard,
  expandDriverMoveToModelHops,
  playHumanTurnOnDriver,
  squareOfModelPos,
} from './gameDriverBridge.mjs';

// ============================================
// GameController - Orchestrates Model (view-facing state) + GameDriver
// (AI decisions, atomic per-turn) + View
//
// Two live representations of the same game are kept in lockstep:
//   - `state` (model/GameState): drives the view, per-step moves.
//   - `driver` (GameDriver over core/): decides AI turns, atomic per-turn
//     moves. Advanced either directly (AI's own turn) or by replaying an
//     already-completed human turn onto it (see retire-ai-for-game-driver.md §1.4).
//
// reset()/startGame() fully discard and rebuild both `state` and `driver`,
// but a prior AI turn's delay -> aiThinking -> driver.playAiMove() ->
// hop replay chain can still be in flight when that happens. pendingAiAbort
// lets reset()/startGame() cancel that stale chain so it never applies hops
// computed against a driver/state pair that no longer exists.
// ============================================

const DIFFICULTY_DEPTH = { easy: 1, medium: 4, hard: 8 };

const delay = (ms, signal) => {
  const { promise, resolve } = Promise.withResolvers();
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener(
    'abort',
    () => {
      clearTimeout(timer);
      resolve();
    },
    { once: true },
  );
  return promise;
};

const hasCustomBoard = (params) => !!(params && (params.board || params.turn !== undefined));

export const createGameController = (configOrParams) => {
  const initialParams = configOrParams;
  let state = hasCustomBoard(configOrParams)
    ? createGameState(configOrParams)
    : createGameState(configOrParams ? { config: configOrParams } : undefined);
  let driver = hasCustomBoard(configOrParams)
    ? createDriverForModelBoard(configOrParams.board, configOrParams.turn ?? 1)
    : createStandardDriver();

  let selectedPiece = null;
  let isAIProcessing = false;
  let pendingAiAbort = null;
  let turnPath = [];
  let turnCaptured = [];
  const listeners = new Map();

  const resetTurnAccumulator = () => {
    turnPath = [];
    turnCaptured = [];
  };

  const emit = (type, data) => {
    const event = { type, state, data };
    (listeners.get(type) ?? []).forEach((l) => l(event));
    if (type !== 'stateChanged') {
      (listeners.get('stateChanged') ?? []).forEach((l) => l(event));
    }
  };

  const cancelPendingAi = () => {
    if (pendingAiAbort) {
      pendingAiAbort.abort();
      pendingAiAbort = null;
    }
  };

  const off = (event, listener) => {
    const list = listeners.get(event);
    if (!list) return;
    const idx = list.indexOf(listener);
    if (idx !== -1) {
      listeners.set(event, list.toSpliced(idx, 1));
    }
  };

  const on = (event, listener) => {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(listener);
    return () => off(event, listener);
  };

  /** Select a piece (human input) */
  const selectPiece = (pos) => {
    if (!state.canSelectPiece(pos)) {
      if (!state.mustMovePiece) {
        selectedPiece = null;
        emit('pieceSelected', { selected: null });
      }
      return false;
    }
    selectedPiece = pos;
    emit('pieceSelected', { selected: pos, moves: state.getMovesForPiece(pos) });
    return true;
  };

  /** Deselect current piece */
  const deselect = () => {
    if (!state.mustMovePiece) {
      selectedPiece = null;
      emit('pieceSelected', { selected: null });
    }
  };

  /**
   * Apply exactly one model-shaped hop (a single walk, or a single jump of
   * a chain) to `state`, emitting the same events the old single-engine
   * executeMove() did. Shared by the human path and the AI hop-replay
   * loop. Returns whether this hop ended the turn -- callers decide what
   * to do next (sync driver, trigger next AI turn, etc.), since that
   * differs by source (see retire-ai-for-game-driver.md §1.4).
   */
  const applyHop = (move) => {
    const oldState = state;
    state = state.applyMove(move);

    const oldPiece = oldState.board[move.fromR][move.fromC];
    const newPiece = state.board[move.toR][move.toC];
    if (Math.abs(oldPiece) === 1 && Math.abs(newPiece) === 2) {
      emit('promotion', { at: { r: move.toR, c: move.toC } });
    }

    if (state.mustMovePiece) {
      selectedPiece = state.mustMovePiece;
      emit('multiCapture', { lockedPiece: state.mustMovePiece });
    } else {
      selectedPiece = null;
    }

    emit('moveMade', { move, wasCapture: move.isCapture });

    return { turnComplete: !state.mustMovePiece };
  };

  /** Replay the just-completed human turn onto `driver` so it stays in
   *  lockstep and is ready the next time either side needs an AI move. */
  const syncDriverForCompletedHumanTurn = () => {
    const fromSquare = squareOfModelPos(turnPath[0]);
    const toSquare = squareOfModelPos(turnPath[turnPath.length - 1]);
    const capturedSquares = turnCaptured.map(squareOfModelPos);
    playHumanTurnOnDriver(driver, { fromSquare, toSquare, capturedSquares });
  };

  const maybeStartNextAiTurn = async () => {
    if (state.currentPlayerIsAI) {
      await startAiTurn(320);
    }
  };

  /** Execute one hop of a human-driven turn (one click's worth). */
  const executeHumanHop = async (move) => {
    if (turnPath.length === 0) {
      turnPath.push({ r: move.fromR, c: move.fromC });
    }
    turnPath.push({ r: move.toR, c: move.toC });
    if (move.isCapture) {
      turnCaptured.push({ r: move.jumpedR, c: move.jumpedC });
    }

    const { turnComplete } = applyHop(move);
    if (!turnComplete) return;

    syncDriverForCompletedHumanTurn();
    resetTurnAccumulator();

    if (state.status !== 'PLAYING') {
      emit('gameOver', { winner: state.status });
      return;
    }

    await maybeStartNextAiTurn();
  };

  /**
   * Let GameDriver decide and play a full AI turn (one atomic move, possibly
   * a whole multi-capture chain), then replay it onto `state` one hop at a
   * time so the existing per-hop event/animation pipeline is unchanged.
   * `driver` is already advanced by the time this returns from
   * driver.playAiMove(), so no post-loop driver sync is needed here.
   */
  const playAiTurn = async (signal) => {
    isAIProcessing = true;
    emit('aiThinking', { player: state.turn });

    const depth = DIFFICULTY_DEPTH[state.config.aiDifficulty] ?? DIFFICULTY_DEPTH.medium;

    let result;
    try {
      result = driver.playAiMove(depth);
    } catch (err) {
      isAIProcessing = false;
      console.error('AI error:', err);
      return;
    }

    if (signal.aborted) return;
    isAIProcessing = false;

    if (!result.played) return;

    emit('aiMoved', { move: result.move, difficulty: state.config.aiDifficulty, depth });

    const hops = expandDriverMoveToModelHops(result.move);
    for (let i = 0; i < hops.length; i++) {
      if (i > 0) {
        await delay(320, signal);
        if (signal.aborted) return;
      }
      applyHop(hops[i]);
    }

    if (state.status !== 'PLAYING') {
      emit('gameOver', { winner: state.status });
      return;
    }

    await maybeStartNextAiTurn();
  };

  /** Start (and track) the delay -> AI-turn sequence following a move */
  const startAiTurn = async (delayMs) => {
    const abortController = new AbortController();
    pendingAiAbort = abortController;
    const { signal } = abortController;

    if (delayMs > 0) {
      await delay(delayMs, signal);
      if (signal.aborted) return;
    }

    await playAiTurn(signal);
  };

  /** Attempt a move (human input) */
  const attemptMove = async (pos) => {
    if (isAIProcessing) return false;

    if (selectedPiece) {
      const move = state.validMoves.find(
        (m) =>
          m.fromR === selectedPiece.r &&
          m.fromC === selectedPiece.c &&
          m.toR === pos.r &&
          m.toC === pos.c,
      );
      if (move) {
        await executeHumanHop(move);
        return true;
      }
    }

    return selectPiece(pos);
  };

  /** Reset the game */
  const reset = async () => {
    cancelPendingAi();
    selectedPiece = null;
    isAIProcessing = false;
    resetTurnAccumulator();
    if (hasCustomBoard(initialParams)) {
      state = createGameState({ ...initialParams, config: state.config });
      driver = createDriverForModelBoard(initialParams.board, initialParams.turn ?? 1);
    } else {
      state = state.reset();
      driver = createStandardDriver();
    }
    emit('stateChanged', { action: 'reset' });

    if (state.currentPlayerIsAI) {
      await startAiTurn(400);
    }
  };

  /** Update config (e.g., toggle AI players) */
  const updateConfig = (newConfig) => {
    state = state.withConfig(newConfig);
    emit('stateChanged', { action: 'configUpdate' });
  };

  /** Start a new game with specific AI setup */
  const startGame = (newConfig) => {
    cancelPendingAi();
    selectedPiece = null;
    isAIProcessing = false;
    resetTurnAccumulator();
    state = createGameState({ config: newConfig });
    driver = createStandardDriver();
    emit('stateChanged', { action: 'newGame' });

    if (state.currentPlayerIsAI) {
      startAiTurn(0);
    }
  };

  /** Pause active AI processing */
  const pause = () => {
    cancelPendingAi();
    isAIProcessing = false;
  };

  /** Resume AI processing if active player is AI */
  const resume = async () => {
    cancelPendingAi();
    if (state.currentPlayerIsAI && state.status === 'PLAYING') {
      await startAiTurn(0);
    }
  };

  return {
    // ---- State Access ----
    get state() {
      return state;
    },
    get selectedPiece() {
      return selectedPiece;
    },
    get isAIProcessing() {
      return isAIProcessing;
    },
    get driver() {
      return driver;
    },

    // ---- Event System ----
    on,
    off,

    // ---- Game Actions ----
    selectPiece,
    deselect,
    attemptMove,
    reset,
    updateConfig,
    startGame,
    pause,
    resume,
  };
};
```

### 4.4 Why this preserves existing timing/animation/cancellation behavior

- **Between-hop pacing (320ms).** Today, every hop (human or AI) that
  doesn't end the turn falls through to `if (state.currentPlayerIsAI) await
startAiTurn(320)`, which is how an _AI's own_ multi-capture chain gets a
  320ms pause between hops (same player stays "current" so the check keeps
  firing). The new `playAiTurn` computes the whole chain upfront and no
  longer needs that recursive re-trigger — it inserts the same 320ms
  `delay` directly between hops in its own loop (skipped before the first
  hop, since the _lead-in_ delay before this turn started already came from
  whichever `startAiTurn(delayMs)` call invoked it — 320ms after a human
  move, 400ms after `reset()`, 0ms after `startGame()`, exactly as today).
- **Human's own multi-capture chain.** `executeHumanHop` returns immediately
  after a mid-chain hop (`!turnComplete`) without touching `driver` or
  triggering anything — identical outcome to today's code (which falls
  through to a `currentPlayerIsAI` check that's `false` for a human,
  hence a no-op), just expressed as an explicit early return instead of a
  falsy branch.
- **Cancellation safety.** `driver.playAiMove()` (like the old
  `analyzer`-free `ai.makeMove()`) is a synchronous, non-cancelable
  computation once started — same limitation as before, not a regression.
  Because JS is single-threaded, `reset()`/`startGame()` can only ever run
  either _before_ `playAiTurn` starts (caught by the existing
  `signal.aborted` check before the lead-in delay elapses) or _after_
  `driver.playAiMove()` fully returns (there's no `await` point during the
  synchronous search for a concurrent `reset()` to interleave into) — so
  `driver` can never be left half-updated by a race. If a `reset()` happens
  _during_ the hop-replay loop (between two `await delay(320, signal)`
  calls), `state` may be left mid-chain, but `reset()` unconditionally
  reassigns both `state` and `driver` wholesale immediately afterward, so
  the partial progress is simply discarded, not repaired — same as today's
  behavior when `reset()` interrupts a human or AI mid-chain.
- **Depth-8 search latency.** `core/Analyzer.mjs`'s `Analyzer` (negamax +
  alpha-beta + a forced-capture quiescence extension) at depth 8 counts 8
  plies at _atomic-turn_ granularity (a whole capture chain is one ply),
  which is a meaningfully deeper/more expensive search than the old
  `MinimaxAI`'s depth-4 _per-step_ search with a simpler heuristic. This is
  not being silently substituted — it's what the user specified — but budget
  time in §7 to benchmark it on a representative mid-game position and
  confirm the search completes in an acceptable window before calling this
  phase done. If it's too slow, that's a finding to report back, not a
  reason to unilaterally change the depth values.

## 5. `view/` changes: difficulty labels only

`view/components/control-panel/controlPanelView.mjs`, lines 8–12. Current:

```js
const DIFFICULTY_OPTIONS = Object.freeze([
  { key: 'easy', label: 'สุ่ม', description: 'Random' },
  { key: 'medium', label: 'ฉลาด', description: 'Greedy' },
  { key: 'hard', label: 'Minimax', description: 'Alpha-Beta' },
]);
```

New:

```js
const DIFFICULTY_OPTIONS = Object.freeze([
  { key: 'easy', label: 'หัดเล่น', description: 'คิดลึกระดับ 1' },
  { key: 'medium', label: 'เก่ง', description: 'คิดลึกระดับ 4' },
  { key: 'hard', label: 'เซียน', description: 'คิดลึกระดับ 8' },
]);
```

`key` values are unchanged (`'easy'/'medium'/'hard'`) — they're the
`aiDifficulty` config value stored by `model/types.mjs` and read by
`controller/gameController.mjs`'s new `DIFFICULTY_DEPTH` map, so nothing
else needs to change for this. `label` renders on the button's first line,
`description` on the second (`view/html/surfaces/htmlControlPanelSurface.mjs`
lines 166–173 render both as plain `textContent` with no auto-wrapping —
the final wording is stored literally in each `description`, as shown above).
No other file in `view/` references difficulty text (confirmed via
`grep -rli "difficulty\|หัดเล่น\|กลาง\|ยาก\|easy\|medium\|hard"` across
`view/`, `controller/`, `model/` — only `controlPanelView.mjs` has
human-facing difficulty strings).

## 6. Delete `ai/`

Delete the entire `ai/` directory (`AIInterface.mjs`, `RandomAI.mjs`,
`GreedyAI.mjs`, `MinimaxAI.mjs`, `Heuristic.mjs`). Confirmed via
`grep -rln "from '.*ai/"` across the whole repo that
`controller/gameController.mjs` is the _only_ file that imports from `ai/`
— once §4's rewrite removes those imports, nothing references the folder
and it can be deleted outright with no dangling references, no compatibility
shim needed. Update `README.md` in the same phase: replace the legacy
Random/Greedy/Minimax difficulty table with Analyzer depths 1/4/8, remove the
deleted `ai/` tree from the project structure, and document `core/`,
`cli/GameDriver.mjs`, and `controller/gameDriverBridge.mjs` so the public
architecture description does not advertise deleted code.

## 7. Testing

### 7.0 Do this first: validate and align the core assumption

Before touching `controller/`, add a parity test that drives `model/` and
`core/` through the same fixture games and asserts they land on equivalent
boards at every ply. This turns §1.3's spot-check into a standing regression
guard, and — because the whole bridge design depends on the two engines
agreeing — it's the cheapest place to find out early if some rule actually
doesn't match.

New file: `tests/controller/model-core-parity.test.mjs`. Because implementation
order deliberately puts this test before the production bridge in §3, define
the small coordinate/board/move-expansion helpers locally in the test at
first. In phase 3, replace those local copies with imports from
`gameDriverBridge.mjs`; the assertions and fixture coverage must remain the
same. This resolves the previous circular ordering where phase 1 required a
file that phase 3 had not created yet.

- For each of `examples/demos/demo{1,2,3,4}.json` and the standard opening
  position: build a `model/GameState` (via the same JSON→board conversion
  `main.mjs`/`smoke-game-flow.test.mjs` already use) and a `GameDriver` from
  the same starting position. Use `new GameDriver()` for the standard opening
  so the test compares the engines' actual standard setup paths.
- Drive both forward turn-by-turn with a deterministic move-selection rule
  (e.g. always the lowest-index legal move on each side) for several turns
  (or to game end for the shorter demo fixtures), applying each turn to
  `model/` hop-by-hop (via `expandDriverMoveToModelHops` fed from the
  _driver's_ chosen move, so both engines are told to play "the same" move)
  and to `driver` via `playMoveIndex`.
- After each turn, assert the two boards describe the same position: for
  every square, `model` board value's color/type must match the piece (if
  any) at the corresponding `core` `Position` (via
  `modelPosOfPosition`/`positionOfModelPos`), and `state.turn`/`driver`'s
  `player()` must agree (via `pieceColorOfTurn`/`turnOfPieceColor`).

The first red run is recorded in §1.3.1. Apply exactly the two alignment
repairs specified there, rerun this test, then run the entire `npm test`
suite. Phase 1 is complete only when both are green. If any failure remains,
stop and re-examine §1.3–§1.3.1 before proceeding — the bridge design in
§3–4 is not safe to build on top of an unconfirmed assumption.

### 7.1 `controller/gameDriverBridge.mjs` unit tests

New file: `tests/controller/GameDriverBridge.test.mjs`.

- Coordinate round-trip: `modelPosOfPosition`/`positionOfModelPos` and
  `squareOfModelPos`/`modelPosOfSquare` for corner and center squares,
  cross-checked against the known values from §1.3 (`{r:4,c:4}` ⇄ `'E4'`,
  `{r:0,c:0}` ⇄ `'A8'`, `{r:7,c:7}` ⇄ `'H1'`).
- `demoJsonFromModelBoard`: build a small model board, convert it, feed it
  into `new GameDriver(...)`, and assert the resulting `driver.getState()`
  has the right `player` and piece placement at a few spot-checked squares.
- `expandDriverMoveToModelHops`: construct a real `core/Game` over a small
  custom board with a known 2-hop capture chain, call `getMoves()`, pick
  that move, expand it, and assert the hop array's length, `isCapture`,
  `jumpedR/jumpedC`, and `fromR/fromC/toR/toC` values are exactly right.
- `playHumanTurnOnDriver`, using `examples/demos/demo1.json` (same fixture
  as §1.3): calling it with `{fromSquare:'E4', toSquare:'E8',
capturedSquares:['D7','D5']}` (deliberately unsorted, to test the
  sort-before-compare) must resolve to route 1 (path `E4→C6→E8`); calling it
  with route 2's captured set must resolve to route 2. A captured-square set
  matching neither candidate must throw the "diverged" error from §3.

### 7.2 `controller/gameController.mjs` integration tests

New file: `tests/controller/GameControllerDriverSync.test.mjs`.

- Reuse `demo1.json` exactly as `tests/view/smoke-game-flow.test.mjs`
  already does: build a controller over demo1's board/turn (human-vs-human
  config), play `{r:4,c:4}→{r:2,c:2}` then `{r:2,c:2}→{r:0,c:4}` via
  `selectPiece`/`attemptMove`, then assert `controller.driver.history()`
  recorded exactly one move with `path.map(toString) ===
['E4','C6','E8']` and `captured.map(toString) === ['D5','D7']` — i.e. the
  human's clicked route was correctly disambiguated and applied to `driver`.
- A PvE smoke case: same demo1 setup but with `blackIsAI: true,
aiDifficulty: 'easy'` (depth 1); after White's human turn completes,
  assert Black's AI turn is played automatically (turn returns to White,
  no exception thrown, `controller.driver`'s position matches
  `controller.state`'s position via the same per-square comparison as
  §7.0's parity test).
- A no-`ai/`-folder regression check: assert `ai/` does not exist on disk
  and that `controller/gameController.mjs`'s source contains no
  `from '../ai/` import — encodes this migration's completion criterion as
  an automated check, in the same spirit as
  `tests/view/check-view-boundaries.test.mjs`.

### 7.3 Full regression pass

- `npm test` — every suite (`tests/cli/**`, `tests/view/**`,
  `tests/controller/**`) must pass.
- Manually run `node examples/analyzer-vs-Analyzer.mjs` and
  `node examples/analyzerVsDumber.mjs` to confirm the `cli/` split didn't
  break these (they weren't touched, but they import from `cli/cli.mjs`, so
  confirm those re-exports actually work end to end, not just under Jest).
- Serve the repository with a static HTTP server (no build step, per README),
  open `index.html` in a browser, and
  manually verify: a full human-vs-human game; a human-vs-AI game at each of
  the three difficulty levels (confirm the new หัดเล่น/เก่ง/เซียน labels and
  depth-N subtitles render correctly); an AI-vs-AI game (confirm multi-capture
  chains still animate hop-by-hop with visible pacing, not instantly); no
  console errors (the `#elog` overlay in `index.html` surfaces uncaught
  errors — watch it especially for any `node:` module-resolution failures,
  which would indicate a stray import slipped into the browser-loaded
  module graph from `cli/cli.mjs` instead of `cli/GameDriver.mjs`).
- Benchmark: time `driver.playAiMove(8)` on a representative mid-game
  position (e.g. 8–10 turns into a self-played game). Note the duration. If
  it regularly takes more than a couple of seconds, report this back — it's
  a finding, not something to silently work around by changing the
  requested depth values.

Final-regression findings (2026-07-11):

- A stock Chrome `file://` launch blocks `main.mjs` before execution because
  module scripts are subject to CORS. Loading the unchanged app through a
  local static HTTP server succeeds with no application console errors; the
  README and this smoke-test instruction were corrected accordingly.
- Three deterministic 10-ply midgame samples at depth 8 took 5.16s, 4.45s,
  and 6.49s (132k–190k analyzed nodes). This consistently exceeds the
  "couple of seconds" threshold and is reported as a performance finding;
  the requested easy/medium/hard depths remain unchanged at 1/4/8.

## 8. Implementation order

1. §7.0 + §1.3.1 — add the parity test, retain the documented red-run
   evidence, apply the minimal promotion-row and standard-board alignment
   repairs, and require both the parity test and full `npm test` to pass.
2. §2 — split `cli/cli.mjs` → `cli/GameDriver.mjs`; verify per §2.4.
3. §3 — `controller/gameDriverBridge.mjs` + §7.1 unit tests; refactor §7.0
   to import the production bridge helpers instead of its temporary local
   copies, without changing its assertions.
4. §4 — rewrite `controller/gameController.mjs`.
5. §5 — `view/` difficulty label text.
6. §6 — delete `ai/`.
7. §7.2 — controller integration tests.
8. §7.3 — full regression pass, including the manual browser smoke test and
   the depth-8 benchmark.

Each numbered step should be independently committable and independently
testable (`npm test` should pass after every one of them, not just at the
end) — this keeps a bisectable trail if something in the full regression
pass surfaces a problem.
