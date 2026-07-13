import { WorkerGameDriver } from './WorkerGameDriver.mjs';

// ============================================
// AiMoveChannel — serializable, non-mutating analysis boundary.
//
// The channel receives a structured-clone-safe session (the same shape
// GameDriver#toJSON() produces), runs analysis inside a Web Worker via
// WorkerGameDriver, and returns a plain choice DTO. The authoritative driver
// that produced the session is never modified here; the caller owns the commit.
// The shared worker is intentionally left running after the request so it can
// be reused; explicit abort paths and tests terminate it when required.
// ============================================

export const requestAiMove = async ({ session, depth, signal }) => {
  if (signal?.aborted) return { played: false, aborted: true };

  const driver = new WorkerGameDriver({ session });
  const result = await driver.playAiMove(depth, signal);

  if (signal?.aborted) return { played: false, aborted: true };
  return result;
};
