# หมากฮอสไทย — Thai Checkers

A browser-based Thai Checkers game built with **pure ES2025 modules** — no framework, no bundler, no build step. Open `index.html` and play.

**Version:** 0.0.1

---

## How to Play

Open `index.html` directly in any modern browser (Chrome, Firefox, Edge).

### Rules

- **White moves first**
- Pieces move diagonally forward
- **Forced capture** — if a capture is available, you must take it
- **Chain capture** — if a piece can continue capturing after a jump, it must
- A piece reaching the opposite back row is **promoted to Dame** (moves in all 4 diagonal directions, any distance)

### Modes

| Mode | Description |
|---|---|
| ⚪ Player vs ⚫ Player | Two human players on the same screen |
| ⚪ Player vs ⚫ AI | Human plays white, AI plays black |
| ⚪ AI vs ⚫ Player | AI plays white, human plays black |
| ⚪ AI vs ⚫ AI | Watch two AIs play |

### AI Difficulty

| Level | Algorithm | Description |
|---|---|---|
| สุ่ม (Easy) | `RandomAI` | Picks a random valid move |
| ฉลาด (Medium) | `GreedyAI` | 1-ply + opponent reply sampling with board heuristics |
| Minimax (Hard) | `MinimaxAI` | Alpha-beta pruning, 4-ply lookahead, move ordering |

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
  GameController.mjs       Orchestrates model + AI + view via event emitter

ai/
  AIInterface.mjs          Abstract base class for all AI strategies
  RandomAI.mjs             Random move selection
  GreedyAI.mjs             1-ply greedy + opponent response check
  Heuristic.mjs            Board evaluation (material, position, mobility)
  MinimaxAI.mjs            Alpha-beta minimax, depth 4

view/
  GameView.mjs             Semantic facade for the whole visible game UI
  GameViewBinder.mjs       Subscribes to controller events and refreshes GameView
  GameViewStateFactory.mjs Translates controller/model state into display state
  css/                     Stylesheets and Tailwind build input/output
    game.css               Animations and small project utility classes
    tailwind-input.css     Tailwind CLI input
    tailwind.css           Generated Tailwind stylesheet
  icons/                   SVG source files (crown, bot, restart, info)
  components/              Semantic board/status/control-panel views
  intent/                  Actor/action/intent flow for user interaction
  html/                    DOM surfaces, templates, element registry, CSS maps
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
- **Controller** — owns AI instances, emits typed events (`moveMade`, `gameOver`, `aiThinking`, …)
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
