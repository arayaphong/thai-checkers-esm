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
// as finished. See the design notes for the boundary this keeps.
//
// pendingAnimationDone is the single source of truth for "is an
// animation currently playing." Callers (e.g. GameViewBinder) ask via
// isAnimating/waitForAnimation() instead of keeping their own separate
// copy of this fact -- a duplicated tracker is exactly what let a
// stale continuation clobber a newer animation's state in practice.
// ============================================

export const createGameView = ({ boardView, animationView, statusView, controlPanelView, layoutSurface }) => {
  let pendingAnimationAbort = null;
  let pendingAnimationDone = null;

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
    // Guard against clearing a newer animation's abort controller
    // when a new animation starts while one is still pending.
    if (!pendingAnimationAbort) {
      applyBoardState(viewState.board);
    }
  };

  const performMoveAnimation = async (moveDisplay, settledViewState) => {
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

    // Only clear our own abort handle. A newer animation (e.g. the next
    // AI move arriving before this one finished) may have already taken
    // over pendingAnimationAbort; clearing it here would let refresh()
    // re-render the board mid-flight and make the slide look incomplete.
    if (pendingAnimationAbort === abortController) {
      pendingAnimationAbort = null;
    }
    if (signal.aborted) return;

    animationView.clearAnimationLayer();
    applyBoardState(settledViewState.board);
    animationView.showPieceLanding(to);
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

    get isAnimating() {
      return pendingAnimationDone !== null;
    },

    // Resolves once whatever animation is currently in flight settles.
    // Never rejects: callers sequencing a screen transition after the
    // current move (gameOver, markSetupExpanded) care about "has it
    // finished," not about an animation-layer failure.
    waitForAnimation() {
      return pendingAnimationDone ? pendingAnimationDone.catch(() => {}) : Promise.resolve();
    },

    showMoveMade(moveDisplay, settledViewState) {
      const donePromise = performMoveAnimation(moveDisplay, settledViewState);
      pendingAnimationDone = donePromise;
      donePromise.finally(() => {
        // Only clear our own handle -- a newer showMoveMade() call may
        // have already taken over pendingAnimationDone.
        if (pendingAnimationDone === donePromise) {
          pendingAnimationDone = null;
        }
      });
      return donePromise;
    },

    stopAnimation() {
      if (pendingAnimationAbort) {
        pendingAnimationAbort.abort();
        pendingAnimationAbort = null;
      }
      pendingAnimationDone = null;
      animationView.clearAnimationLayer();
    },
  };
};
