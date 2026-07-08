// ============================================
// GameView — public facade for the whole view. Composes the board,
// status, and control-panel semantic components (plus the layout
// surface for the one remaining layout concern) and exposes the
// high-level display API the rest of the app talks to. No DOM API of
// its own; every method delegates to a semantic component.
//
// showMoveMade() no longer knows any animation-timing constants itself
// (those live entirely in the motion surface, which resolves a promise
// per effect) -- it just waits for whatever the animation view reports
// as finished. See PLAN.md Phase 7 notes for the boundary this keeps.
// ============================================

export const createGameView = ({ boardView, animationView, statusView, controlPanelView, layoutSurface }) => {
  let pendingAnimationAbort = null;

  const applyBoardState = (board) => boardView.render(board);
  const applyStatusState = (status) => statusView.render(status);

  const applyControlPanelState = (controlPanel) => {
    controlPanelView.render(controlPanel);
    if (controlPanel.collapsed) {
      layoutSurface.showGameAreaActive();
    } else {
      layoutSurface.showGameAreaDimmed();
    }
  };

  const refresh = (viewState) => {
    applyControlPanelState(viewState.controlPanel);
    applyStatusState(viewState.status);
    if (!pendingAnimationAbort) {
      applyBoardState(viewState.board);
    }
  };

  return {
    refresh,

    refreshBoard(boardState) {
      if (!pendingAnimationAbort) {
        applyBoardState(boardState);
      }
    },

    refreshStatus(statusState) {
      applyStatusState(statusState);
    },

    showSetupScreen(viewState) {
      refresh(viewState);
    },

    showPlayingScreen(viewState) {
      refresh(viewState);
    },

    showGameOverScreen(viewState) {
      refresh(viewState);
    },

    async showMoveMade(moveDisplay, settledViewState) {
      const { from, to, piece, victimPosition, victimDisplay } = moveDisplay;

      // Render the board as it looks while the piece is in flight: the
      // destination square is empty so the sliding clone is the only piece
      // visible during the animation. The source and jumped squares are
      // already empty in the settled state.
      const preAnimationBoard = {
        ...settledViewState.board,
        pieces: settledViewState.board.pieces.filter((p) =>
          !(p.position.r === to.r && p.position.c === to.c)
        ),
      };
      applyBoardState(preAnimationBoard);

      // Ripple, slide, and capture-fade are independent effects, each with
      // its own duration owned by the motion surface. Each one reacts to
      // this abort signal by resolving (and cleaning up its own element)
      // immediately once stopAnimation() calls abort(), so allSettled
      // waiting for "all of them" and "cancelled" are the same wait --
      // no separate race needed.
      const abortController = new AbortController();
      pendingAnimationAbort = abortController;
      const { signal } = abortController;

      const animations = [
        animationView.showMoveRipple(from, signal),
        animationView.showPieceMoving({ from, to, piece }, signal),
      ];
      if (victimPosition) {
        animations.push(animationView.showCapturedPieceFading(victimPosition, victimDisplay, signal));
      }

      await Promise.allSettled(animations);

      pendingAnimationAbort = null;
      if (signal.aborted) return;

      animationView.clearAnimationLayer();
      applyBoardState(settledViewState.board);
      animationView.showPieceLanding(to);
    },

    stopAnimation() {
      if (pendingAnimationAbort) {
        pendingAnimationAbort.abort();
        pendingAnimationAbort = null;
      }
      animationView.clearAnimationLayer();
    },
  };
};
