// ============================================
// GameStatusView — public facade for the status panel.
// ============================================

export const createGameStatusView = (surface) => {
  return {
    render(state) {
      const { turn, status, mustMovePiece, isAIThinking, gameConfig, pieceCounts } = state;

      surface.render({
        turn,
        status,
        mustMovePiece,
        isAIThinking,
        gameConfig,
        pieceCounts: {
          white: pieceCounts.white.total,
          black: pieceCounts.black.total,
        },
        isRestartVisible: status !== 'playing',
        isRestartEnabled: true,
      });
    },
  };
};
