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
  DOMView.mjs              DOM view — minimal diff/patch rendering
  game.css                 Animations and utility classes
  icons/                   SVG source files (crown, bot, user, restart, info)
  templates/
    shell.mjs              Main layout HTML template
    status.mjs             Status bar HTML template
    setup.mjs              Setup panel HTML template + MODES constant
    board.mjs              Board partials (coordLabel, moveDot, rippleInner)
```

---

## Architecture

```
┌─────────────┐    events     ┌─────────────┐
│  DOMView    │◄──────────────│GameController│
│  (view)     │               │ (controller) │
└─────────────┘               └──────┬───────┘
                                     │
                              ┌──────▼───────┐
                              │  GameState   │
                              │  MoveEngine  │
                              │   (model)    │
                              └──────────────┘
```

- **Model** — pure functions, immutable state, no DOM dependencies
- **Controller** — owns AI instances, emits typed events (`moveMade`, `gameOver`, `aiThinking`, …)
- **View** — subscribes to controller events, diffs view state, patches DOM minimally

---

## Technical Highlights

- **ES2025** throughout — private class fields (`#`), `Promise.withResolvers()`, `Object.groupBy()`, `Array.toSorted()`, `structuredClone()`, `Array.flat().reduce()`
- **Zero dependencies** — no npm packages, no build tools
- **SVG sprite** — icons defined as `<symbol>` in `index.html`, referenced via `<use href="#icon-*">`
- **Tailwind CSS** via CDN (development only)

---

## License

Copyright (C) 2026 Arayaphong Traisopon

This program is licensed under the GNU General Public License v3.0. See [LICENSE](LICENSE) for details.
