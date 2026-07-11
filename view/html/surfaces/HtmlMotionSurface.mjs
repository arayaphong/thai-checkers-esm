import { rippleInner } from '../templates/board.template.mjs';
import { motionClassMap } from '../styles/motionClassMap.mjs';
import { layoutClassMap } from '../styles/layoutClassMap.mjs';
import { createPieceElement } from '../pieceElement.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
const SQUARE_PERCENT = 12.5;

// abortableTimeout — resolves after ms, or immediately once signal aborts
// (clearing the timer either way). onSettle runs exactly once, on whichever
// path wins, so a caller can clean up its own element the same way whether
// the effect finished naturally or was cancelled mid-flight.
const abortableTimeout = (ms, signal, onSettle) => {
  const { promise, resolve } = Promise.withResolvers();
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    onSettle?.();
    resolve();
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    finish();
  }, { once: true });
  return promise;
};

// ============================================
// createMotionSurface — owns DOM construction, CSS classes, and timing
// for board move/capture animation (ripple, slide, victim fade,
// landing pulse). slidePiece/fadeCapturedPiece/showMoveRipple each
// take an optional AbortSignal and return a promise that resolves once
// their own effect visually finishes (or is aborted), so a caller can
// wait for all of them (e.g. via Promise.allSettled) instead of
// guessing a single shared duration, and cancel them without leaving
// ripple/victim elements orphaned on the board -- only slidePiece's
// clone lives in animLayer, so clearAnimationLayer() alone doesn't
// reach the other two. showPieceLanding stays fire-and-forget: it
// always runs after the others have already settled, not concurrently
// with them.
// ============================================
export const createMotionSurface = (registry) => {
  const animLayer = h('div', layoutClassMap.animLayer);
  // Mark the animation layer with a data attribute so it can be
  // reliably identified and preserved during board rebuilds.
  animLayer.dataset.uiRole = layoutClassMap.animLayerUiRole;
  animLayer.style.cssText = layoutClassMap.animLayerCssText;
  const boardEl = registry.getBoard();
  if (!boardEl) {
    throw new Error('HtmlMotionSurface: #board not found in DOM');
  }
  boardEl.append(animLayer);

  return {
    slidePiece: ({ from, to, piece }, signal) => {
      const slide = createPieceElement(piece);
      slide.classList.add(...motionClassMap.slideOverlay.split(' '));
      slide.style.cssText = `position:absolute;width:${SQUARE_PERCENT}%;height:${SQUARE_PERCENT}%;top:${from.r * SQUARE_PERCENT}%;left:${from.c * SQUARE_PERCENT}%;padding:2.5%;z-index:30;${motionClassMap.slideTransitionCss}`;
      animLayer.append(slide);

      requestAnimationFrame(() => requestAnimationFrame(() => {
        slide.style.top = `${to.r * SQUARE_PERCENT}%`;
        slide.style.left = `${to.c * SQUARE_PERCENT}%`;
      }));

      return abortableTimeout(motionClassMap.slideDurationMs, signal);
    },
    fadeCapturedPiece: async (position, pieceDisplay, signal) => {
      const el = registry.getSquare(position);
      if (!el) return;

      const victimEl = createPieceElement(pieceDisplay);
      victimEl.classList.add(...motionClassMap.captureVictimWrapper.split(' '));
      el.append(victimEl);

      await abortableTimeout(motionClassMap.slideDurationMs, signal);
      if (signal?.aborted) {
        victimEl.remove();
        return;
      }

      victimEl.style.transition = motionClassMap.captureVictimFadeTransitionCss;
      victimEl.style.opacity = '0';
      victimEl.style.transform = 'scale(0.3)';

      await abortableTimeout(motionClassMap.captureVictimFadeDelayMs, signal, () => victimEl.remove());
    },
    showPieceLanding: (position) => {
      const pieceEl = registry.getSquare(position)?.querySelector('.piece');
      if (!pieceEl) return;
      pieceEl.classList.add(motionClassMap.landAnimation);
      setTimeout(() => pieceEl.classList.remove(motionClassMap.landAnimation), motionClassMap.landAnimationDurationMs);
    },
    showMoveRipple: (position, signal) => {
      const el = registry.getSquare(position);
      if (!el) return Promise.resolve();

      const ripple = h('div', motionClassMap.rippleWrapper);
      ripple.innerHTML = rippleInner;
      el.append(ripple);

      return abortableTimeout(motionClassMap.rippleDurationMs, signal, () => ripple.remove());
    },
    clearMotionLayer: () => {
      animLayer.innerHTML = '';
    },
  };
};
