// Thai Checkers WS AI engine server — reference implementation of the
// protocol described in docs/ws-engine-api-spec.md.
//
// Stateless per request: every connection can carry any number of requests,
// each of which builds a fresh GameDriver from the supplied session and
// returns a structured-clone-safe choice DTO. No session/handshake state is
// kept between requests, which is what makes this process freely
// restartable/replaceable (the "hot-swap the engine" story).
import process from 'node:process';
import { WebSocketServer } from 'ws';
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';

const DEFAULT_PORT = 8787;

const handlePlayAiMove = ({ session, depth }) => {
  const driver = new GameDriver(session);
  const result = driver.playAiMove(depth);
  if (!result.played) {
    return { played: false };
  }
  return {
    played: true,
    matchIndex: result.matchIndex,
    moveKey: moveKey(result.move),
    score: result.score,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
};

const handleConnection = (socket) => {
  // An unhandled 'error' event on a ws socket can crash the process — every
  // connection needs a listener even though this server never initiates one.
  socket.on('error', () => {});

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return; // malformed frame — no id to reply to, drop it
    }

    const { id, type } = message;
    if (id === undefined || id === null) return;

    if (type !== 'playAiMove') {
      socket.send(JSON.stringify({ id, error: `Unknown message type: ${type}` }));
      return;
    }

    try {
      const result = handlePlayAiMove(message);
      socket.send(JSON.stringify({ id, result }));
    } catch (error) {
      socket.send(JSON.stringify({ id, error: error.message ?? String(error) }));
    }
  });
};

// Resolves once actually listening (the ws server binds asynchronously, so
// wss.address() is null until then). Binds to 127.0.0.1 only — this is a
// local dev tool with no auth, so loopback-only avoids exposing an
// unauthenticated analysis endpoint on the LAN.
export const createGameDriverServer = ({ port = DEFAULT_PORT, host = '127.0.0.1' } = {}) =>
  new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port, host });

    wss.once('error', reject);
    wss.on('connection', handleConnection);

    wss.once('listening', () => {
      wss.on('error', (error) => {
        console.error('gameDriverServer: server error', error);
      });
      resolve({
        address: () => wss.address(),
        url: () => `ws://${host}:${wss.address().port}`,
        close: () => new Promise((res, rej) => wss.close((error) => (error ? rej(error) : res()))),
      });
    });
  });

const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  const port = Number(process.env.WS_ENGINE_PORT) || DEFAULT_PORT;
  createGameDriverServer({ port })
    .then((server) => {
      console.log(`AI engine WS server listening on ${server.url()}`);
    })
    .catch((error) => {
      console.error(`Failed to start AI engine server: ${error.message}`);
      process.exitCode = 1;
    });
}
