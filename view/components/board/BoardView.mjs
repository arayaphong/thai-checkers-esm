import { createBoardSquareView } from './BoardSquareView.mjs';

const BOARD_SIZE = 8;

// ============================================
// BoardView — public facade for board display. Delegates rendering
// to a board surface.
// ============================================
export const createBoardView = (surface) => {
  return {
    showBoard: () => {
      surface.createBoard();
      Array.from({ length: BOARD_SIZE }, (_, r) => r).forEach((r) => {
        Array.from({ length: BOARD_SIZE }, (_, c) => c).forEach((c) => {
          const position = { r, c };
          // Model rows run top-to-bottom while core ranks run bottom-to-top.
          // In model coordinates the 32 playable (black) squares therefore
          // have even row+column parity.
          surface.createSquare(position, createBoardSquareView(position, (r + c) % 2 === 0));
        });
      });
    },

    render: (boardState) => {
      surface.render(boardState);
    },
  };
};
