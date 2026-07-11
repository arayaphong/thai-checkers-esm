// ============================================
// GameViewStateFactory — translates controller/model state (plus a
// few view-only flags GameViewBinder owns: gameStarted, isAIThinking,
// isAnimating) into plain display-state data. No DOM, no game rules
// beyond reading what the model already computed (validMoves,
// mustMovePiece, status).
// ============================================

/**
 * Coordinate position in the MVC model and view layers.
 * - r: row index (0..7, where 0 is rank 8/top and 7 is rank 1/bottom)
 * - c: column index (0..7, where 0 is file A/left and 7 is file H/right)
 * @typedef {Object} ModelPos
 * @property {number} r
 * @property {number} c
 */

/**
 * Translates a raw board cell integer value to a piece display descriptor.
 * @param {number} boardValue >0 for white, <0 for black, 0 for empty, absolute value 2 for king/dame
 * @returns {{color: string|null, rank: string}}
 */
export const toPieceDisplay = (boardValue) => ({
  color: boardValue === 0 ? null : boardValue > 0 ? 'white' : 'black',
  rank: Math.abs(boardValue) === 2 ? 'king' : 'man',
});

/**
 * Translates a 2D raw board array into an array of piece display descriptors.
 * @param {number[][]} board
 * @returns {Array<{position: ModelPos, color: string, rank: string}>}
 */
export const toPieceDisplays = (board) =>
  board.flatMap((row, r) =>
    row.flatMap((v, c) => {
      if (v === 0) return [];
      return [
        {
          position: { r, c },
          ...toPieceDisplay(v),
        },
      ];
    }),
  );

const createScreenState = (controller, { gameStarted, isAnimating }) => {
  const { status } = controller.state;
  if (status !== 'playing') return 'gameover';
  if (isAnimating) return 'animating';
  if (gameStarted) return 'playing';
  return 'setup';
};

/**
 * Find all positions containing pieces that are allowed to make a valid move.
 * @param {Array<Object>} validMoves
 * @param {ModelPos|null} selectedPiece
 * @param {ModelPos|null} mustMovePiece
 * @returns {ModelPos[]}
 */
const getMoveablePositions = (validMoves, selectedPiece, mustMovePiece) => {
  if (mustMovePiece) return [];
  const uniqueFromPositions = [...new Set(validMoves.map((m) => `${m.fromR},${m.fromC}`))].map(
    (k) => {
      const [r, c] = k.split(',').map(Number);
      return { r, c };
    },
  );

  return uniqueFromPositions.filter(
    (p) => !(selectedPiece && selectedPiece.r === p.r && selectedPiece.c === p.c),
  );
};

/**
 * Returns the position of a piece that is forced to continue capturing, or null.
 * @param {ModelPos|null} selectedPiece
 * @param {ModelPos|null} mustMovePiece
 * @returns {ModelPos|null}
 */
const getMandatoryCapturePosition = (selectedPiece, mustMovePiece) => {
  if (
    mustMovePiece &&
    !(selectedPiece && selectedPiece.r === mustMovePiece.r && selectedPiece.c === mustMovePiece.c)
  ) {
    return mustMovePiece;
  }
  return null;
};

/**
 * Find non-capture target squares for the selected piece.
 * @param {Array<Object>} validMoves
 * @param {ModelPos|null} selectedPiece
 * @returns {ModelPos[]}
 */
const getTargetSquares = (validMoves, selectedPiece) => {
  if (!selectedPiece) return [];
  const movesForSel = validMoves.filter(
    (m) => m.fromR === selectedPiece.r && m.fromC === selectedPiece.c,
  );
  return movesForSel.filter((m) => !m.isCapture).map((m) => ({ r: m.toR, c: m.toC }));
};

/**
 * Find capture target squares for the selected piece.
 * @param {Array<Object>} validMoves
 * @param {ModelPos|null} selectedPiece
 * @returns {ModelPos[]}
 */
const getCaptureTargets = (validMoves, selectedPiece) => {
  if (!selectedPiece) return [];
  const movesForSel = validMoves.filter(
    (m) => m.fromR === selectedPiece.r && m.fromC === selectedPiece.c,
  );
  return movesForSel.filter((m) => m.isCapture).map((m) => ({ r: m.toR, c: m.toC }));
};

/**
 * Translates controller/model state into a display board state representation.
 * @param {Object} controller
 * @returns {{
 *   pieces: Array<{position: ModelPos, color: string, rank: string}>,
 *   selectedPosition: ModelPos|null,
 *   mandatoryCapturePosition: ModelPos|null,
 *   moveablePositions: ModelPos[],
 *   targetSquares: ModelPos[],
 *   captureTargets: ModelPos[]
 * }}
 */
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
    isCancelable: !!flags.isCancelable,
  };
};

export const createFromController = (controller, flags) => ({
  screen: createScreenState(controller, flags),
  board: createBoardState(controller),
  status: createStatusState(controller, flags),
  controlPanel: createControlPanelState(controller, flags),
});

/**
 * Translates a move object from the controller/model into a display representation for animations.
 * @param {Object} controller
 * @param {Object} move
 * @returns {{
 *   from: ModelPos,
 *   to: ModelPos,
 *   piece: {color: string, rank: string},
 *   victimPosition: ModelPos|null,
 *   victimDisplay: {color: string, rank: string}|null
 * }}
 */
export const createMoveDisplay = (controller, move) => {
  const { state } = controller;
  // Read the board AFTER the move was applied: executeMove() mutates
  // state before emitting 'moveMade', so board[toR][toC] already holds
  // the piece that just landed (and is promoted if it reached the back rank).
  const rawPiece = state.board[move.toR][move.toC];
  const piece = toPieceDisplay(rawPiece);
  const from = { r: move.fromR, c: move.fromC };
  const to = { r: move.toR, c: move.toC };
  const victimPosition =
    move.isCapture && move.jumpedR !== undefined ? { r: move.jumpedR, c: move.jumpedC } : null;
  // The captured piece's own rank is discarded here (always rendered as a
  // plain man), matching the pre-existing baseline behavior preserved
  // since Phase 3.
  const victimDisplay = victimPosition
    ? { color: piece.color === 'white' ? 'black' : 'white', rank: 'man' }
    : null;
  return { from, to, piece, victimPosition, victimDisplay };
};
