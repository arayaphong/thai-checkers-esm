// ============================================
// GameView — public facade for the whole view. Composes the board,
// status, control-panel, and motion renderers and exposes the
// high-level display API the rest of the app talks to. No DOM API of
// its own; every method delegates to a semantic component.
//
// showMoveMade() no longer knows any animation-timing constants itself
// (those live entirely in the motion surface, which resolves a promise
// per effect) -- it just waits for whatever the animation view reports
// as finished. See the design notes for the boundary this keeps.
//
// All "is an animation currently playing" bookkeeping lives in
// animationLifecycle (GameViewAnimationLifecycle.mjs) as a single
// explicit record, not scattered closure variables here. Callers (e.g.
// GameViewBinder) ask via isAnimating/waitForAnimation() instead of
// keeping their own separate copy of this fact.
// ============================================

import { createGameViewAnimationLifecycle } from './GameViewAnimationLifecycle.mjs';

// Two frames create a paint opportunity after rendering turn hints or the AI
// thinking status and before synchronous AI work continues. The fallback
// keeps non-browser consumers deterministic without inventing a timing delay.
const waitForPaint = () => {
  if (typeof globalThis.requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
  });
};

const withoutTurnHints = (board) => ({
  ...board,
  selectedPosition: null,
  mandatoryCapturePosition: null,
  moveablePositions: [],
  targetSquares: [],
  captureTargets: [],
});

export const createGameView = ({ boardView, animationView, statusView, controlPanelView }) => {
  const animationLifecycle = createGameViewAnimationLifecycle();

  const applyBoardState = (board) => boardView.render(board);
  const applyStatusState = (status) => statusView.render(status);

  const refresh = (viewState) => {
    controlPanelView.render(viewState.controlPanel);
    applyStatusState(viewState.status);
    // Guard against clobbering the board mid-animation; unguarded again
    // once animationLifecycle.isAnimating() becomes false.
    if (!animationLifecycle.isAnimating()) {
      applyBoardState(viewState.board);
    }
  };

  // Pure animation sequencing -- signal is supplied by
  // animationLifecycle.beginAnimation(), which owns all "is an
  // animation currently playing" bookkeeping.
  const runMoveAnimation = async (moveDisplay, settledViewState, signal) => {
    const { from, to, piece, victimPosition, victimDisplay } = moveDisplay;
    const victimEntry = victimPosition ? [{ position: victimPosition, ...victimDisplay }] : [];
    const originEntry = [{ position: from, ...piece }];
    const animationBoard = withoutTurnHints(settledViewState.board);
    const basePieces = settledViewState.board.pieces.filter(
      (p) => !(p.position.r === to.r && p.position.c === to.c),
    );
    const renderPieces = (pieces) => applyBoardState({ ...animationBoard, pieces });

    try {
      // 1. Lift: keep the real origin piece visible under the ripple.
      renderPieces(basePieces.concat(originEntry, victimEntry));
      await animationView.showMoveRipple(from, signal);
      if (signal.aborted) return;

      // 2. Slide: remove the synthesized origin and hand off to the clone.
      renderPieces(basePieces.concat(victimEntry));
      await animationView.showPieceMoving({ from, to, piece }, signal);
      if (signal.aborted) return;

      // 3. Land: replace the clone with the real destination piece.
      animationView.clearAnimationLayer();
      renderPieces(settledViewState.board.pieces.concat(victimEntry));
      await animationView.showPieceLanding(to, signal);
      if (signal.aborted) return;

      // 4. Fade-captured: the victim remains real through landing.
      if (victimPosition) {
        await animationView.showCapturedPieceFading(victimPosition, signal);
        if (signal.aborted) return;
      }
    } finally {
      if (!signal.aborted) {
        try {
          animationView.clearAnimationLayer();
        } finally {
          applyBoardState(settledViewState.board);
        }
      }
    }
  };

  const stopAnimation = () => {
    animationLifecycle.cancelAnimation();
    animationView.clearAnimationLayer();
  };

  return {
    refresh,

    refreshBoard: (boardState) => {
      if (!animationLifecycle.isAnimating()) {
        applyBoardState(boardState);
      }
    },

    refreshStatus: (statusState) => {
      applyStatusState(statusState);
    },

    isAnimating: () => animationLifecycle.isAnimating(),

    // Resolves once whatever animation is currently in flight settles.
    // Never rejects: callers sequencing a screen transition after the
    // current move (gameOver, markSetupExpanded) care about "has it
    // finished," not about an animation-layer failure.
    waitForAnimation: () => animationLifecycle.waitForAnimation(),

    waitForPaint,

    showMoveMade: (moveDisplay, settledViewState) => {
      if (animationLifecycle.isAnimating()) stopAnimation();
      return animationLifecycle.beginAnimation((signal) =>
        runMoveAnimation(moveDisplay, settledViewState, signal),
      );
    },

    stopAnimation,
  };
};
