// ============================================
// GameViewBinder — subscribes to controller events, asks
// GameViewStateFactory to translate the resulting state, and forwards
// semantic display instructions to GameView. Also owns the small
// view-only flags (gameStarted and isAIThinking) that used
// to live directly in the old DOM view, since the controller/model do
// not track them.
//
// markGameStarted()/markSetupExpanded()/markGameStopped() are called
// by the UI command wiring (view/html/htmlUiEventSource.mjs's consumer)
// for the three interactions that change these flags without
// necessarily going through a controller event.
// ============================================

export const createGameViewBinder = (controller, stateFactory, gameView) => {
  let gameStarted = false;
  let isAIThinking = false;
  let backupConfig = null;
  let moveRenderGeneration = 0;
  let navigationGeneration = 0;

  const invalidateMoveRender = () => {
    moveRenderGeneration += 1;
    gameView.stopAnimation();
  };

  const currentFlags = () => ({
    gameStarted,
    isAIThinking,
    isCancelable: backupConfig !== null,
  });
  const currentViewState = () => stateFactory.createFromController(controller, currentFlags());
  const currentBoardState = () => stateFactory.createBoardState(controller);
  const currentStatusState = () => stateFactory.createStatusState(controller, currentFlags());

  const handleMoveMade = async (evt) => {
    const move = evt.data?.move;
    if (!move) return;

    // An earlier listener may have synchronously reset/replaced controller.state.
    // Do not let that stale event cancel the replacement animation.
    if (evt.state !== controller.state) return;

    const myRenderGeneration = ++moveRenderGeneration;
    gameView.stopAnimation();

    const moveDisplay = stateFactory.createMoveDisplay(controller, move);
    const settledViewState = currentViewState();

    try {
      await gameView.showMoveMade(moveDisplay, settledViewState);
    } finally {
      if (moveRenderGeneration === myRenderGeneration) {
        // Re-read here: same-generation config/state may have changed.
        gameView.refresh(currentViewState());
      }
    }
  };

  controller.on('stateChanged', (evt) => {
    // Side-effect stateChanged emissions (pieceSelected, moveMade, etc.) are
    // handled by their dedicated listeners. Only react to direct/generic
    // stateChanged events such as reset, newGame, or configUpdate.
    if (evt.type !== 'stateChanged') return;
    navigationGeneration += 1;
    invalidateMoveRender();
    gameView.refresh(currentViewState());
  });
  controller.on('pieceSelected', () => gameView.refreshBoard(currentBoardState()));
  controller.on('moveMade', (evt) => handleMoveMade(evt));
  controller.on('turnReady', async () => {
    gameView.refreshBoard(currentBoardState());
    await gameView.waitForPaint();
  });
  controller.on('aiThinking', async () => {
    isAIThinking = true;
    gameView.refreshStatus(currentStatusState());
    await gameView.waitForPaint();
  });
  controller.on('aiMoved', () => {
    isAIThinking = false;
    gameView.refreshStatus(currentStatusState());
  });
  controller.on('gameOver', async () => {
    // The controller awaits moveMade, so by the time gameOver fires the
    // animation has already settled in the normal path. This wait is a
    // defensive safety net for any edge case where the two events arrive
    // while the view is still finishing up.
    if (gameView.isAnimating()) {
      await gameView.waitForAnimation();
    }
    gameView.stopAnimation();
    gameView.refresh(currentViewState());
  });
  controller.on('multiCapture', () => {
    gameView.refreshBoard(currentBoardState());
    gameView.refreshStatus(currentStatusState());
  });

  return {
    isGameStarted: () => gameStarted,

    isAIThinking: () => isAIThinking,

    refreshNow: () => {
      gameView.refresh(currentViewState());
    },

    markGameStarted: () => {
      navigationGeneration += 1;
      gameStarted = true;
      backupConfig = null;
      gameView.refresh(currentViewState());
    },

    markSetupExpanded: async () => {
      const myNavigationGeneration = ++navigationGeneration;
      const nextBackupConfig = { ...controller.state.config };
      controller.pause();
      await controller.waitForQuiescence();
      if (navigationGeneration !== myNavigationGeneration) return;

      if (gameView.isAnimating()) await gameView.waitForAnimation();
      if (navigationGeneration !== myNavigationGeneration) return;

      backupConfig = nextBackupConfig;
      gameStarted = false;
      isAIThinking = false;
      gameView.refresh(currentViewState());
    },

    markSetupCollapsed: () => {
      navigationGeneration += 1;
      gameStarted = true;
      if (backupConfig) {
        controller.updateConfig(backupConfig);
        backupConfig = null;
      } else {
        gameView.refresh(currentViewState());
      }
      controller.resume();
    },

    markGameStopped: () => {
      navigationGeneration += 1;
      gameStarted = false;
      backupConfig = null;
      isAIThinking = false;
      invalidateMoveRender();
      controller.pause();
      gameView.refresh(currentViewState());
    },
  };
};
