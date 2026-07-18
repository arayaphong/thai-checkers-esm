# หมากฮอสไทย — Thai Checkers

A browser-based Thai Checkers game built with **pure ES2025 modules** — no framework, no bundler, no build step. Serve the project directory with any static HTTP server and play.

**App version:** 1.0.0 (`package.json` version: 1.0.0)

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

| Level   | Algorithm  | Description                |
| ------- | ---------- | -------------------------- |
| หัดเล่น | `Analyzer` | Atomic-turn search depth 1 |
| เก่ง    | `Analyzer` | Atomic-turn search depth 4 |
| เซียน   | `Analyzer` | Atomic-turn search depth 8 |

### AI Engine (optional)

AI moves normally run in a Web Worker (see [docs/worker.md](docs/worker.md)).
You can instead point analysis at a separate engine process over WebSocket —
opt-in only, and off by default:

```bash
npm run server              # starts the reference engine on ws://localhost:8787
```

| Entry point | Flag                         | Effect                                              |
| ----------- | ---------------------------- | ---------------------------------------------------- |
| Browser     | `?ws=8787`                   | Use the WS engine at `localhost:8787` for AI moves   |
| CLI         | `node cli/cli.mjs -ws 8787`  | Same, for the REPL's `ai` command                    |

If the configured engine is unreachable, that turn fails with an error
instead of silently falling back to the Worker/local analysis. See
[docs/ws-engine.md](docs/ws-engine.md) for the full behavior and
[docs/ws-engine-api-spec.md](docs/ws-engine-api-spec.md) if you want to
implement your own compatible engine.

---

## Project Structure

```
index.html                 Entry point — loads sprite, CSS, and main.mjs
main.mjs                   Bootstrap — connects controller to view

model/
  types.mjs                Constants: INITIAL_BOARD, DEFAULT_CONFIG
  moveEngine.mjs           Pure move generation & validation (no state)
  gameState.mjs            Immutable game state — all updates return new instances

controller/
  gameController.mjs       Keeps model state and GameDriver in sync
  gameDriverBridge.mjs     Translates model positions/hops and atomic core moves
  aiMoveChannel.mjs        Serializable, non-mutating AI analysis boundary
  WorkerGameDriver.mjs     Main-thread proxy for the AI worker
  WsGameDriver.mjs         Main-thread proxy for the optional WS AI engine

core/                       Atomic-move rules and Analyzer search engine

worker/
  gameDriverWorker.mjs     Web Worker / worker_threads script that runs AI analysis

server/
  gameDriverServer.mjs     Optional dev WebSocket server hosting a pluggable AI engine

cli/
  GameDriver.mjs           Browser-safe adapter over core game and Analyzer
  cli.mjs                  Node-only terminal REPL

view/
  gameView.mjs                   Semantic facade for the whole visible game UI
  gameViewBinder.mjs             Subscribes to controller events and refreshes GameView
  gameViewStateFactory.mjs       Translates controller/model state into display state
  gameViewAnimationLifecycle.mjs Tracks active move animation (begin/wait/cancel)
  css/                           Stylesheets and Tailwind build input/output
    game.css               Animations and small project utility classes
    tailwind-input.css     Tailwind CLI input
    tailwind.css           Generated Tailwind stylesheet
  icons/                         SVG source files (crown, bot, restart, info)
  components/                    Control-panel presentation logic
  uiCommandDispatcher.mjs       Plain UI-command dispatcher
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
  search. An optional, opt-in WS AI engine (`WsGameDriver`, see
  [docs/ws-engine.md](docs/ws-engine.md)) can be configured instead, with an
  open protocol third parties can implement their own engine against.
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
- **Runtime zero dependencies** — no framework or bundler; Jest, Tailwind CLI, and `ws` (used only by the optional `server/gameDriverServer.mjs`) are development-only tooling
- **SVG sprite** — icons defined as `<symbol>` in `index.html`, referenced via `<use href="#icon-*">`
- **Tailwind CSS** compiled to `view/css/tailwind.css`

---

## License

Copyright (C) 2026 Arayaphong Traisopon

This program is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
