import { boardClassMap } from '../styles/boardClassMap.mjs';
import { layoutClassMap } from '../styles/layoutClassMap.mjs';
import { createPieceElement } from '../pieceElement.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
const coordLabel = (text, isDark) =>
  `<span class="${isDark ? boardClassMap.coordLabelOnDark : boardClassMap.coordLabelOnLight}">${text}</span>`;
const moveDot = (color) =>
  `<div class="${boardClassMap.dotBase}"><div class="${boardClassMap.dotInnerBase} ${color}"></div></div>`;
const BOARD_SIZE = 8;
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
  const boardEl = registry.getBoard();
  if (!boardEl) {
    throw new Error('HtmlBoardSurface: #board not found in DOM');
  }

  [...boardEl.children].forEach((child) => {
    if (child.dataset.uiRole !== layoutClassMap.animLayerUiRole) child.remove();
  });

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

    const color =
      dotState.dot === 'capture' ? boardClassMap.dotTargetCapture : boardClassMap.dotTargetWalk;
    el.insertAdjacentHTML('beforeend', moveDot(color));
  };

  for (let r = 0; r < BOARD_SIZE; r += 1) {
    for (let c = 0; c < BOARD_SIZE; c += 1) {
      const position = { r, c };
      // Model rows run top-to-bottom while core ranks run bottom-to-top.
      // The 32 playable (dark) squares have even row+column parity.
      const isDark = (r + c) % 2 === 0;
      const el = h('div', isDark ? boardClassMap.squareDark : boardClassMap.squareLight);
      el.dataset.row = String(r);
      el.dataset.col = String(c);
      if (c === 0) el.insertAdjacentHTML('beforeend', coordLabel(8 - r, isDark));
      if (r === 7) {
        el.insertAdjacentHTML('beforeend', coordLabel(String.fromCharCode(65 + c), isDark));
      }
      boardEl.append(el);
      registry.registerSquare(position, el);
      state.set(key(position), createSquareState());
    }
  }

  return {
    render: (boardRenderState) => {
      const {
        pieces,
        selectedPosition,
        moveablePositions,
        mandatoryCapturePosition,
        targetSquares,
        captureTargets,
      } = boardRenderState;

      const moveableSet = new Set(moveablePositions?.map(key) || []);
      const targetSet = new Set(targetSquares?.map(key) || []);
      const captureTargetSet = new Set(captureTargets?.map(key) || []);
      const pieceMap = new Map(pieces.map((p) => [key(p.position), p]));

      // Iterate all squares, calculate desired state, and render
      [...state.keys()].forEach((k) => {
        const pos = fromKey(k);
        const squareCache = state.get(k);

        const pieceOnSquare = pieceMap.get(k) || null;
        const isSelected =
          selectedPosition && selectedPosition.r === pos.r && selectedPosition.c === pos.c;
        const isMoveable = moveableSet.has(k);
        const isMandatory =
          mandatoryCapturePosition &&
          mandatoryCapturePosition.r === pos.r &&
          mandatoryCapturePosition.c === pos.c;

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
