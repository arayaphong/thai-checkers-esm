## Plan: Move GameDriver AI analysis to Web Worker

**TL;DR** – Offload the `GameDriver` AI analysis (`playAiMove`) to a long‑lived Web Worker. The worker hosts a private `GameDriver` instance, receives a session JSON, runs `playAiMove`, and returns the result. The main thread uses a proxy class `WorkerGameDriver` that communicates via `postMessage`. Abort signals terminate the worker. No fallback implementation is required.

**Steps**

1. **Add worker script** – Create `worker/gameDriverWorker.mjs`.
   - Import `GameDriver` from `../cli/GameDriver.mjs`.
   - Listen for `message` events. For each message containing an `id`, a `type` of `playAiMove`, a `session` JSON and a `depth`, instantiate a fresh `GameDriver(session)`, call `playAiMove(depth)`, and `postMessage({id, result})`. Catch errors and `postMessage({id, error})`.
   - Listen for a `'terminate'` message and call `self.close()`.

2. **Create proxy class** – Add `controller/WorkerGameDriver.mjs`.
   - Export class `WorkerGameDriver` with a constructor that accepts `{session}` and creates a `new Worker(new URL('../worker/gameDriverWorker.mjs', import.meta.url), {type: 'module'})` if a worker does not already exist.
   - Maintain a map `pending` keyed by request `id` to resolve or reject promises when the worker posts a response.
   - Implement `async playAiMove(depth, signal)` that sends a `{id, type: 'playAiMove', session, depth}` message and returns a promise resolved with the result DTO. If `signal?.aborted`, terminate the worker and resolve with `{played: false, aborted: true}`.
   - Provide `terminate()` that calls `worker.terminate()` and clears the pending map.

3. **Refactor `AiMoveChannel`** – Update `controller/aiMoveChannel.mjs`.
   - Replace the local `GameDriver` import with `WorkerGameDriver`.
   - In `requestAiMove`, instantiate `new WorkerGameDriver({session})` and call `await driver.playAiMove(depth, signal)`. Return the DTO directly (including `matchIndex`, `moveKey`, `score`, `nodes`, `elapsedMs`).
   - Ensure abort handling respects the new termination behavior.

4. **Adapt `GameController` to async driver** – Modify `controller/gameController.mjs`.
   - Change all direct `driver` method calls (`getMoves`, `playMoveIndex`, `undo`, `redo`, `getState`, `toJSON`, `load`) to `await` the corresponding async proxy methods.
   - Update any synchronous logic that depends on driver state to handle promises (e.g., `await driver.getMoves()` before an AI turn, `await driver.playMoveIndex(...)`).
   - Preserve the existing operation‑token logic to guard against stale continuations.

5. **Update bridge if needed** – Verify that functions in `controller/gameDriverBridge.mjs` operate on move objects only, so no changes are required. Ensure any direct `driver` property accesses are async‑compatible.

6. **Adjust tests** – Modify test files that instantiate `GameDriver` directly (`tests/cli/*.test.mjs`, `tests/controller/*.test.mjs`).
   - Import `WorkerGameDriver` where AI analysis is exercised.
   - Prefix `await` to all driver method calls.
   - Add a helper to create a fresh worker for each test and call `terminate()` in `afterEach` to avoid orphan workers.

7. **Documentation** – Add `docs/worker.md` describing the worker architecture, message protocol, and usage. Update `README.md` to mention the new worker‑based AI analysis.

8. **Verification** – Run the full test suite (`npm test`).
   - All existing tests must pass.
   - In the browser, open the game and start an AI turn; UI should remain responsive (no long‑running main‑thread tasks).
   - Abort an AI request (e.g., pause the game) and verify the worker is terminated and no further messages affect the UI.
   - Confirm that undo/redo, save (`toJSON`) and load (`load`) actions continue to work via the original `GameDriver` (unchanged).
   - Ensure only one worker instance exists after multiple AI moves (no orphan workers).

**Relevant files**

- `cli/GameDriver.mjs` – core driver logic (unchanged, imported by the worker).
- `controller/aiMoveChannel.mjs` – will be refactored to use the worker proxy.
- `controller/gameController.mjs` – async driver integration.
- `controller/WorkerGameDriver.mjs` – new proxy class exposing async `playAiMove`.
- `worker/gameDriverWorker.mjs` – new worker script handling AI analysis.
- Test files under `tests/cli/` and `tests/controller/` – need updates.

**Verification**

1. `npm test` completes with all existing tests passing.
2. In the browser, start an AI turn and verify UI interactions remain smooth.
3. Trigger an abort during AI analysis; confirm the worker is terminated and no further messages are processed.
4. Perform undo/redo, save (`toJSON`) and load (`load`) actions; state after round‑trip matches the original.
5. Memory‑leak check: after a sequence of AI moves and aborts, the number of active workers stays at 1.

**Decisions**

- **Scope of Worker** – Only AI analysis (`playAiMove`) and driver state manipulation (undo/redo/load/save) are performed in the worker. All other `GameDriver` operations remain on the main thread.
- **Worker lifecycle** – A single long‑lived worker is created on the first AI request and reused for subsequent requests. Abort signals terminate the worker, which will be recreated on the next request.
- **Fallback** – No fallback implementation; the worker is required.
- **Abort handling** – Abort terminates the worker immediately; pending promises are rejected.
- **Worker script location** – `worker/gameDriverWorker.mjs` at the repository root.

**Further Considerations**

1. **Full driver off‑loading** – In a later phase, consider moving all driver interactions (including human move validation) to the worker for a completely non‑blocking UI.
2. **Parallel workers** – For deeper analysis or multiple AI opponents, a pool of workers could be introduced.
3. **Node CLI compatibility** – Ensure the CLI (`cli/cli.mjs`) still works in Node; workers are supported via `worker_threads` and may need a conditional import.
4. **Error reporting** – Define a standard error DTO for worker failures to surface in the UI.
5. **Performance metrics** – Benchmark AI analysis time with and without the worker to quantify UI responsiveness gains.
