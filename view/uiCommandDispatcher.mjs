// Maps plain UI commands to controller and view-navigation operations.
// Binder bookkeeping must happen before reset(), which synchronously emits
// controller events that immediately read the binder's flags.

export const createUiCommandDispatcher = (controller, binder, modeOptions) => (command) => {
  if (!command) return;

  if (
    (command.type === 'selectPiece' || command.type === 'chooseMoveTarget') &&
    (!binder.isGameStarted() || binder.isAIThinking())
  ) {
    return;
  }

  switch (command.type) {
    case 'selectPiece':
      return controller.selectPiece(command.position);
    case 'chooseMoveTarget':
      return controller.attemptMove(command.position);
    case 'chooseGameMode': {
      const option = modeOptions.find(({ key }) => key === command.mode);
      if (option) {
        return controller.updateConfig({
          whiteIsAI: option.whiteIsAI,
          blackIsAI: option.blackIsAI,
        });
      }
      return;
    }
    case 'chooseDifficulty':
      return controller.updateConfig({ aiDifficulty: command.difficulty });
    case 'startGame': {
      binder.markGameStarted();
      return controller.reset({ paused: false });
    }
    case 'restartGame': {
      binder.markGameStopped();
      return controller.reset({ paused: true });
    }
    case 'expandSetup':
      return binder.markSetupExpanded();
    case 'collapseSetup':
      return binder.markSetupCollapsed();
  }
};
