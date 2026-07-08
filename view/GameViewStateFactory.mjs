// ============================================
// GameViewStateFactory — translates controller/model state (plus a
// few view-only flags GameViewBinder owns: gameStarted, isAIThinking,
// isAnimating) into plain display-state data. No DOM, no game rules
// beyond reading what the model already computed (validMoves,
// mustMovePiece, status).
// ============================================

export const toPieceDisplay = (boardValue) => ({
  color: boardValue === 0 ? null : (boardValue > 0 ? 'white' : 'black'),
  rank: Math.abs(boardValue) === 2 ? 'king' : 'man',
});

export const toPieceDisplays = (board) =>
  board.flatMap((row, r) =>
    row.flatMap((v, c) => {
      if (v === 0) return [];
      return [{
        position: { r, c },
        ...toPieceDisplay(v),
      }];
    })
  );

const createScreenState = (controller, { gameStarted, isAnimating }) => {
  const { status } = controller.state;
  if (status !== 'playing') return 'gameover';
  if (isAnimating) return 'animating';
  if (gameStarted) return 'playing';
  return 'setup';
};

const getMoveablePositions = (validMoves, selectedPiece, mustMovePiece) => {
  if (mustMovePiece) return [];
  const uniqueFromPositions = [...new Set(validMoves.map((m) => `${m.fromR},${m.fromC}`))]
    .map((k) => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    });

  return uniqueFromPositions.filter(p => !(selectedPiece && selectedPiece.r === p.r && selectedPiece.c === p.c));
};

const getMandatoryCapturePosition = (selectedPiece, mustMovePiece) => {
  if (mustMovePiece && !(selectedPiece && selectedPiece.r === mustMovePiece.r && selectedPiece.c === mustMovePiece.c)) {
    return mustMovePiece;
  }
  return null;
};

const getTargetSquares = (validMoves, selectedPiece) => {
  if (!selectedPiece) return [];
  const movesForSel = validMoves.filter((m) => m.fromR === selectedPiece.r && m.fromC === selectedPiece.c);
  return movesForSel.filter((m) => !m.isCapture).map((m) => ({ r: m.toR, c: m.toC }));
};

const getCaptureTargets = (validMoves, selectedPiece) => {
  if (!selectedPiece) return [];
  const movesForSel = validMoves.filter((m) => m.fromR === selectedPiece.r && m.fromC === selectedPiece.c);
  return movesForSel.filter((m) => m.isCapture).map((m) => ({ r: m.toR, c: m.toC }));
};

export const createBoardState = (controller) => {
  const { state, selectedPiece } = controller;
  const { validMoves, mustMovePiece } = state;

  return {
    pieces: toPieceDisplays(state.board),
    selectedPosition: selectedPiece,
    mandatoryCapturePosition: getMandatoryCapturePosition(selectedPiece, mustMovePiece),
    moveablePositions: getMoveablePositions(validMoves, selectedPiece, mustMovePiece),
    targetSquares: getTargetSquares(validMoves, selectedPiece),
    captureTargets: getCaptureTargets(validMoves, selectedPiece),
  };
};

export const createStatusState = (controller, flags) => {
  const { state } = controller;
  return {
    turn: state.turn === 1 ? 'white' : 'black',
    status: state.status,
    mustMovePiece: state.mustMovePiece,
    isAIThinking: flags.isAIThinking,
    gameConfig: { ...state.config },
    pieceCounts: { ...state.pieceCounts },
  };
};

export const createControlPanelState = (controller, flags) => {
  const { state } = controller;
  return {
    gameConfig: { ...state.config },
    collapsed: flags.gameStarted && createScreenState(controller, flags) !== 'setup',
  };
};

export const createFromController = (controller, flags) => ({
  screen: createScreenState(controller, flags),
  board: createBoardState(controller),
  status: createStatusState(controller, flags),
  controlPanel: createControlPanelState(controller, flags),
});

// Not in PLAN.md's literal method list, but showMoveMade() needs the
// moved/captured piece descriptors -- this mirrors the computation that
// used to live inline in the old move handler.
export const createMoveDisplay = (controller, move) => {
  const { state } = controller;
  // Read the board AFTER the move was applied: executeMove() mutates
  // state before emitting 'moveMade', so board[toR][toC] already holds
  // the piece that just landed (and is promoted if it reached the back rank).
  const rawPiece = state.board[move.toR][move.toC];
  const piece = toPieceDisplay(rawPiece);
  const from = { r: move.fromR, c: move.fromC };
  const to = { r: move.toR, c: move.toC };
  const victimPosition = move.isCapture && move.jumpedR !== undefined
    ? { r: move.jumpedR, c: move.jumpedC }
    : null;
  // The captured piece's own rank is discarded here (always rendered as a
  // plain man), matching the pre-existing baseline behavior preserved
  // since Phase 3.
  const victimDisplay = victimPosition ? { color: piece.color === 'white' ? 'black' : 'white', rank: 'man' } : null;
  return { from, to, piece, victimPosition, victimDisplay };
};
