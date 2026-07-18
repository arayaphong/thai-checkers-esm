import { boardClassMap } from './styles/boardClassMap.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });

// ============================================
// createPieceElement — shared DOM construction for a single piece,
// used by both HtmlBoardSurface (persistent board pieces) and
// HtmlMotionSurface (transient animation clones), so the two surfaces
// don't duplicate the same class-assembly logic.
// ============================================

export const createPieceElement = (
  { color, rank },
  { selected = false, mandatoryCapture = false, moveableHint = false, isCapturedGhost = false } = {},
) => {
  const pieceEl = h(
    'div',
    `${boardClassMap.pieceBase} ${color === 'white' ? boardClassMap.pieceWhite : boardClassMap.pieceBlack
    } ${selected ? boardClassMap.pieceSelected : ''} ${mandatoryCapture ? boardClassMap.pieceMandatoryCapture : ''} ${moveableHint ? boardClassMap.pieceMoveableHint : ''} ${isCapturedGhost ? (color === 'white' ? boardClassMap.pieceCapturedGhostWhite : boardClassMap.pieceCapturedGhostBlack) : ''}`,
  );
  const inner = h(
    'div',
    color === 'white' ? boardClassMap.pieceInnerWhite : boardClassMap.pieceInnerBlack,
  );
  if (rank === 'king') {
    inner.innerHTML = `<svg class="${color === 'white' ? boardClassMap.kingIconWhite : boardClassMap.kingIconBlack} counter-rotate-transition"><use href="#icon-crown"/></svg>`;
  }
  pieceEl.append(inner);
  return pieceEl;
};
