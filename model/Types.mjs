// ============================================
// Types & Constants - Thai Checkers Game Model
// ============================================

/** Initial board setup */
export const INITIAL_BOARD = Object.freeze([
  Object.freeze([0, -1, 0, -1, 0, -1, 0, -1]),
  Object.freeze([-1, 0, -1, 0, -1, 0, -1, 0]),
  Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([0, 0, 0, 0, 0, 0, 0, 0]),
  Object.freeze([0, 1, 0, 1, 0, 1, 0, 1]),
  Object.freeze([1, 0, 1, 0, 1, 0, 1, 0])
]);

/** Default game config */
export const DEFAULT_CONFIG = Object.freeze({
  whiteIsAI: false,
  blackIsAI: false,
  aiDifficulty: 'medium'
});
