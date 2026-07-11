// ============================================
// BoardMoveAnimationView — semantic move/capture animation display.
// Speaks in terms of what the user sees happening on the board
// (a piece moving, a captured piece fading, a piece landing, a
// ripple at the departure square), never in DOM/CSS/timing terms.
// Delegates the actual rendering and timing to a motion surface
// (e.g. HtmlMotionSurface).
// ============================================

export const createBoardMoveAnimationView = (surface) => {
  return {
    showPieceMoving: (moveDisplay, signal) => surface.slidePiece(moveDisplay, signal),
    showCapturedPieceFading: (position, pieceDisplay, signal) =>
      surface.fadeCapturedPiece(position, pieceDisplay, signal),
    showPieceLanding: (position) => surface.showPieceLanding(position),
    showMoveRipple: (position, signal) => surface.showMoveRipple(position, signal),
    clearAnimationLayer: () => surface.clearMotionLayer(),
  };
};
