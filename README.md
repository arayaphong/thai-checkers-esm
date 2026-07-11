# หมากฮอสไทย — Thai Checkers

A browser-based Thai Checkers game built with **pure ES2025 modules** — no framework, no bundler, no build step. Serve the project directory with any static HTTP server and play.

**Version:** 0.0.1

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

core/                       Atomic-move rules and Analyzer search engine

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
  components/                    Semantic board/status/control-panel views
  intent/                        Actor/action/intent flow for user interaction
  html/                          DOM surfaces, templates, element registry, CSS maps
    templates/             Main layout and board HTML fragments
    surfaces/              HTML implementations behind semantic view methods
    styles/                Real CSS class mappings owned by the HTML layer
tests/
  check-view-boundaries.test.mjs  Jest test for semantic view boundaries
  smoke-game-flow.test.mjs        Jest tests for game-flow smoke coverage
jest.config.mjs                   Jest config for ESM .mjs tests
```

---

## Architecture

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
  `gameOver`, `aiThinking`, …)
- **Semantic view** — uses user-facing methods like `hintTargetSquares()` and `showAiThinking()`, with no DOM API, selectors, datasets, or CSS class names
- **HTML adapter** — owns DOM operations, templates, event delegation, element lookup, and CSS class maps under `view/html/**`
- **Intent flow** — converts UI events into actor/action/intent objects before dispatching controller commands

Run the boundary check after view changes:

```bash
npm run check:view-boundaries
```

Run the game-flow smoke checks after behavior-affecting changes:

```bash
npm run smoke:game-flow
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
