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
// necessarily going through a controller event -- see design notes for why
// isExpandSetup doesn't stop a pending animation while
// isRestartGame does.
// ============================================

export const createGameViewBinder = (controller, stateFactory, gameView) => {
  let gameStarted = false;
  let isAIThinking = false;
  let backupConfig = null;

  let currentTurnPath = [];
  let currentTurnCaptures = [];
  let currentTurnPromoted = false;

  const resetTurnAccumulator = () => {
    currentTurnPath = [];
    currentTurnCaptures = [];
    currentTurnPromoted = false;
  };

  const formatSquare = ({ r, c }) => `${String.fromCharCode(65 + c)}${8 - r}`;

  const currentFlags = () => ({
    gameStarted,
    isAIThinking,
    isAnimating: gameView.isAnimating,
    isCancelable: backupConfig !== null,
  });
  const currentViewState = () => stateFactory.createFromController(controller, currentFlags());
  const currentBoardState = () => stateFactory.createBoardState(controller, currentFlags());
  const currentStatusState = () => stateFactory.createStatusState(controller, currentFlags());

  const handleMoveMade = async (evt) => {
    const move = evt.data?.move;
    if (!move) return;

    gameView.stopAnimation();

    const moveDisplay = stateFactory.createMoveDisplay(controller, move);
    const settledViewState = currentViewState();

    if (currentTurnPath.length === 0) {
      currentTurnPath.push({ r: move.fromR, c: move.fromC });
    }
    currentTurnPath.push({ r: move.toR, c: move.toC });

    if (move.isCapture && move.jumpedR !== undefined && move.jumpedC !== undefined) {
      currentTurnCaptures.push({ r: move.jumpedR, c: move.jumpedC });
    }

    const animationDone = gameView.showMoveMade(moveDisplay, settledViewState);
    gameView.refreshStatus(settledViewState.status);

    await animationDone;
    gameView.refresh(currentViewState());

    if (!controller.state.mustMovePiece) {
      const formattedPath = currentTurnPath
        .map((pos, idx) => {
          const sq = formatSquare(pos);
          if (idx === currentTurnPath.length - 1 && currentTurnPromoted) {
            return '*' + sq;
          }
          return sq;
        })
        .join('->');

      const formattedCaptures =
        currentTurnCaptures.length > 0
          ? ' [' + currentTurnCaptures.map((pos) => 'x' + formatSquare(pos)).join(' ') + ']'
          : '';
      const playerColor = moveDisplay.piece.color.toUpperCase();

      console.log(`[${playerColor}] ${formattedPath}${formattedCaptures}`);

      resetTurnAccumulator();
    }
  };

  controller.on('stateChanged', (evt) => {
    // Side-effect stateChanged emissions (pieceSelected, moveMade, etc.) are
    // handled by their dedicated listeners. Only react to direct/generic
    // stateChanged events such as reset, newGame, or configUpdate.
    if (evt.type !== 'stateChanged') return;
    resetTurnAccumulator();
    gameView.refresh(currentViewState());
  });
  controller.on('pieceSelected', () => gameView.refreshBoard(currentBoardState()));
  controller.on('moveMade', (evt) => handleMoveMade(evt));
  controller.on('promotion', () => {
    currentTurnPromoted = true;
  });
  controller.on('aiThinking', () => {
    isAIThinking = true;
    gameView.refreshStatus(currentStatusState());
  });
  controller.on('aiMoved', () => {
    isAIThinking = false;
    gameView.refreshStatus(currentStatusState());
  });
  controller.on('gameOver', async () => {
    // The final move's moveMade and this gameOver event are emitted
    // back-to-back in the same synchronous emit() loop. If we stop the
    // animation and re-render now, the last piece teleports to its
    // destination instead of sliding. Wait for the in-flight slide to
    // finish first, then show the game-over screen.
    if (gameView.isAnimating) {
      await gameView.waitForAnimation();
    }
    gameView.stopAnimation();
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
      backupConfig = null;
      resetTurnAccumulator();
      gameView.showPlayingScreen(currentViewState());
    },

    async markSetupExpanded() {
      // Pause immediately -- this must beat the controller's own
      // pending AI-turn timer, not wait behind an animation that can
      // take longer than that timer does. Only the visual transition
      // to the setup screen waits for the current animation to finish,
      // so the setup screen doesn't pop in before the final slide does.
      backupConfig = { ...controller.state.config };
      gameStarted = false;
      isAIThinking = false;
      resetTurnAccumulator();
      controller.pause();

      if (gameView.isAnimating) {
        await gameView.waitForAnimation();
      }
      gameView.showSetupScreen(currentViewState());
    },

    markSetupCollapsed() {
      gameStarted = true;
      if (backupConfig) {
        controller.updateConfig(backupConfig);
        backupConfig = null;
      } else {
        gameView.refresh(currentViewState());
      }
      controller.resume();
    },

    markGameStopped() {
      gameStarted = false;
      backupConfig = null;
      resetTurnAccumulator();
      controller.pause();
      gameView.stopAnimation();
      gameView.showSetupScreen(currentViewState());
    },
  };
};
