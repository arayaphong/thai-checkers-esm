# Worker-based AI Analysis

AI analysis (`GameDriver#playAiMove`) runs in a dedicated worker so the browser
main thread stays responsive during search.

## Files

- `worker/gameDriverWorker.mjs` — the worker script. Loaded as a module Web
  Worker in the browser and as a `worker_threads` Worker in Node.
- `controller/WorkerGameDriver.mjs` — the main-thread proxy that spawns the
  worker, posts requests, and resolves promises.
- `controller/aiMoveChannel.mjs` — the boundary used by `GameController`; it
  builds a scratch driver session, asks `WorkerGameDriver` to analyze it, and
  returns a plain choice DTO.

## Message Protocol

The proxy and worker exchange messages with a unique `id`.

### Request

```js
{ id: string, type: 'playAiMove', session: object, depth: number }
```

- `session` — a structured-clone-safe object matching `GameDriver#toJSON()`.
- `depth` — analysis depth passed to the analyzer.

A special `type: 'terminate'` message asks a browser worker to call
`self.close()`. Node workers are terminated from the parent, so this is a no-op
there.

### Response

```js
{ id: string, result: { played: true, matchIndex, moveKey, score, nodes, elapsedMs } }
// or
{ id: string, result: { played: false } }
// or
{ id: string, error: string }
```

The worker builds a fresh `GameDriver(session)` for every request, so the
authoritative driver that produced the session is never modified by the worker.

## Worker Lifecycle

`WorkerGameDriver` keeps one module-level worker. The first AI request creates
it; later requests reuse it. An `AbortSignal` terminates the worker immediately
and the next request recreates it. `WorkerGameDriver.terminate()` (static) or
`driver.terminate()` (instance) terminates the shared worker explicitly, which
is useful in tests to avoid orphan workers.

## Abort Behavior

If the signal is already aborted when `playAiMove` is called, the worker is
terminated and `{ played: false, aborted: true }` is returned. If the signal
aborts while analysis is in flight, the worker is terminated and the promise
rejects. `GameController` treats an aborted AI request as a no-op and lets the
caller start a new request later.

## Node Compatibility

The same code path works under Node's `worker_threads` because both the worker
script and the proxy detect the environment:

- The worker uses `self` in browsers and dynamically imports `parentPort` from
  `node:worker_threads` in Node.
- The proxy uses `globalThis.Worker` in browsers and dynamically imports
  `Worker` from `node:worker_threads` in Node.

The Node CLI (`cli/cli.mjs`) is unaffected; it continues to use the synchronous
`GameDriver` directly.
