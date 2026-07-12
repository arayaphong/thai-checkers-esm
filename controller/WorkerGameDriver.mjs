// Thai Checkers WorkerGameDriver — async proxy that offloads AI analysis to a
// dedicated worker thread.
//
// The proxy supports both browser Web Workers and Node worker_threads. A single
// module-level worker is shared across instances and reused for successive AI
// requests. Aborting the request terminates the worker, which is then recreated
// on the next request.

let sharedWorker = null;
let sharedWorkerUrl = null;
let nextRequestId = 0;
const pending = new Map();

const isBrowserWorker = () => typeof globalThis.Worker !== 'undefined';

const getWorkerConstructor = async () => {
  if (isBrowserWorker()) return globalThis.Worker;
  const { Worker: NodeWorker } = await import('node:worker_threads');
  return NodeWorker;
};

const handleMessage = (data) => {
  if (data?.error !== undefined) {
    for (const entry of pending.values()) {
      entry.reject(new Error(data.error));
    }
    pending.clear();
    return;
  }

  const { id, result, error } = data;
  const entry = pending.get(id);
  if (!entry) return;

  pending.delete(id);
  if (error !== undefined) {
    entry.reject(new Error(error));
  } else {
    entry.resolve(result);
  }
};

const attachMessageHandler = (worker) => {
  if (isBrowserWorker()) {
    worker.onmessage = (event) => handleMessage(event.data);
    worker.onerror = (error) => handleMessage({ error: error.message ?? String(error) });
    return;
  }
  worker.on('message', handleMessage);
  worker.on('error', (error) => handleMessage({ error: error.message ?? String(error) }));
};

const terminateSharedWorker = () => {
  if (!sharedWorker) return;
  sharedWorker.terminate();
  sharedWorker = null;
  sharedWorkerUrl = null;
};

const ensureSharedWorker = async () => {
  const workerUrl = new URL('../worker/GameDriverWorker.mjs', import.meta.url);
  const workerUrlHref = workerUrl.href;

  if (sharedWorker && sharedWorkerUrl === workerUrlHref) {
    return sharedWorker;
  }

  terminateSharedWorker();

  const WorkerCtor = await getWorkerConstructor();
  const options = isBrowserWorker() ? { type: 'module' } : undefined;
  sharedWorker = new WorkerCtor(workerUrl, options);
  sharedWorkerUrl = workerUrlHref;
  attachMessageHandler(sharedWorker);
  return sharedWorker;
};

export class WorkerGameDriver {
  #session;

  constructor({ session }) {
    this.#session = session;
  }

  async playAiMove(depth, signal) {
    if (signal?.aborted) {
      this.terminate();
      return { played: false, aborted: true };
    }

    const worker = await ensureSharedWorker();

    const id = String((nextRequestId += 1));
    const { promise, resolve, reject } = Promise.withResolvers();
    pending.set(id, { resolve, reject });

    const abortHandler = () => {
      this.terminate();
      reject(new Error('Aborted'));
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    worker.postMessage({ id, type: 'playAiMove', session: this.#session, depth });

    try {
      return await promise;
    } finally {
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  terminate() {
    terminateSharedWorker();
    for (const entry of pending.values()) {
      entry.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }

  static terminate() {
    terminateSharedWorker();
    for (const entry of pending.values()) {
      entry.reject(new Error('Worker terminated'));
    }
    pending.clear();
  }
}
