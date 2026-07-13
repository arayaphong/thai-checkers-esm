import { motionClassMap } from '../styles/motionClassMap.mjs';
import { layoutClassMap } from '../styles/layoutClassMap.mjs';
import { createPieceElement } from '../pieceElement.mjs';

const h = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
const rippleInner = `<div class="${motionClassMap.rippleInner}"></div>`;
const SQUARE_PERCENT = 12.5;

// Wait for one requestAnimationFrame, but resolve immediately (with false)
// if the signal is already aborted, and cancel the queued frame + resolve
// false if it aborts while we are waiting.
const nextAnimationFrame = (signal) => {
  const { promise, resolve } = Promise.withResolvers();
  if (signal?.aborted) {
    resolve(false);
    return promise;
  }

  let rafId = requestAnimationFrame(() => {
    rafId = null;
    resolve(true);
  });

  signal?.addEventListener(
    'abort',
    () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      resolve(false);
    },
    { once: true },
  );

  return promise;
};

// Wait for every active animation/transition on the element (and optionally
// its subtree) to finish. Resolves immediately if the signal is aborted or if
// there are no active animations. Cancellation rejections from
// Animation.finished are treated as settled.
const waitForElementMotion = async (element, signal, { subtree = false } = {}) => {
  if (signal?.aborted) return;

  const animations = element.getAnimations?.({ subtree }) ?? [];
  if (animations.length === 0) return;

  const { promise: abortPromise, resolve: resolveAbort } = Promise.withResolvers();
  const abortHandler = () => resolveAbort();
  signal?.addEventListener('abort', abortHandler, { once: true });

  try {
    await Promise.race([
      Promise.allSettled(animations.map((animation) => animation.finished)),
      abortPromise,
    ]);
  } finally {
    signal?.removeEventListener('abort', abortHandler);
  }
};

// ============================================
// createMotionSurface — owns DOM construction, CSS classes, and browser
// animation lifecycle for board move/capture animation (ripple, slide,
// victim fade, landing pulse). Every primitive returns a promise that
// resolves once the browser reports its corresponding CSS
// transition/animation finished, or once the shared abort signal cancels it.
// No JS timer is used as the definition of visual completion.
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
    showPieceMoving: async ({ from, to, piece }, signal) => {
      const slide = createPieceElement(piece);
      slide.classList.add(...motionClassMap.slideOverlay.split(' '));
      slide.style.cssText = `position:absolute;width:${SQUARE_PERCENT}%;height:${SQUARE_PERCENT}%;top:${from.r * SQUARE_PERCENT}%;left:${from.c * SQUARE_PERCENT}%;padding:2.5%;z-index:30;${motionClassMap.slideTransitionCss}`;
      animLayer.append(slide);

      if (!(await nextAnimationFrame(signal))) return;
      if (!(await nextAnimationFrame(signal))) return;

      slide.style.top = `${to.r * SQUARE_PERCENT}%`;
      slide.style.left = `${to.c * SQUARE_PERCENT}%`;
      await waitForElementMotion(slide, signal);
    },

    showCapturedPieceFading: async (position, signal) => {
      const el = registry.getSquare(position);
      if (!el) return;

      const victimEl = el.querySelector('.piece');
      if (!victimEl) return;

      const originalTransition = victimEl.style.transition;
      victimEl.style.transition = motionClassMap.captureVictimFadeTransitionCss;
      victimEl.style.opacity = '0';
      victimEl.style.transform = 'scale(0.3)';

      const cleanup = () => {
        victimEl.style.transition = originalTransition;
        victimEl.style.opacity = '';
        victimEl.style.transform = '';
      };

      if (signal?.aborted) {
        cleanup();
        return;
      }

      signal.addEventListener('abort', cleanup, { once: true });
      try {
        await waitForElementMotion(victimEl, signal);
      } finally {
        signal.removeEventListener('abort', cleanup);
        // Natural completion: the board render that follows removes the
        // now-transparent victim, so no style reset is required.
      }
    },

    showPieceLanding: async (position, signal) => {
      const pieceEl = registry.getSquare(position)?.querySelector('.piece');
      if (!pieceEl) return;

      pieceEl.classList.add(motionClassMap.landAnimation);
      try {
        await waitForElementMotion(pieceEl, signal);
      } finally {
        pieceEl.classList.remove(motionClassMap.landAnimation);
      }
    },

    showMoveRipple: async (position, signal) => {
      const el = registry.getSquare(position);
      if (!el) return;

      const ripple = h('div', motionClassMap.rippleWrapper);
      ripple.innerHTML = rippleInner;
      el.append(ripple);

      try {
        await waitForElementMotion(ripple, signal, { subtree: true });
      } finally {
        ripple.remove();
      }
    },

    clearAnimationLayer: () => {
      animLayer.innerHTML = '';
    },
  };
};
