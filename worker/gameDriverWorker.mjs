// Thai Checkers Web Worker — runs GameDriver AI analysis off the main thread.
//
// This module is loaded as a module Web Worker in the browser and as a
// worker_threads Worker in Node. It keeps no state between messages; each
// request builds a fresh scratch GameDriver from the supplied session and
// returns a structured-clone-safe choice DTO.
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';

// Normalise the messaging surface between browser Web Workers and Node
// worker_threads. In the browser `self` provides postMessage/onmessage; in Node
// `parentPort` provides postMessage/on('message').
const createPort = async () => {
  if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
    return {
      onMessage: (handler) => {
        self.onmessage = (event) => handler(event.data);
      },
      post: (message) => self.postMessage(message),
      close: () => {
        if (typeof self.close === 'function') self.close();
      },
    };
  }

  const { parentPort, isMainThread } = await import('node:worker_threads');
  if (isMainThread || !parentPort) {
    throw new Error('GameDriverWorker must run inside a worker thread');
  }
  return {
    onMessage: (handler) => {
      parentPort.on('message', handler);
    },
    post: (message) => parentPort.postMessage(message),
    close: () => {
      // Node worker threads are terminated from the parent; nothing to do here.
    },
  };
};

const port = await createPort();

port.onMessage(async (message) => {
  const { id, type } = message;
  if (id === undefined || id === null) return;

  if (type === 'terminate') {
    port.close();
    return;
  }

  if (type !== 'playAiMove') {
    port.post({ id, error: `Unknown worker message type: ${type}` });
    return;
  }

  const { session, depth } = message;
  try {
    const driver = new GameDriver(session);
    const result = driver.playAiMove(depth);
    if (!result.played) {
      port.post({ id, result: { played: false } });
      return;
    }
    port.post({
      id,
      result: {
        played: true,
        matchIndex: result.matchIndex,
        moveKey: moveKey(result.move),
        score: result.score,
        nodes: result.nodes,
        elapsedMs: result.elapsedMs,
      },
    });
  } catch (error) {
    port.post({ id, error: error.message ?? String(error) });
  }
});
