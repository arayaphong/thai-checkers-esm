import { UiActor } from './UiActor.mjs';
import { UiAction } from './UiAction.mjs';

// ============================================
// UiIntent — combines a UiActor and a UiAction into one readable,
// testable unit: "the user pressed this piece to select it". Pure
// data + predicates, no DOM/CSS knowledge, never calls the controller.
// ============================================

const createUiIntent = (actor, action) => ({
  actor,
  action,
  isSelectPiece: () => action.kind === 'selectPiece',
  isChooseMoveTarget: () => action.kind === 'chooseMoveTarget',
  isChooseGameMode: () => action.kind === 'chooseGameMode',
  isChooseDifficulty: () => action.kind === 'chooseDifficulty',
  isStartGame: () => action.kind === 'startGame',
  isRestartGame: () => action.kind === 'restartGame',
  isExpandSetup: () => action.kind === 'expandSetup',
  isCollapseSetup: () => action.kind === 'collapseSetup',
});

export const UiIntent = {
  selectPiece: ({ position }) => createUiIntent(UiActor.piece(position), UiAction.selectPiece()),
  chooseMoveTarget: ({ position }) =>
    createUiIntent(UiActor.boardSquare(position), UiAction.chooseMoveTarget()),
  chooseGameMode: ({ mode }) =>
    createUiIntent(UiActor.gameModeOption(mode), UiAction.chooseGameMode()),
  chooseDifficulty: ({ difficulty }) =>
    createUiIntent(UiActor.difficultyOption(difficulty), UiAction.chooseDifficulty()),
  startGame: () => createUiIntent(UiActor.startGameAction(), UiAction.startGame()),
  restartGame: () => createUiIntent(UiActor.restartGameAction(), UiAction.restartGame()),
  expandSetup: () => createUiIntent(UiActor.setupPanel(), UiAction.expandSetup()),
  collapseSetup: () => createUiIntent(UiActor.setupPanel(), UiAction.collapseSetup()),
};
