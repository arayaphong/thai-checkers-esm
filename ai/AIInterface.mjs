// ============================================
// AIInterface - Abstract base for all AI players
// Pluggable: implement makeMove() for any strategy
// ============================================

export const DEFAULT_AI_CONFIG = {
  difficulty: 'medium',
  thinkTimeMs: 500
};

export class AIInterface {
  #name;
  #config;

  constructor(name, config = {}) {
    this.#name = name;
    this.#config = { ...DEFAULT_AI_CONFIG, ...config };
  }

  get name() { return this.#name; }
  get config() { return this.#config; }

  /**
   * Select the best move given current game state.
   * Must be async to allow for future async computations (WebWorker, API, etc.)
   */
  async makeMove(state) {
    throw new Error('makeMove must be implemented');
  }

  /**
   * Simulated thinking delay — call before returning move
   * for better UX (AI feels like it's "thinking")
   */
  async think() {
    const { promise, resolve } = Promise.withResolvers();
    setTimeout(resolve, this.#config.thinkTimeMs);
    return promise;
  }

  /** Get a description of the AI strategy */
  get description() {
    return 'Base AI';
  }
}
