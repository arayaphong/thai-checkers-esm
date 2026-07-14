import { describe, test, afterEach, afterAll } from '@jest/globals';
import assert from 'node:assert/strict';
import net from 'node:net';
import { WebSocketServer } from 'ws';
import { GameDriver, moveKey } from '../../cli/GameDriver.mjs';
import { WsGameDriver, WsEngineUnreachableError } from '../../controller/WsGameDriver.mjs';
import { createGameDriverServer } from '../../server/gameDriverServer.mjs';

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.prototype.toString.call(value) === '[object Object]';

const isCloneSafeDto = (value) => {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isCloneSafeDto);
  if (isPlainObject(value)) return Object.values(value).every(isCloneSafeDto);
  return false;
};

// A port guaranteed to have nothing listening on it right now.
const reserveClosedPort = async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('WsGameDriver', () => {
  let server;

  const ensureServer = async () => {
    server ??= await createGameDriverServer({ port: 0 });
    return server;
  };

  afterEach(() => {
    WsGameDriver.terminate();
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  test('returns a structured-clone-safe DTO pointing at a real legal move', async () => {
    const testServer = await ensureServer();
    const driver = new GameDriver();
    const session = driver.toJSON();

    const choice = await new WsGameDriver({ session, url: testServer.url() }).playAiMove(1);

    assert.equal(choice.played, true);
    assert.equal(typeof choice.matchIndex, 'number');
    assert.equal(typeof choice.moveKey, 'string');
    assert.equal(typeof choice.score, 'number');
    assert.equal(typeof choice.nodes, 'number');
    assert.equal(typeof choice.elapsedMs, 'number');
    assert.ok(isCloneSafeDto(choice), 'choice DTO is structured-clone-safe');

    const moves = driver.getMoves();
    const move = moves[choice.matchIndex];
    assert.ok(move, 'matchIndex points at a real legal move');
    assert.equal(moveKey(move), choice.moveKey, 'moveKey matches the indexed move');
  });

  test('unreachable engine rejects with WsEngineUnreachableError, not a silent fallback', async () => {
    const closedPort = await reserveClosedPort();
    const driver = new GameDriver();

    await assert.rejects(
      () =>
        new WsGameDriver({
          session: driver.toJSON(),
          url: `ws://localhost:${closedPort}`,
        }).playAiMove(1),
      WsEngineUnreachableError,
    );
  });

  test('pre-aborted signal returns aborted without opening a socket', async () => {
    const testServer = await ensureServer();
    const driver = new GameDriver();
    const abortController = new AbortController();
    abortController.abort();

    const result = await new WsGameDriver({ session: driver.toJSON(), url: testServer.url() }).playAiMove(
      1,
      abortController.signal,
    );

    assert.deepEqual(result, { played: false, aborted: true });
  });

  test('mid-flight abort rejects with Error("Aborted")', async () => {
    const testServer = await ensureServer();
    const driver = new GameDriver();
    const abortController = new AbortController();

    // depth 6 takes ~200-300ms on the starting position — enough headroom to
    // guarantee the abort lands after the request is sent but before the
    // response arrives.
    const promise = new WsGameDriver({ session: driver.toJSON(), url: testServer.url() }).playAiMove(
      6,
      abortController.signal,
    );
    await delay(50);
    abortController.abort();

    await assert.rejects(promise, /Aborted/);
  });

  test('unresponsive engine times out instead of waiting forever', async () => {
    // A connected server that never answers — verifies the AI-thinking
    // response timeout (default 60s in production; overridden here so the
    // test doesn't actually wait a minute).
    const silentServer = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise((resolve) => silentServer.once('listening', resolve));
    silentServer.on('connection', (socket) => {
      socket.on('error', () => {});
    });

    try {
      const driver = new GameDriver();
      const { port } = silentServer.address();
      await assert.rejects(
        () =>
          new WsGameDriver({
            session: driver.toJSON(),
            url: `ws://127.0.0.1:${port}`,
            responseTimeoutMs: 50,
          }).playAiMove(1),
        /did not respond within 50ms/,
      );
    } finally {
      // The response timeout only rejects the local promise — it doesn't
      // close the still-open shared socket. Close it explicitly so the
      // server's client count drops to zero and close() below can resolve.
      WsGameDriver.terminate();
      await new Promise((resolve) => silentServer.close(resolve));
    }
  });
});
