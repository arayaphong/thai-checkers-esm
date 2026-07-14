# WebSocket-based pluggable AI engine

## Context

Today `GameDriver#playAiMove` (`cli/GameDriver.mjs`) always runs locally: `controller/gameController.mjs` calls `requestAiMove()` in `controller/aiMoveChannel.mjs`, which always routes through `controller/WorkerGameDriver.mjs` → `worker/gameDriverWorker.mjs` (a Web Worker / `worker_threads` script that builds a fresh `GameDriver(session)` per request and runs `playAiMove` synchronously inside it). This offload exists purely to keep the UI thread responsive (see `docs/worker.md`, `archived-plans/offload-game-driver-to-worker.md`).

The user wants to be able to point AI analysis at a separate AI engine implementation running behind a small Node WebSocket server, instead of always using the built-in Worker — so the engine can be upgraded/replaced independently of the deployed static site (restart the server, restart/reload the client with the same flag, get different AI behavior — no client rebuild). This is *not* about multiplayer (confirmed with the user) — the server stays stateless per request, exactly like the worker today.

Two corrections the user made while reviewing this plan, both incorporated below:
1. **Opt-in, and failure is loud, not silent.** With no WS engine configured, nothing changes at all — the app never attempts a WS connection, and behaves 100% identically to today (Worker only). Only when the user explicitly points at an engine does the app try to use it; if that engine is unreachable, it's a hard error surfaced through existing error-handling paths, not a silent fallback to local analysis. ("if ws is specified and it doesn't work, just give an error.")
2. **No live runtime hot-swap API.** An earlier version of this plan added a `globalThis.game.aiEngine` console API and a mutable CLI `ws <port>`/`ws off` command so the engine could be switched mid-session without a reload/restart. The user explicitly said not to build that ("ไม่ต้องเขียนให้มันเป็น hotswap แล้ว" — no need to write it as hot-swap anymore). Configuration is one-shot at startup: a URL param for the browser, a CLI flag for the REPL. Changing which engine is used means changing that flag/param and reloading/restarting — that's acceptable.

The user originally pointed at `cli/GameDriver.mjs` and `controller/gameDriverBridge.mjs` by name, but neither needs to change: `GameDriver.mjs` is reused as-is by the new server (same way the worker reuses it today), and `gameDriverBridge.mjs` never touches AI dispatch at all (it only does model↔core coordinate translation and constructs the local synchronous driver — out of scope). The real insertion point is the existing `aiMoveChannel` / `WorkerGameDriver` boundary. Full-driver remoting (move validation, undo/redo, save/load over the wire) is a distinct future phase, same as `docs/worker.md`'s own "Further Considerations #1" already flags for full-driver-to-worker offload — not part of this change.

