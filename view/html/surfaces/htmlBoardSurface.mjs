import { boardClassMap } from '../styles/boardClassMap.mjs';
import { layoutClassMap } from '../styles/layoutClassMap.mjs';
import { createPieceElement } from '../pieceElement.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
const coordLabel = (text, isDark) =>
  `<span class="${isDark ? boardClassMap.coordLabelOnLight : boardClassMap.coordLabelOnDark} counter-rotate-transition">${text}</span>`;
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
  isCapturedGhost: false,
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

  // Track rotation state
  let currentRotation = 0;
  if (boardEl.classList) {
    boardEl.classList.add('board-rotation-transition');
  }

  [...boardEl.children].forEach((child) => {
    if (child.dataset.uiRole !== layoutClassMap.animLayerUiRole) child.remove();
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const pathOverlay = document.createElementNS(svgNS, 'svg');
  if (pathOverlay.style) {
    pathOverlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:5;';
  }
  pathOverlay.setAttribute('viewBox', '0 0 80 80');

  const pathLine = document.createElementNS(svgNS, 'path');
  pathLine.setAttribute('id', 'movePathLine');
  pathLine.setAttribute('fill', 'none');
  pathLine.setAttribute('stroke', 'currentColor');
  pathLine.setAttribute('class', 'text-emerald-400');
  pathLine.setAttribute('opacity', '0.08');
  pathLine.setAttribute('stroke-width', '8.0');
  pathLine.setAttribute('stroke-linecap', 'round');
  pathLine.setAttribute('stroke-linejoin', 'round');
  pathLine.setAttribute('d', '');

  pathOverlay.appendChild(pathLine);
  boardEl.append(pathOverlay);

  const renderPiece = (position, pieceState) => {
    const signature = pieceState.piece
      ? `${pieceState.piece.color}|${pieceState.piece.rank}|${pieceState.selected}|${pieceState.mandatoryCapture}|${pieceState.moveableHint}|${pieceState.isCapturedGhost}`
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
      isCapturedGhost: pieceState.isCapturedGhost,
    });


    // If the piece is a King and the board is currently rotated, counter-rotate the SVG
    if (pieceState.piece.rank === 'king' && currentRotation !== 0) {
      const svg = pieceEl.querySelector('svg');
      if (svg) {
        svg.style.transform = `rotate(${-currentRotation}deg)`;
      }
    }

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
      // The 32 playable (dark) squares have odd row+column parity (A1 = dark).
      const isDark = (r + c) % 2 === 1;
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
    setRotation: (degrees) => {
      currentRotation = degrees;
      boardEl.style.transform = `rotate(${degrees}deg)`;

      const glowEl = boardEl.parentElement?.querySelector('#boardGlow');
      const innerEl = boardEl.parentElement?.querySelector('#boardInner');
      if (glowEl) glowEl.style.transform = `rotate(${degrees}deg)`;
      if (innerEl) innerEl.style.transform = `rotate(${degrees}deg)`;

      const counterDegrees = -degrees;
      boardEl.querySelectorAll('.abs-coord').forEach((el) => {
        el.style.transform = `rotate(${counterDegrees}deg)`;
      });
      boardEl.querySelectorAll('.piece svg').forEach((el) => {
        el.style.transform = `rotate(${counterDegrees}deg)`;
      });
    },

    render: (boardRenderState) => {
      const {
        pieces,
        selectedPosition,
        moveablePositions,
        mandatoryCapturePosition,
        targetSquares,
        captureTargets,
        lastMovePath,
        lastCapturedPieces,
      } = boardRenderState;

      const moveableSet = new Set(moveablePositions?.map(key) || []);
      const targetSet = new Set(targetSquares?.map(key) || []);
      const captureTargetSet = new Set(captureTargets?.map(key) || []);
      const pieceMap = new Map(pieces.map((p) => [key(p.position), p]));
      const ghostMap = new Map(lastCapturedPieces?.map((p) => [key(p.position), p]) || []);

      // Iterate all squares, calculate desired state, and render
      [...state.keys()].forEach((k) => {
        const pos = fromKey(k);
        const squareCache = state.get(k);

        let pieceOnSquare = pieceMap.get(k) || null;
        let isCapturedGhost = false;
        if (!pieceOnSquare && ghostMap.has(k)) {
          pieceOnSquare = ghostMap.get(k);
          isCapturedGhost = true;
        }

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
        squareCache.isCapturedGhost = isCapturedGhost;

        renderPiece(pos, squareCache);
        renderDot(pos, squareCache);
      });

      // Render the SVG move path line
      let d = '';
      if (lastMovePath && lastMovePath.length >= 2) {
        d = lastMovePath
          .map((pos, index) => {
            const x = pos.c * 10 + 5;
            const y = pos.r * 10 + 5;
            return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
          })
          .join(' ');
      }
      const pathEl = pathOverlay.querySelector('#movePathLine');
      if (pathEl) {
        pathEl.setAttribute('d', d);
      }
    },
  };
};
