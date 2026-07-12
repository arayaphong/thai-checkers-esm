# หมากฮอสไทย — Thai Checkers

A browser-based Thai Checkers game built with **pure ES2025 modules** — no framework, no bundler, no build step. Serve the project directory with any static HTTP server and play.

**App version:** 0.0.1 (`package.json` version: 1.0.0)

---

## How to Play

ES module scripts are blocked by browser CORS rules when loaded from `file://`.
Start a local static server from the project directory, then open
<http://localhost:8000>:

```bash
python3 -m http.server 8000
```

### Rules

- **White moves first**
- Pieces move diagonally forward
- **Forced capture** — if a capture is available, you must take it
- **Chain capture** — if a piece can continue capturing after a jump, it must
- A piece reaching the opposite back row is **promoted to Dame** (moves in all 4 diagonal directions, any distance)

### Modes

| Mode                   | Description                          |
| ---------------------- | ------------------------------------ |
| ⚪ Player vs ⚫ Player | Two human players on the same screen |
| ⚪ Player vs ⚫ AI     | Human plays white, AI plays black    |
| ⚪ AI vs ⚫ Player     | AI plays white, human plays black    |
| ⚪ AI vs ⚫ AI         | Watch two AIs play                   |

### AI Difficulty

| Level     | Algorithm  | Description                |
| --------- | ---------- | -------------------------- |
| ง่าย      | `Analyzer` | Atomic-turn search depth 1 |
| พอสู้ได้  | `Analyzer` | Atomic-turn search depth 4 |
| ไม่ยอมแพ้ | `Analyzer` | Atomic-turn search depth 8 |

---

## Project Structure

```
index.html                 Entry point — loads sprite, CSS, and main.mjs
main.mjs                   Bootstrap — connects controller to view

model/
  Types.mjs                Constants: INITIAL_BOARD, DEFAULT_CONFIG
  MoveEngine.mjs           Pure move generation & validation (no state)
  GameState.mjs            Immutable game state — all updates return new instances

controller/
  GameController.mjs       Keeps model state and GameDriver in sync
  GameDriverBridge.mjs     Translates model positions/hops and atomic core moves
  AiMoveChannel.mjs        Serializable, non-mutating AI analysis boundary
  WorkerGameDriver.mjs     Main-thread proxy for the AI worker

core/                       Atomic-move rules and Analyzer search engine

worker/
  GameDriverWorker.mjs     Web Worker / worker_threads script that runs AI analysis

cli/
  GameDriver.mjs           Browser-safe adapter over core game and Analyzer
  cli.mjs                  Node-only terminal REPL

view/
  GameView.mjs                   Semantic facade for the whole visible game UI
  GameViewBinder.mjs             Subscribes to controller events and refreshes GameView
  GameViewStateFactory.mjs       Translates controller/model state into display state
  GameViewAnimationLifecycle.mjs Tracks active move animation (begin/wait/cancel)
  css/                           Stylesheets and Tailwind build input/output
    game.css               Animations and small project utility classes
    tailwind-input.css     Tailwind CLI input
    tailwind.css           Generated Tailwind stylesheet
  icons/                         SVG source files (crown, bot, restart, info)
  components/                    Control-panel presentation logic
  UiCommandDispatcher.mjs       Plain UI-command dispatcher
  html/                          DOM surfaces, templates, element registry, CSS maps
    templates/             Main layout HTML fragment
    surfaces/              HTML implementations behind semantic view methods
    styles/                Real CSS class mappings owned by the HTML layer
tests/
  view/check-view-boundaries.test.mjs  Semantic view boundary checks
  view/smoke-game-flow.test.mjs        Game-flow smoke coverage
jest.config.mjs                   Jest config for ESM .mjs tests
```

---

## Architecture

See [the concise view architecture](docs/view.md) for the browser UI flow and boundaries.

```
┌────────────────────┐   events   ┌────────────────┐
│   GameViewBinder   │◄───────────│ GameController │
└─────────┬──────────┘            └───────┬────────┘
          │                                │
          ▼                                ▼
┌────────────────────┐            ┌────────────────┐
│      GameView      │            │   GameState    │
│ semantic facade    │            │   MoveEngine   │
└─────────┬──────────┘            │     model      │
          │                       └────────────────┘
          ▼
┌────────────────────┐
│  view/html/**      │
│ DOM/CSS adapters   │
└────────────────────┘
```

- **Model** — pure functions, immutable state, no DOM dependencies
- **Controller** — keeps view-facing model state synchronized with the atomic
  `GameDriver` used for AI decisions, and emits typed events (`moveMade`,
  `gameOver`, `aiThinking`, …). AI analysis is offloaded to a Web Worker via
  `WorkerGameDriver` / `AiMoveChannel` so the UI remains responsive during
  search.
- **Semantic view** — coordinates display state and move animations without DOM APIs, selectors, datasets, or CSS class names
- **HTML adapter** — owns DOM operations, templates, event delegation, element lookup, and CSS class maps under `view/html/**`
- **UI command flow** — converts delegated clicks directly into plain `{ type, ...payload }` commands before controller dispatch

Run the boundary check after view changes:

```bash
npm test -- --runTestsByPath tests/view/check-view-boundaries.test.mjs
```

Run the game-flow smoke checks after behavior-affecting changes:

```bash
npm test -- --runTestsByPath tests/view/smoke-game-flow.test.mjs
```

Run the full Jest suite:

```bash
npm test
```

---

## Technical Highlights

- **ES2025** throughout — private class fields (`#`), `Promise.withResolvers()`, `Object.groupBy()`, `Array.toSorted()`, `structuredClone()`, `Array.flat().reduce()`
- **Runtime zero dependencies** — no framework or bundler; Jest and Tailwind CLI are development-only tooling
- **SVG sprite** — icons defined as `<symbol>` in `index.html`, referenced via `<use href="#icon-*">`
- **Tailwind CSS** compiled to `view/css/tailwind.css`

---

## License

MIT