Confirmed constraints from exploration:
- No config/env convention exists anywhere in the repo (no `.env*`, no `process.env`/`import.meta.env` usage, no bundler/build step). This is the first config knob.
- README states "Runtime zero dependencies — ... Jest and Tailwind CLI are development-only tooling." Node 22 has a native client `WebSocket` global (confirmed via `typeof WebSocket === 'function'`) usable in both browser and Node with zero new dependency. Node has **no** built-in WebSocket *server*, so the new server needs the `ws` package — added as a **devDependency**, imported only by the new opt-in `server/` script, never by browser-reachable code. This matches the existing Jest/Tailwind precedent exactly.
- The existing `{id, type:'playAiMove', session, depth}` → `{id, result:{played, matchIndex, moveKey, score, nodes, elapsedMs}}` / `{id, error}` protocol (already proven clone-safe via `tests/controller/aiMoveChannel.test.mjs`'s `isCloneSafeDto`) is reused verbatim, just over a different transport.
- Full driver-call-site inventory confirms nothing else depends on this path: `cli/cli.mjs`, `tests/cli/gameDriver.test.mjs`, `examples/analyzerVsAnalyzer.mjs`, `examples/analyzerVsDumber.mjs` all use `GameDriver` directly/synchronously and are unaffected.
- `main.mjs` already has precedent (`getDemoParam()`, main.mjs:10-19) for reading a config flag from the URL — the new `ws` param reuses `URLSearchParams` the same way `main.mjs` already imports/uses `fetch`/`window.location`, just scoped to the query string only (simpler than `getDemoParam`'s multi-format query/hash/path handling — see §4).

## Implementation phases

This plan is saved to the repo as `PLAN.md` at the start of implementation (before Phase 1) so progress can be tracked directly against it in git, and updated (checked off / amended) as each phase lands. Each phase below is independently shippable and testable before the next one starts; later phases depend on earlier ones but not vice versa.

**Phase 1 — Protocol foundation (no app wiring yet)** — [ ] not started
Build and prove the WS engine protocol in isolation, without touching any existing game code.
- `controller/WsGameDriver.mjs` (new) — §1
- `server/gameDriverServer.mjs` (new) — §2
- `package.json` — §6 (`ws` devDependency, `server` script)
- `tests/controller/wsGameDriver.test.mjs` (new) — §7
- Verify: `npm test` (new file only needs to pass in isolation); `npm run server` starts and logs a listening URL.

**Phase 2 — Browser integration (opt-in wiring)** — [ ] not started
Wire the protocol into the live game, opt-in only, with zero behavior change for anyone who doesn't use it.
- `controller/aiMoveChannel.mjs` (modify) — §3
- `main.mjs` (modify) — §4's browser half (`getWsParam()`)
- Verify: full existing suite still passes unchanged (`aiMoveChannel.test.mjs`, `gameControllerDriverSync.test.mjs`, `gameControllerTurnPacing.test.mjs` need zero edits — that's the regression signal); manual browser check per Verification §2-3 below.

**Phase 3 — CLI integration** — [ ] not started
Same opt-in/hard-error treatment for the Node REPL.
- `cli/cli.mjs` (modify) — §4's CLI half + §5
- `tests/cli/cliWsFlag.test.mjs` (new) — §7
- Verify: manual REPL check per Verification §4 below.

**Phase 4 — Vendor-facing spec & conformance tooling** — [ ] not started
Make the protocol implementable by third parties, not just readable from this repo's source.
- `docs/ws-engine-api-spec.md` (new) — §8
- `examples/checkWsEngineConformance.mjs` (new) — §8
- Verify: run the conformance checker against Phase 1's own reference server (dogfooding) per Verification §5 below.

**Phase 5 — Documentation & polish** — [ ] not started
- `docs/ws-engine.md` (new) — §9
- `README.md` updates — §9
- Final full-suite pass: `npm test` and `npm run lint` per Verification §6 below.

## Approach

### 1. `controller/WsGameDriver.mjs` (new)

Same module-level-shared-connection shape as `WorkerGameDriver.mjs` (`pending` Map keyed by request id, shared singleton, `terminate()` / static `terminate()`), but using the native `WebSocket` global directly — no browser/Node constructor shim needed, unlike the Worker proxy.

Exports `WsGameDriver`, `WsEngineUnreachableError`, and `wsPortUrl`.

```js
export const wsPortUrl = (port) => `ws://localhost:${port}`;
```

- `WsEngineUnreachableError` is thrown for *pre-flight* failures — handshake timeout, `error`/`close` before `open`, or a malformed URL (`new WebSocket(url)` throwing synchronously). Once a socket reaches `open`, any later failure (server-side error, mid-flight `close`/`error`) rejects the pending request with a plain `Error`, mirroring the Worker's `onerror`/`onclose` behavior. Nothing catches these to branch on (see §3) — the distinct class exists purely so the error message reaching the console/REPL clearly says "couldn't reach the engine" vs. "the engine reported a failure."
- **Connect timeout: 400ms**, guarding only the handshake — never the analysis wait itself (parity with the Worker path, which has no analysis timeout; depth-8 search can legitimately take seconds).
- Socket is a shared module-level singleton, reused across successive `playAiMove` calls once connected (same reuse rationale as `sharedWorker`). Opened lazily on first use, torn down by `terminate()`.
- **Abort semantics: full parity with `WorkerGameDriver`.** The server's `playAiMove` call is synchronous/CPU-bound either way (can't be cancelled mid-flight over the wire any more than a worker thread can today), so on abort, `playAiMove` calls `this.terminate()` — same behavior, same `Error('Aborted')` rejection shape. The existing `if (!entry) return;` dead-letter guard in the message handler safely drops any late response for an already-terminated/reconnected id.
- Constructor takes `{session, url}` — `url` is required (no default); production call sites always pass one because §3 only constructs this class when one is configured.
- On the connection socket, once `open`, attach `close`/`error` listeners that reject all pending requests with a plain `Error` (mirrors Worker's `attachMessageHandler`). Server-side, after bind: also attach a per-connection `socket.on('error', ...)` no-op/log handler — an unhandled `'error'` event on a `ws` socket can crash the Node process, so every connection needs one even though the client only calls `.close()` on abort.

### 2. `server/gameDriverServer.mjs` (new)

```js
import { WebSocketServer } from 'ws';
import { GameDriver } from '../cli/GameDriver.mjs';

export const createGameDriverServer = ({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) => ...
```

- Exports `createGameDriverServer({port, host})` returning a Promise that resolves once actually listening (`ws`'s internal HTTP server binds asynchronously, so `wss.address()` is `null` until the `'listening'` event fires) with `{ url(), address(), close() }`. Tests pass `port: 0` for an OS-assigned ephemeral port and read it back via `server.url()`.
- `wss.once('error', reject)` registered *before* `'listening'` so a bind failure (e.g. `EADDRINUSE`) rejects the factory promise instead of hanging it forever. After listening, attach a persistent `wss.on('error', ...)` log handler so later server-level errors don't crash the process.
- Message handler is a near-verbatim copy of `worker/gameDriverWorker.mjs`'s: same request/response shapes, same `new GameDriver(session).playAiMove(depth)` call. Two additions specific to running as a real network server (both necessary because one process now serves multiple independent connections, so nothing may throw uncaught): (a) `JSON.parse` the incoming frame in its own try/catch — malformed frames are silently dropped (no `id` to reply to); (b) a per-connection `socket.on('error', ...)` handler as noted above.
- **Binds to `127.0.0.1` by default**, not all interfaces — local dev tool, no auth, so loopback-only avoids exposing an unauthenticated analysis endpoint on the LAN.
- Auto-starts when run as main, reusing `cli/cli.mjs`'s existing `import.meta.url === file://${process.argv[1]}` main-module check: reads `WS_ENGINE_PORT` env var (default `8787`), calls `createGameDriverServer`, logs the listening URL.

### 3. `controller/aiMoveChannel.mjs` (modify)

```js
const resolveConfiguredWsUrl = () => {
  if (typeof globalThis.__WS_ENGINE_URL__ === 'string') return globalThis.__WS_ENGINE_URL__;
  if (typeof process !== 'undefined' && process.env?.WS_ENGINE_URL) return process.env.WS_ENGINE_URL;
  return null; // nothing configured — Worker only, exactly like today
};

export const requestAiMove = async ({ session, depth, signal, wsUrl } = {}) => {
  if (signal?.aborted) return { played: false, aborted: true };

  const url = wsUrl ?? resolveConfiguredWsUrl();
  const driver = url ? new WsGameDriver({ session, url }) : new WorkerGameDriver({ session });
  const result = await driver.playAiMove(depth, signal);

  if (signal?.aborted) return { played: false, aborted: true };
  return result;
};
```

- **No try/catch, no fallback branch.** If a WS URL is configured and the engine is unreachable or errors, `playAiMove` rejects and this function rejects too — the caller sees the failure. If nothing is configured, this is *exactly* today's code path with `WorkerGameDriver`, byte-for-byte.
- `gameController.mjs`'s existing call site (`requestAiMove({session, depth, signal})`) needs **no changes** — it never passes `wsUrl`. The explicit `wsUrl` param exists purely for test injection (`requestAiMove({..., wsUrl: server.url()})`) and takes precedence over the resolved global/env value when passed.
- Preserves the existing abort behavior exactly: a mid-flight abort rejects with `Error('Aborted')`, uncaught here, propagating to `gameController.mjs`'s `playAiTurn` catch block (`console.error('AI error:', ...)`) — same as today, and now this is also the path a WS-unreachable error takes: it surfaces as a logged `AI error:` and that turn simply doesn't play a move (existing, unmodified error handling — no new UI-level error surfacing was requested, so none is added).

### 4. Startup configuration — `-ws <port>` (CLI) / `?ws=1982` (browser)

One-shot, read at startup only — changing it means reloading the page or restarting the REPL with a different value (confirmed acceptable). Deliberately minimal: **`localhost` only, port number only**, no arbitrary-host URLs, no "always try a default port" — nothing happens unless a port is explicitly given.

A captured value that isn't a bare non-negative integer is treated as absent (ignored) rather than erroring — a typo in the flag shouldn't crash the page or the REPL; it just means WS mode isn't activated.

- **Browser (`main.mjs`)**: add a small `getWsParam()` next to `getDemoParam()` (main.mjs:10-19) — **query string only**, not the multi-format treatment `getDemoParam` uses: `new URLSearchParams(window.location.search).get('ws')`, kept to a bare non-negative integer. Simpler than mirroring every `getDemoParam` variant, works under any static host (including the README's plain `python3 -m http.server`) with zero caveats, and needs no fallback-routing infrastructure.
  - `?ws=1982` → if the captured value is a bare integer, `wsPortUrl(port)` is assigned to `globalThis.__WS_ENGINE_URL__` before `createGameController(...)` runs (main.mjs:59). Anything else is ignored (WS mode stays off, same as if the param were absent).
- **CLI (`cli/cli.mjs`)**: add minimal flag parsing to the startup block (cli.mjs:330-348, currently just `process.argv[2]` as an optional positional startup-file path) — scan for a `-ws <port>` pair, strip it out, keep the remaining positional arg as today's startup file. Resolve via `wsPortUrl(port)` into a `wsUrl` constant, threaded down through `runRepl(driver, wsUrl)` → `replLoop(driver, rl, wsUrl)` → `executeCommand(driver, cmd, wsUrl)` — plain read-only values, no mutable state, no in-REPL command to change it.

If a remote-host use case ever comes up, `globalThis.__WS_ENGINE_URL__` / `process.env.WS_ENGINE_URL` already accept any `ws://`/`wss://` string directly — `-ws`/`?ws=` just don't expose that today.

### 5. `cli/cli.mjs` (modify) — `-ws <port>` support

The CLI never used the Worker offload (it's a blocking REPL, so synchronous `driver.playAiMove(depth)` was always fine — cli.mjs:235). It gets the same opt-in/hard-error treatment as the browser: **no `-ws` flag → today's exact direct/local behavior, untouched; `-ws <port>` given → every `ai` command uses the WS engine and throws if it's unreachable** (no silent fallback to local analysis).

- The `'ai'` case (cli.mjs:234-246) currently calls `driver.playAiMove(cmd.depth)` directly and prints `result.move`/`result.board`/`result.choice`/`result.time` — fields the reduced WS DTO (`{played, matchIndex, moveKey, score, nodes, elapsedMs}`) doesn't carry. New helper, reconstructing the rest exactly the way `gameController.mjs`'s `playAiTurn` already does for the browser path (cli.mjs already imports `moveKey`):

```js
const runAiMove = async (driver, depth, wsUrl) => {
  if (!wsUrl) return driver.playAiMove(depth); // unchanged today's behavior

  const choice = await new WsGameDriver({ session: driver.toJSON(), url: wsUrl }).playAiMove(depth);
  // no catch: WsEngineUnreachableError (or any other failure) propagates to
  // replLoop's existing try/catch → handleDriverError → "Error: <message>",
  // same generic error surface the REPL already uses for driver errors.
  if (!choice.played) return { played: false };
  const moves = driver.getMoves();
  const move = moves[choice.matchIndex];
  if (!move || moveKey(move) !== choice.moveKey) {
    throw new Error('WS engine returned a move not present in current legal moves');
  }
  const board = driver.getState().board; // pre-move board, same as GameDriver#playAiMove captures
  driver.playMoveIndex(choice.matchIndex);
  return {
    played: true,
    choice: choice.matchIndex + 1,
    move,
    board,
    score: choice.score,
    nodes: choice.nodes,
    time: choice.elapsedMs / 1000,
  };
};
```

  `executeCommand`'s `'ai'` case becomes `const result = await runAiMove(driver, cmd.depth, wsUrl);` — the rest of that case (printing) is unchanged since `runAiMove` always returns the same shape `driver.playAiMove()` already produced. Because nothing is caught inside `runAiMove`, an unreachable engine throws out of `executeCommand`, is caught by `replLoop`'s existing try/catch, and prints via the existing `handleDriverError` fallthrough (`Error: <message>`) — the REPL survives (the user could restart it with a different `-ws` value or none), but that turn's AI move did not play.
- Importing `controller/WsGameDriver.mjs` from `cli/cli.mjs` is a new cross-directory dependency (today `cli/` never imports from `controller/`; only the reverse). Nothing in `eslint.config.js` restricts this (no import-boundary rule, confirmed by reading it) and `GameDriver.mjs`'s own header already documents `cli/` as code "imported by the browser-loaded controller as well as the Node CLI," i.e. dual-use is already the norm at this boundary — just previously one-directional.

### 6. `package.json`

- New script: `"server": "node server/gameDriverServer.mjs"`.
- New devDependency: `"ws": "^8.18.0"` (or current latest at implementation time).

### 7. Tests

New `tests/controller/wsGameDriver.test.mjs`:
- Real test server on `port: 0` → `requestAiMove({session, depth: 1, wsUrl: server.url()})` returns a correct, clone-safe, `moveKey`-verifiable DTO (reuse the `isCloneSafeDto` helper already in `aiMoveChannel.test.mjs`), functionally equivalent to what the Worker path would produce for the same session/depth.
- Error-not-fallback case: reserve a free port via `net.createServer().listen(0)`, read the port, close it immediately, then pass that port's URL as `wsUrl` (nothing is listening, guaranteed) — assert `requestAiMove` **rejects** with a `WsEngineUnreachableError` (does *not* return a Worker-backed choice).
- Abort coverage: pre-aborted signal against a real running server → `{played:false, aborted:true}` without opening a socket; mid-flight abort against a real server (abort right after calling, before the response arrives) → rejects with `Error('Aborted')`.
- `afterEach`: `WsGameDriver.terminate()`; `afterAll`: close any server started in the file.

`tests/controller/aiMoveChannel.test.mjs`, `tests/controller/gameControllerDriverSync.test.mjs`, `tests/controller/gameControllerTurnPacing.test.mjs`: **no changes needed.** None of them ever pass `wsUrl`, and with no default-port auto-attempt, `requestAiMove`'s internal resolver returns `null` in the test environment (no `globalThis.__WS_ENGINE_URL__`/`WS_ENGINE_URL` set) — so these files exercise the exact same `WorkerGameDriver` path they do today, with zero new networking surface.

New `tests/cli/cliWsFlag.test.mjs` (or extend an existing `tests/cli/*.test.mjs`, matching whatever precedent those already use for exercising `cli.mjs`, e.g. spawn-based per `tests/cli/repl.test.mjs`):
- `-ws <ephemeral test server port>` + `ai 1` → printed move matches what direct `driver.playAiMove(1)` would have produced for the same session.
- `-ws <closed ephemeral port>` + `ai 1` → REPL prints `Error: ...` (via `handleDriverError`) and stays alive for the next command, rather than crashing or silently falling back to local analysis.

No changes needed: `tests/cli/gameDriver.test.mjs`, `examples/analyzerVsAnalyzer.mjs`, `examples/analyzerVsDumber.mjs`, anything under `view/`/`model/` (none touch this path).

### 8. `docs/ws-engine-api-spec.md` (new) — vendor-facing protocol spec

Per the user's requirement: a third party must be able to implement their **own** AI engine server, in any language, against a written contract — not just read our source. `docs/ws-engine.md` (§9) documents *our* implementation; this is the implementation-independent contract that any compliant server must satisfy, written so a vendor never needs to open this repo's source to build one. Contents:

- **Transport & envelope**: WebSocket, one JSON object per text frame. Request `{id: string, type: "playAiMove", session: object, depth: integer}` → success response `{id, result: {played: boolean, matchIndex?: integer, moveKey?: string, score?: number, nodes?: number, elapsedMs?: number}}` (omit the optional fields when `played` is `false`) → failure response `{id, error: string}`. `id` in the response must echo the request's `id` verbatim; a frame that fails to parse as JSON should be dropped, not answered (there's no `id` to reply to).
- **Statelessness contract**: every request is self-contained — the server MUST derive its answer purely from `(session, depth)` in that request, with no memory of earlier requests on the same or any other connection. This is what makes an engine restartable/replaceable with zero handshake or session-affinity logic; a vendor implementation that requires an init/handshake step is non-compliant.
- **`session` shape** — reproduce `GameDriver#toJSON()` field-by-field, with a real worked example (captured from a fresh `new GameDriver().toJSON()`):
  ```json
  {
    "format": "thai-checkers-cli-session-v1",
    "initialSetup": { "board": "18374687579166474240", "sideToMove": "WHITE" },
    "moveSequence": [],
    "currentIndex": 0
  }
  ```
  `initialSetup.board` is a decimal-string-encoded bitboard (`Board#encode().toString()` / `Board.decode(BigInt(str))`); `moveSequence` entries are `{index, from, to, captured, path}` with squares in algebraic notation (`"A1".."H8"`); `currentIndex` selects how far into `moveSequence` play has progressed. A vendor must be able to replay this exact structure to reconstruct the position to analyze.
- **The critical compatibility constraint** (the part most likely to trip up an independent implementation): `matchIndex` is an index into *the reference legal-move generator's* move list for that position, and `moveKey` is `` `${from.hash()}:${to.hash()}:${sortedCapturedHashes.join(',')}` `` where a square's `hash()` is its 0..31 board-index (not its algebraic string). The client re-derives its own move list from the same session using this repo's `core/` rules engine and only accepts the response if `matchIndex` points at a move whose `moveKey` matches exactly — so **a compliant engine must enumerate legal moves in the same order the reference `core/` engine does**, not just any semantically-equivalent legal-move set. In practice this means a vendor's most reliable path is to depend on this repo's `cli/GameDriver.mjs` + `core/` for session decoding and move enumeration, and plug in their own logic only for *which* legal move to pick — this is exactly what our own reference `server/gameDriverServer.mjs` does, and the spec says so explicitly rather than leaving it implicit.
  - Worked example against the fresh-game session above: `moveKey` of the first legal move is `"4:8:"` (from-hash `4`, to-hash `8`, no captures).
- **`depth`**: integer, `1..16` (`MAX_ANALYSIS_DEPTH` in `core/Analyzer.mjs`) — the spec states the current bound but notes it's this repo's engine's limit, not a wire-protocol limit; a vendor engine may interpret `depth` under its own search semantics as long as larger values mean "search more."
- **Timing**: only the connection handshake has a client-enforced timeout (this repo's reference client uses 400ms); there is no protocol-level response deadline, since deeper searches can legitimately take seconds — vendors should still respond in a bounded, predictable time since the caller (a browser tab or CLI REPL) is waiting synchronously for that turn.
- **Non-goals, stated explicitly**: no authentication, no encryption, no session/room concept, no move validation contract beyond the index/key check described above (an engine that returns an illegal `matchIndex` simply gets its move rejected client-side, never applied) — vendors deploying beyond localhost are responsible for their own transport security.
- **Conformance**: a companion runnable checker, `examples/checkWsEngineConformance.mjs <ws-url>` (new, mirrors the existing `examples/analyzerVsAnalyzer.mjs` / `examples/analyzerVsDumber.mjs` convention of standalone runnable scripts) — sends a handful of known sessions (fresh game, and a mid-game position with a forced/chain capture, exercising the captured-squares part of `moveKey`) at a few depths to the given URL, and asserts each response is well-formed and points at a real, `moveKey`-matching legal move. A vendor runs this against their own server to self-certify compatibility without needing to read this repo's internals or our test suite.

### 9. Docs (implementation notes, not the spec)

New `docs/ws-engine.md`, mirroring `docs/worker.md`'s structure: Files, Message Protocol (references §8's spec as the normative definition, notes it's identical to the worker's protocol just over a different transport), Connection Lifecycle (400ms handshake timeout, shared-socket reuse), **Opt-in / Error Behavior** (nothing configured → Worker only, unchanged; configured → WS only, unreachable is a thrown error, not a fallback), Abort Behavior (parity with worker), Running the server (`npm run server`, `WS_ENGINE_PORT`), the startup forms (`-ws <port>` for the CLI, `?ws=1982` for the browser — `localhost`-only port shorthand, read once at startup; changing it means reloading/restarting), and a pointer to `docs/ws-engine-api-spec.md` for anyone implementing their own engine.

`README.md`: add `server/gameDriverServer.mjs` to Project Structure, add `WsGameDriver.mjs` next to `WorkerGameDriver.mjs` in the `controller/` listing, extend the Controller architecture bullet to mention the opt-in WS engine and that it's an open, documented protocol third parties can implement against, document the `-ws`/`?ws=` flags next to the existing `Modes`/`AI Difficulty` tables, and note the one dependency caveat under "Runtime zero dependencies" (`ws` is dev-only, used solely by the optional server script).

## Critical files

- `controller/WsGameDriver.mjs` (new) — proxy class + `WsEngineUnreachableError` + `wsPortUrl` helper
- `server/gameDriverServer.mjs` (new) — reference/canonical protocol implementation
- `controller/aiMoveChannel.mjs` (modify) — opt-in WS, error-not-fallback
- `main.mjs` (modify) — `getWsParam()` next to `getDemoParam()`
- `cli/cli.mjs` (modify) — `-ws` flag parsing, `runAiMove()` helper
- `controller/WorkerGameDriver.mjs` (reference pattern, unmodified)
- `worker/gameDriverWorker.mjs` (reference pattern, unmodified)
- `tests/controller/wsGameDriver.test.mjs` (new)
- `docs/ws-engine-api-spec.md` (new) — the vendor-facing contract
- `docs/ws-engine.md` (new) — implementation notes, references the spec
- `examples/checkWsEngineConformance.mjs` (new) — runnable conformance checker for third-party engines

## Verification

1. `npm test` — full suite passes, including the new `wsGameDriver.test.mjs` and CLI flag test.
2. No config, baseline: open the game via `python3 -m http.server 8000` with a plain URL (nothing WS-related set) and confirm AI turns behave exactly as before (Worker path).
3. `npm run server` in one terminal, then open `localhost:8000/?ws=8787` and start an AI turn — confirm (via the server's own log line, or a temporary breakpoint/log) the move was served over WS; stop the server, reload, start another AI turn — confirm it now logs an `AI error:` (via `gameController.mjs`'s existing catch) and does *not* silently play a move via local analysis.
4. CLI: `npm run server` in one terminal, `node cli/cli.mjs -ws 8787` in another, run `ai 4` — confirm it plays and prints normally; stop the server, run `ai 4` again — confirm it prints `Error: ...` and the REPL stays usable, rather than falling back to local analysis.
5. Spec conformance: `npm run server` in one terminal, `node examples/checkWsEngineConformance.mjs ws://localhost:8787` in another — confirm it reports our own reference server as conformant (dogfoods the spec against its own reference implementation).
6. `npm run lint` — new files pass existing ESLint config.
