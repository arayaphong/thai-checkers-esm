import { coordLabel, moveDot } from '../templates/board.template.mjs';
import { boardClassMap } from '../styles/boardClassMap.mjs';
import { createPieceElement } from '../pieceElement.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
const key = (position) => `${position.r},${position.c}`;
const fromKey = (k) => {
  const [r, c] = k.split(',').map(Number);
  return { r, c };
};

const createSquareState = () => ({
  piece: null,
  selected: false,
  mandatoryCapture: false,
  moveableHint: false,
  dot: 'none',
  renderedPieceSignature: undefined,
  renderedDot: undefined,
});

// ============================================
// createBoardSurface — owns DOM construction and CSS class assignment
// for the board. Keeps a small per-square render cache so repeated
// semantic calls (e.g. re-declaring the same hint every sync) only
// touch the DOM when the square's displayed state actually changes.
// ============================================
export const createBoardSurface = (registry) => {
  const state = new Map();

  const stateFor = (position) => {
    const k = key(position);
    let s = state.get(k);
    if (!s) {
      s = createSquareState();
      state.set(k, s);
    }
    return s;
  };

  const renderPiece = (position, pieceState) => {
    const signature = pieceState.piece
      ? `${pieceState.piece.color}|${pieceState.piece.rank}|${pieceState.selected}|${pieceState.mandatoryCapture}|${pieceState.moveableHint}`
      : 'empty';
    if (pieceState.renderedPieceSignature === signature) return;
    pieceState.renderedPieceSignature = signature;

    const el = registry.getSquare(position);
    if (!el) return;
    el.querySelector('.piece')?.remove();
    if (!pieceState.piece) return;

    const pieceEl = createPieceElement(pieceState.piece, {
      selected: pieceState.selected,
      mandatoryCapture: pieceState.mandatoryCapture,
      moveableHint: pieceState.moveableHint,
    });
    el.append(pieceEl);
  };

  const renderDot = (position, dotState) => {
    if (dotState.renderedDot === dotState.dot) return;
    dotState.renderedDot = dotState.dot;

    const el = registry.getSquare(position);
    if (!el) return;
    el.querySelector('.dot')?.remove();
    if (dotState.dot === 'none') return;

    const color = dotState.dot === 'capture' ? boardClassMap.dotTargetCapture : boardClassMap.dotTargetWalk;
    el.insertAdjacentHTML('beforeend', moveDot(color));
  };

  return {
    createBoard: () => {
      const boardEl = registry.getBoard();
      [...boardEl.children].forEach((child) => child.remove());
      state.clear();
    },
    createSquare: (position, squareDisplay) => {
      const boardEl = registry.getBoard();
      const { r, c } = position;
      const el = h('div', squareDisplay.isDark ? boardClassMap.squareDark : boardClassMap.squareLight);
      el.dataset.row = String(r);
      el.dataset.col = String(c);
      if (c === 0) el.insertAdjacentHTML('beforeend', coordLabel(8 - r, squareDisplay.isDark));
      if (r === 7) el.insertAdjacentHTML('beforeend', coordLabel(String.fromCharCode(65 + c), squareDisplay.isDark));
      boardEl.append(el);
      registry.registerSquare(position, el);
      state.set(key(position), createSquareState());
      return el;
    },
    render(boardRenderState) {
      const { pieces, selectedPosition, moveablePositions, mandatoryCapturePosition, targetSquares, captureTargets } =
        boardRenderState;

      const moveableSet = new Set(moveablePositions?.map(key) || []);
      const targetSet = new Set(targetSquares?.map(key) || []);
      const captureTargetSet = new Set(captureTargets?.map(key) || []);
      const pieceMap = new Map(pieces.map((p) => [key(p.position), p]));

      // Iterate all squares, calculate desired state, and render
      [...state.keys()].forEach((k) => {
        const pos = fromKey(k);
        const squareCache = stateFor(pos);

        const pieceOnSquare = pieceMap.get(k) || null;
        const isSelected = selectedPosition && selectedPosition.r === pos.r && selectedPosition.c === pos.c;
        const isMoveable = moveableSet.has(k);
        const isMandatory = mandatoryCapturePosition && mandatoryCapturePosition.r === pos.r && mandatoryCapturePosition.c === pos.c;

        let dot = 'none';
        if (targetSet.has(k)) dot = 'walk';
        else if (captureTargetSet.has(k)) dot = 'capture';

        // Update cache before rendering, render functions will diff
        squareCache.piece = pieceOnSquare;
        squareCache.selected = isSelected;
        squareCache.moveableHint = isMoveable;
        squareCache.mandatoryCapture = isMandatory;
        squareCache.dot = dot;

        renderPiece(pos, squareCache);
        renderDot(pos, squareCache);
      });
    },
  };
};
