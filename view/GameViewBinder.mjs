// ============================================
// GameViewBinder — subscribes to controller events, asks
// GameViewStateFactory to translate the resulting state, and forwards
// semantic display instructions to GameView. Also owns the small
// view-only flags (gameStarted, isAIThinking, isAnimating) that used
// to live directly in the old DOM view, since the controller/model do
// not track them.
//
// markGameStarted()/markSetupExpanded()/markGameStopped() are called
// by the UI intent wiring (view/html/HtmlUiEventSource.mjs's consumer)
// for the three interactions that change these flags without
// necessarily going through a controller event -- see PLAN.md Phase 7
// notes for why isExpandSetup doesn't stop a pending animation while
// isRestartGame does.
// ============================================

export const createGameViewBinder = (controller, stateFactory, gameView) => {
  let gameStarted = false;
  let isAIThinking = false;
  let animInProgress = false;

  const currentFlags = () => ({ gameStarted, isAIThinking, isAnimating: animInProgress });
  const currentViewState = () => stateFactory.createFromController(controller, currentFlags());
  const currentBoardState = () => stateFactory.createBoardState(controller, currentFlags());
  const currentStatusState = () => stateFactory.createStatusState(controller, currentFlags());

  const handleMoveMade = async (evt) => {
    const move = evt.data?.move;
    if (!move) return;

    animInProgress = true;
    gameView.stopAnimation();

    const moveDisplay = stateFactory.createMoveDisplay(controller, move);
    const settledViewState = currentViewState();

    const animationDone = gameView.showMoveMade(moveDisplay, settledViewState);
    gameView.refreshStatus(settledViewState.status);

    await animationDone;
    animInProgress = false;
    gameView.refresh(currentViewState());
  };

  controller.on('stateChanged', (evt) => {
    // Side-effect stateChanged emissions (pieceSelected, moveMade, etc.) are
    // handled by their dedicated listeners. Only react to direct/generic
    // stateChanged events such as reset, newGame, or configUpdate.
    if (evt.type !== 'stateChanged') return;
    gameView.refresh(currentViewState());
  });
  controller.on('pieceSelected', () => gameView.refreshBoard(currentBoardState()));
  controller.on('moveMade', (evt) => handleMoveMade(evt));
  controller.on('aiThinking', () => {
    isAIThinking = true;
    gameView.refreshStatus(currentStatusState());
  });
  controller.on('aiMoved', () => {
    isAIThinking = false;
    gameView.refreshStatus(currentStatusState());
  });
  controller.on('gameOver', () => {
    gameView.stopAnimation();
    animInProgress = false;
    gameView.showGameOverScreen(currentViewState());
  });
  controller.on('multiCapture', () => {
    gameView.refreshBoard(currentBoardState());
    gameView.refreshStatus(currentStatusState());
  });

  return {
    get isGameStarted() {
      return gameStarted;
    },

    get isAIThinking() {
      return isAIThinking;
    },

    refreshNow() {
      gameView.refresh(currentViewState());
    },

    markGameStarted() {
      gameStarted = true;
      gameView.showPlayingScreen(currentViewState());
    },

    markSetupExpanded() {
      gameStarted = false;
      gameView.showSetupScreen(currentViewState());
    },

    markGameStopped() {
      gameStarted = false;
      gameView.stopAnimation();
      animInProgress = false;
      gameView.showSetupScreen(currentViewState());
    },
  };
};
