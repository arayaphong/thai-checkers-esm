import { AIInterface } from './AIInterface.mjs';

// ============================================
// RandomAI - Picks a random valid move
// Simplest AI strategy, good for testing
// ============================================

export class RandomAI extends AIInterface {
  constructor() {
    super('RandomAI', { difficulty: 'easy', thinkTimeMs: 150 });
  }

  async makeMove(state) {
    await this.think();
    const moves = state.validMoves;
    if (moves.length === 0) throw new Error('No valid moves');
    return moves[Math.floor(Math.random() * moves.length)];
  }

  get description() {
    return 'RandomAI: Picks moves completely at random. Easiest opponent.';
  }
}
