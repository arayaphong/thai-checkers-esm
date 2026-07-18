// Thai Checkers WsGameDriver — async proxy that offloads AI analysis to a
// WebSocket-hosted AI engine.
//
// Mirrors WorkerGameDriver's shared-connection shape, but talks to a real
// WebSocket (native in both the browser and Node 22+) instead of a Worker.
// Unlike the Worker path this is opt-in: a caller always supplies an
// explicit `url` — there is no default endpoint. See docs/ws-engine.md and
// docs/ws-engine-api-spec.md for the wire protocol.

const CONNECT_TIMEOUT_MS = 400;
// Bounds the AI-thinking wait itself, separate from the connect handshake —
// a hung/misbehaving engine must not leave the caller waiting forever.
const DEFAULT_RESPONSE_TIMEOUT_MS = 60000;

let sharedSocket = null;
let sharedSocketUrl = null;
let nextRequestId = 0;
const pending = new Map();

// Shorthand used by callers that only know a localhost port (e.g. from a
// `-ws <port>` CLI flag or a `?ws=<port>` query param).
export const wsPortUrl = (port) => `ws://localhost:${port}`;

// Thrown only for pre-flight failures (handshake timeout/error, malformed
// URL) — distinguishes "couldn't reach the engine" from a plain Error raised
// once a connection was established (server-side failure, mid-flight drop).
export class WsEngineUnreachableError extends Error {}

const rejectAllPending = (error) => {
  for (const entry of pending.values()) {
    entry.reject(error);
  }
  pending.clear();
};

const handleMessage = (data) => {
  const { id, result, error } = data ?? {};
  if (id === undefined || id === null) return;
  const entry = pending.get(id);
  if (!entry) return;

  pending.delete(id);
  if (error !== undefined) {
    entry.reject(new Error(error));
  } else {
    entry.resolve(result);
  }
};

const attachHandlers = (socket) => {
  socket.addEventListener('message', (event) => {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      return; // malformed frame — no id to route to, drop it
    }
    handleMessage(data);
  });
  socket.addEventListener('close', () => {
    rejectAllPending(new Error('AI engine connection closed'));
  });
  socket.addEventListener('error', () => {
    rejectAllPending(new Error('AI engine connection error'));
  });
};

const connect = (url) =>
  new Promise((resolve, reject) => {
    let settled = false;
    let socket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      reject(new WsEngineUnreachableError(`Cannot connect to AI engine at ${url}: ${error.message}`));
      return;
    }

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(new WsEngineUnreachableError(`Timed out connecting to AI engine at ${url}`));
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener(
      'open',
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(socket);
      },
      { once: true },
    );

    socket.addEventListener(
      'error',
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new WsEngineUnreachableError(`Cannot connect to AI engine at ${url}`));
      },
      { once: true },
    );
  });

const terminateSharedSocket = () => {
  if (!sharedSocket) return;
  sharedSocket.close();
  sharedSocket = null;
  sharedSocketUrl = null;
};

const ensureSharedSocket = async (url) => {
  if (sharedSocket && sharedSocketUrl === url && sharedSocket.readyState === WebSocket.OPEN) {
    return sharedSocket;
  }
  terminateSharedSocket();

  const socket = await connect(url);
  attachHandlers(socket);
  sharedSocket = socket;
  sharedSocketUrl = url;
  return sharedSocket;
};

export class WsGameDriver {
  #session;
  #url;
  #responseTimeoutMs;

  constructor({ session, url, responseTimeoutMs = DEFAULT_RESPONSE_TIMEOUT_MS }) {
    this.#session = session;
    this.#url = url;
    this.#responseTimeoutMs = responseTimeoutMs;
  }

  async playAiMove(depth, signal) {
    if (signal?.aborted) {
      this.terminate();
      return { played: false, aborted: true };
    }

    const socket = await ensureSharedSocket(this.#url);

    const id = String((nextRequestId += 1));
    const { promise, resolve, reject } = Promise.withResolvers();
    pending.set(id, { resolve, reject });

    const abortHandler = () => {
      // Remove this entry before terminate()'s broad rejection sweep so the
      // specific "Aborted" reason below is what actually settles this
      // promise, not the generic "Connection terminated" one.
      pending.delete(id);
      this.terminate();
      reject(new Error('Aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    const responseTimer = setTimeout(() => {
      // A connection that can't produce a response within the deadline is
      // presumably unhealthy — force a fresh reconnect next time rather than
      // reusing it, same as the abort path.
      pending.delete(id);
      this.terminate();
      reject(new Error(`AI engine did not respond within ${this.#responseTimeoutMs}ms`));
    }, this.#responseTimeoutMs);

    socket.send(JSON.stringify({ id, type: 'playAiMove', session: this.#session, depth }));

    try {
      return await promise;
    } finally {
      clearTimeout(responseTimer);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  terminate() {
    terminateSharedSocket();
    rejectAllPending(new Error('Connection terminated'));
  }

  static terminate() {
    terminateSharedSocket();
    rejectAllPending(new Error('Connection terminated'));
  }
}
