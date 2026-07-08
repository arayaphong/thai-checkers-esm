// ============================================
// UiActor — describes *what the user acted on*, in terms visible on
// screen (a piece, a board square, a game mode option, ...), never in
// DOM/CSS terms. Pure data, no DOM/CSS knowledge.
// ============================================

const createUiActor = (role, payload = {}) => ({ role, payload });

export const UiActor = {
  boardSquare: (position) => createUiActor('boardSquare', { position }),
  piece: (position) => createUiActor('piece', { position }),
  gameModeOption: (mode) => createUiActor('gameModeOption', { mode }),
  difficultyOption: (difficulty) => createUiActor('difficultyOption', { difficulty }),
  startGameAction: () => createUiActor('startGameAction'),
  restartGameAction: () => createUiActor('restartGameAction'),
  setupPanel: () => createUiActor('setupPanel'),
};
