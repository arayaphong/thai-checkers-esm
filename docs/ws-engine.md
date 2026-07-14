# WS AI Engine (opt-in, pluggable)

AI analysis (`GameDriver#playAiMove`) can optionally be delegated to a
separate AI engine process reachable over WebSocket, instead of always
running in the built-in Web Worker (see [worker.md](./worker.md)). This lets
the engine implementation be upgraded or swapped by restarting that process
— no client rebuild or redeploy needed.

This is **opt-in only**. Nothing about this feature changes behavior for
anyone who doesn't configure a WS engine: `controller/aiMoveChannel.mjs`'s
`requestAiMove()` uses the Worker path exactly as before unless a WS engine
URL has been configured. It is not a multiplayer feature — the server is
stateless per request, same as the worker.

For the wire protocol itself (the part a third party would implement
against), see [ws-engine-api-spec.md](./ws-engine-api-spec.md) — this
document only covers *this repo's* client/server implementation of it.

## Files

- `controller/WsGameDriver.mjs` — the client proxy. Same shared-connection
  shape as `controller/WorkerGameDriver.mjs`, but talks to a real
  `WebSocket` (native in both the browser and Node 22+) instead of posting
  to a Worker.
- `server/gameDriverServer.mjs` — the reference engine server, built on the
  `ws` package. Exports `createGameDriverServer({port, host})`; auto-starts
  when run directly (`npm run server`).
- `controller/aiMoveChannel.mjs` — the boundary `GameController` calls;
  decides WS vs. Worker per request (see Opt-in Behavior below).
- `docs/ws-engine-api-spec.md` — the vendor-facing protocol contract.
- `examples/checkWsEngineConformance.mjs` — a runnable conformance checker
  for any server (this repo's own or a third party's) claiming to implement
  the protocol.

## Message Protocol

Identical to the Worker's protocol (see worker.md), just over a WebSocket
instead of `postMessage`. Full details, including the `session` shape and
the `matchIndex`/`moveKey` compatibility contract, are normatively defined
in [ws-engine-api-spec.md](./ws-engine-api-spec.md). Summary:

```js
// Request
{ id: string, type: 'playAiMove', session: object, depth: number }

// Response
{ id: string, result: { played: true, matchIndex, moveKey, score, nodes, elapsedMs } }
// or
{ id: string, result: { played: false } }
// or
{ id: string, error: string }
```

## Connection Lifecycle

`WsGameDriver` keeps one shared module-level socket, opened lazily on first
use and reused across requests while it stays open — same reuse rationale as
`WorkerGameDriver`'s shared worker. Two independent timeouts guard it:

- **Connect handshake: 400ms.** Only guards reaching `open`; an
  `ECONNREFUSED` (nothing listening) fires almost instantly, so this mostly
  protects against a routable-but-hung endpoint. A pre-`open` failure throws
  `WsEngineUnreachableError`.
- **AI-thinking response: 60s** (`responseTimeoutMs`, overridable via the
  constructor — mainly for tests). Bounds the wait for an actual analysis
  result, separate from the connect handshake, since a hung/misbehaving
  engine would otherwise leave the caller waiting forever. A timeout here
  throws a plain `Error` (not `WsEngineUnreachableError` — the connection
  itself was fine) and closes the connection so the next request reconnects
  fresh rather than reusing a socket that just proved unreliable.

## Opt-in / Error Behavior

`requestAiMove()` resolves a WS engine URL from (in order): an explicit
`wsUrl` param (test injection only), `globalThis.__WS_ENGINE_URL__`, or
`process.env.WS_ENGINE_URL`. If none are set, it behaves exactly as before
this feature existed — `WorkerGameDriver`, no WS involvement at all.

If a URL **is** resolved, that's the only path taken: an unreachable or
failing engine rejects the whole request. There is no fallback to the
Worker — an engine you explicitly configured failing silently and falling
back to a different one would be far more confusing than a clear error. In
`GameController`, that rejection surfaces through the existing
`playAiTurn` catch block (`console.error('AI error:', ...)`); in the CLI, it
propagates to the REPL's existing driver-error handler (`Error: ...`),
same as any other driver error — no new error-handling machinery was added
for this.

## Abort Behavior

Full parity with the Worker path: since the server's `playAiMove` call is
synchronous/CPU-bound either way, an in-flight request can't be cancelled
mid-analysis over the wire any more than inside a worker thread. On abort,
`playAiMove` closes the shared socket and rejects with `Error('Aborted')` —
the next request opens a fresh connection.

## Running the server

```bash
npm run server                    # listens on ws://127.0.0.1:8787
WS_ENGINE_PORT=1982 npm run server  # or any other port
```

Binds to `127.0.0.1` only (loopback) — this is a local dev tool with no
authentication, so it's never exposed on the LAN by default.

## Pointing the client at it

One-shot, read at startup only — there is no live mid-session hot-swap.
Changing which engine is used means reloading the page or restarting the
REPL with a different value. All forms are `localhost`-only port shorthand
(`ws://localhost:<port>`); for anything else, set
`globalThis.__WS_ENGINE_URL__` / `WS_ENGINE_URL` directly.

- **Browser**: `?ws=1982` query param, read once in `main.mjs` before the
  controller is created.
- **CLI**: `-ws 1982` flag, e.g. `node cli/cli.mjs -ws 1982`.

## Node Compatibility

Both sides work under plain Node with no shim: Node 22+ has a native
client `WebSocket` global (used by `WsGameDriver` in both the browser and
Node — CLI and tests included), and `server/gameDriverServer.mjs` is a
Node-only script built on the `ws` package (a devDependency, never imported
by browser-reachable code — see README's "Runtime zero dependencies").
