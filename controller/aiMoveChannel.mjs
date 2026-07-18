import { WorkerGameDriver } from './WorkerGameDriver.mjs';
import { WsGameDriver } from './WsGameDriver.mjs';

// ============================================
// AiMoveChannel — serializable, non-mutating analysis boundary.
//
// The channel receives a structured-clone-safe session (the same shape
// GameDriver#toJSON() produces) and returns a plain choice DTO. The
// authoritative driver that produced the session is never modified here;
// the caller owns the commit.
//
// By default analysis runs inside a Web Worker via WorkerGameDriver — the
// shared worker is intentionally left running after the request so it can
// be reused; explicit abort paths and tests terminate it when required.
//
// If a WS AI engine is configured (globalThis.__WS_ENGINE_URL__ or
// process.env.WS_ENGINE_URL — see main.mjs's `?ws=` param / cli.mjs's `-ws`
// flag), analysis is routed there instead, opt-in only: an unreachable or
// failing engine rejects rather than silently falling back to the Worker.
// ============================================

const resolveConfiguredWsUrl = () => {
  if (typeof globalThis.__WS_ENGINE_URL__ === 'string') return globalThis.__WS_ENGINE_URL__;
  if (typeof process !== 'undefined' && process.env?.WS_ENGINE_URL) return process.env.WS_ENGINE_URL;
  return null;
};

export const requestAiMove = async ({ session, depth, signal, wsUrl } = {}) => {
  if (signal?.aborted) return { played: false, aborted: true };

  const url = wsUrl ?? resolveConfiguredWsUrl();
  const driver = url ? new WsGameDriver({ session, url }) : new WorkerGameDriver({ session });
  const result = await driver.playAiMove(depth, signal);

  if (signal?.aborted) return { played: false, aborted: true };
  return result;
};
