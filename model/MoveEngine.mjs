// ============================================
// MoveEngine - Pure move generation & validation
// No state, pure functions only
// ============================================

const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;

/**
 * Get walk/capture moves for a pawn at (r, c).
 */
const getPawnMoves = (board, r, c, piece) => {
  const dir = piece > 0 ? -1 : 1; // white moves up (r decreases)

  const walks = [-1, 1]
    .map((dc) => ({ nr: r + dir, nc: c + dc }))
    .filter(({ nr, nc }) => inBounds(nr, nc) && board[nr][nc] === 0)
    .map(({ nr, nc }) => ({ fromR: r, fromC: c, toR: nr, toC: nc, isCapture: false }));

  // Captures (forward only)
  const captures = [-1, 1]
    .map((dc) => ({ jr: r + dir, jc: c + dc, nr: r + 2 * dir, nc: c + 2 * dc }))
    .filter(({ jr, jc, nr, nc }) => {
      if (!inBounds(nr, nc)) return false;
      const jumped = board[jr][jc];
      return jumped !== 0 && Math.sign(jumped) !== Math.sign(piece) && board[nr][nc] === 0;
    })
    .map(({ jr, jc, nr, nc }) => ({ fromR: r, fromC: c, toR: nr, toC: nc, isCapture: true, jumpedR: jr, jumpedC: jc }));

  return { walks, captures };
};

/**
 * Scan one diagonal ray from (r, c) in direction (dr, dc) for a dame,
 * recursively: an empty square before any opponent is a walk (scan
 * continues past it); the first empty square after exactly one
 * opponent is a capture landing square (scan stops there); a friendly
 * piece, a second opponent, or the board edge stops the scan with
 * nothing more to add.
 */
const scanDameRay = (board, piece, r, c, dr, dc) => {
  const step = (currR, currC, foundOpponent) => {
    if (!inBounds(currR, currC)) return { walks: [], captures: [] };

    const cell = board[currR][currC];

    if (cell === 0) {
      if (!foundOpponent) {
        const rest = step(currR + dr, currC + dc, null);
        return {
          walks: [{ fromR: r, fromC: c, toR: currR, toC: currC, isCapture: false }, ...rest.walks],
          captures: rest.captures,
        };
      }
      return {
        walks: [],
        captures: [{
          fromR: r, fromC: c, toR: currR, toC: currC,
          isCapture: true, jumpedR: foundOpponent.r, jumpedC: foundOpponent.c,
        }],
      };
    }

    if (Math.sign(cell) === Math.sign(piece)) return { walks: [], captures: [] }; // Friendly piece blocks
    if (foundOpponent) return { walks: [], captures: [] }; // Can't jump 2 pieces

    return step(currR + dr, currC + dc, { r: currR, c: currC });
  };

  return step(r + dr, c + dc, null);
};

/**
 * Get walk/capture moves for a dame (king) at (r, c).
 */
const getDameMoves = (board, r, c, piece) => {
  const rays = [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    .map(([dr, dc]) => scanDameRay(board, piece, r, c, dr, dc));

  return {
    walks: rays.flatMap((ray) => ray.walks),
    captures: rays.flatMap((ray) => ray.captures),
  };
};

/**
 * Get all valid moves for a piece at (r, c) on the given board.
 * Returns separate walks and captures.
 */
const getMovesForPiece = (board, r, c) => {
  const piece = board[r][c];
  if (piece === 0) return { walks: [], captures: [] };

  const isDame = Math.abs(piece) === 2;
  return isDame ? getDameMoves(board, r, c, piece) : getPawnMoves(board, r, c, piece);
};

/**
 * Get ALL valid moves for a player on the given board.
 * Respects forced-capture rule: if any capture exists, only captures are valid.
 * Respects must-move-piece constraint (for multi-capture chains).
 */
const getAllValidMoves = (board, player, mustMovePiece = null) => {
  const allMoves = board
    .flatMap((row, r) => row.map((piece, c) => ({ r, c, piece })))
    .filter(({ r, c, piece }) =>
      Math.sign(piece) === player &&
      (!mustMovePiece || (r === mustMovePiece.r && c === mustMovePiece.c))
    )
    .flatMap(({ r, c }) => {
      const { walks, captures } = getMovesForPiece(board, r, c);
      return [...walks, ...captures];
    });

  const { true: captures = [], false: walks = [] } = Object.groupBy(allMoves, (m) => m.isCapture);

  // Forced capture rule
  return captures.length > 0 ? captures : walks;
};

/**
 * Execute a move and return the result.
 * Does NOT mutate original board — returns new board.
 */
const executeMove = (board, move) => {
  const newBoard = structuredClone(board);
  const piece = newBoard[move.fromR][move.fromC];

  newBoard[move.fromR][move.fromC] = 0;
  newBoard[move.toR][move.toC] = piece;

  if (move.isCapture && move.jumpedR !== undefined && move.jumpedC !== undefined) {
    newBoard[move.jumpedR][move.jumpedC] = 0;
  }

  // Promotion check
  let promoted = false;
  if (Math.abs(piece) === 1) {
    if ((piece === 1 && move.toR === 0) || (piece === -1 && move.toR === 7)) {
      newBoard[move.toR][move.toC] = piece * 2;
      promoted = true;
    }
  }

  // Check if can continue capturing
  const { captures } = getMovesForPiece(newBoard, move.toR, move.toC);
  const canContinue = move.isCapture && !promoted && captures.length > 0;

  return {
    move,
    newBoard,
    promoted,
    canContinue,
    positionAfter: { r: move.toR, c: move.toC }
  };
};

/** Check if a player has any valid moves */
const hasValidMoves = (board, player) => getAllValidMoves(board, player).length > 0;

/** Count pieces for a player */
const countPieces = (board, player) => {
  const pieces = board.flat().filter((p) => Math.sign(p) === player);
  const { true: dames = [], false: pawns = [] } = Object.groupBy(pieces, (p) => Math.abs(p) === 2);
  return { pawns: pawns.length, dames: dames.length, total: pieces.length };
};

export const MoveEngine = {
  getMovesForPiece,
  getAllValidMoves,
  executeMove,
  hasValidMoves,
  countPieces,
};
