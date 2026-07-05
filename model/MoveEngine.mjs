// ============================================
// MoveEngine - Pure move generation & validation
// No state, pure functions only
// ============================================

export class MoveEngine {
  /**
   * Get all valid moves for a piece at (r, c) on the given board.
   * Returns separate walks and captures.
   */
  static getMovesForPiece(board, r, c) {
    const piece = board[r][c];
    if (piece === 0) return { walks: [], captures: [] };

    const isDame = Math.abs(piece) === 2;
    return isDame
      ? this.#getDameMoves(board, r, c, piece)
      : this.#getPawnMoves(board, r, c, piece);
  }

  static #getPawnMoves(board, r, c, piece) {
    const walks = [];
    const captures = [];
    const dir = piece > 0 ? -1 : 1; // white moves up (r decreases)

    // Walks
    for (const dc of [-1, 1]) {
      const nr = r + dir;
      const nc = c + dc;
      if (this.#inBounds(nr, nc) && board[nr][nc] === 0) {
        walks.push({ fromR: r, fromC: c, toR: nr, toC: nc, isCapture: false });
      }
    }

    // Captures (forward only)
    for (const dc of [-1, 1]) {
      const jr = r + dir;
      const jc = c + dc;
      const nr = r + 2 * dir;
      const nc = c + 2 * dc;
      if (this.#inBounds(nr, nc)) {
        const jumped = board[jr][jc];
        if (jumped !== 0 && Math.sign(jumped) !== Math.sign(piece) && board[nr][nc] === 0) {
          captures.push({
            fromR: r, fromC: c, toR: nr, toC: nc,
            isCapture: true, jumpedR: jr, jumpedC: jc
          });
        }
      }
    }

    return { walks, captures };
  }

  static #getDameMoves(board, r, c, piece) {
    const walks = [];
    const captures = [];

    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      let currR = r + dr;
      let currC = c + dc;
      let foundOpponent = null;

      while (this.#inBounds(currR, currC)) {
        if (board[currR][currC] === 0) {
          if (!foundOpponent) {
            walks.push({ fromR: r, fromC: c, toR: currR, toC: currC, isCapture: false });
          } else {
            captures.push({
              fromR: r, fromC: c, toR: currR, toC: currC,
              isCapture: true, jumpedR: foundOpponent.r, jumpedC: foundOpponent.c
            });
            break; // Dame lands on first empty after capture
          }
        } else if (Math.sign(board[currR][currC]) === Math.sign(piece)) {
          break; // Friendly piece blocks
        } else {
          if (foundOpponent) break; // Can't jump 2 pieces
          foundOpponent = { r: currR, c: currC };
        }
        currR += dr;
        currC += dc;
      }
    }

    return { walks, captures };
  }

  /**
   * Get ALL valid moves for a player on the given board.
   * Respects forced-capture rule: if any capture exists, only captures are valid.
   * Respects must-move-piece constraint (for multi-capture chains).
   */
  static getAllValidMoves(board, player, mustMovePiece = null) {
    const allMoves = board
      .flatMap((row, r) => row.map((piece, c) => ({ r, c, piece })))
      .filter(({ r, c, piece }) =>
        Math.sign(piece) === player &&
        (!mustMovePiece || (r === mustMovePiece.r && c === mustMovePiece.c))
      )
      .flatMap(({ r, c }) => {
        const { walks, captures } = this.getMovesForPiece(board, r, c);
        return [...walks, ...captures];
      });

    const { true: captures = [], false: walks = [] } = Object.groupBy(allMoves, m => m.isCapture);

    // Forced capture rule
    return captures.length > 0 ? captures : walks;
  }

  /**
   * Execute a move and return the result.
   * Does NOT mutate original board — returns new board.
   */
  static executeMove(board, move) {
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
    const { captures } = this.getMovesForPiece(newBoard, move.toR, move.toC);
    const canContinue = move.isCapture && !promoted && captures.length > 0;

    return {
      move,
      newBoard,
      promoted,
      canContinue,
      positionAfter: { r: move.toR, c: move.toC }
    };
  }

  /** Check if a player has any valid moves */
  static hasValidMoves(board, player) {
    return this.getAllValidMoves(board, player).length > 0;
  }

  /** Count pieces for a player */
  static countPieces(board, player) {
    const pieces = board.flat().filter(p => Math.sign(p) === player);
    const { true: dames = [], false: pawns = [] } = Object.groupBy(pieces, p => Math.abs(p) === 2);
    return { pawns: pawns.length, dames: dames.length, total: pieces.length };
  }

  static #inBounds(r, c) {
    return r >= 0 && r < 8 && c >= 0 && c < 8;
  }
}
