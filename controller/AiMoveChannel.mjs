import { GameDriver, moveKey } from '../cli/GameDriver.mjs';

// ============================================
// AiMoveChannel — serializable, non-mutating analysis boundary.
//
// The channel receives a structured-clone-safe session (the same shape
// GameDriver#toJSON() produces), runs analysis on a scratch driver, and
// returns a plain choice DTO. The authoritative driver that produced the
// session is never modified here; the caller owns the commit.
//
// This implementation is local/synchronous because the analyzer still runs
// on the main thread, but the interface is designed so a future Worker
// transport can replace this body without changing the controller's
// validation/commit path.
// ============================================

export const requestAiMove = async ({ session, depth, signal }) => {
  if (signal?.aborted) return { played: false, aborted: true };

  const scratch = new GameDriver(session);
  const result = scratch.playAiMove(depth);

  if (signal?.aborted) return { played: false, aborted: true };
  if (!result.played) return { played: false };

  return {
    played: true,
    matchIndex: result.matchIndex,
    moveKey: moveKey(result.move),
    score: result.score,
    nodes: result.nodes,
    elapsedMs: result.elapsedMs,
  };
};
