// ============================================
// UiAction — describes *what the user did*, in terms of the action
// they took, never in DOM event terms. Pure data, no DOM/CSS knowledge.
// ============================================

const createUiAction = (kind) => ({ kind });

export const UiAction = {
  selectPiece: () => createUiAction('selectPiece'),
  chooseMoveTarget: () => createUiAction('chooseMoveTarget'),
  chooseGameMode: () => createUiAction('chooseGameMode'),
  chooseDifficulty: () => createUiAction('chooseDifficulty'),
  startGame: () => createUiAction('startGame'),
  restartGame: () => createUiAction('restartGame'),
  expandSetup: () => createUiAction('expandSetup'),
  collapseSetup: () => createUiAction('collapseSetup'),
};

