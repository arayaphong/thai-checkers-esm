// ============================================
// motionClassMap — owns class names and timing constants for board
// move/capture animation (slide, ripple, fade, landing).
// ============================================

export const motionClassMap = Object.freeze({
  rippleWrapper: 'abs-fill flex-center z-10 pointer-events-none',
  rippleInner: 'w-2 h-2 rounded-full bg-white/20 animate-ripple',
  rippleDurationMs: 350,

  slideOverlay: 'absolute pointer-events-none',
  slideTransitionCss: 'transition:top 280ms ease-out,left 280ms ease-out;',
  slideDurationMs: 280,

  captureVictimWrapper: 'absolute z-[15]',
  captureVictimFadeTransitionCss: 'opacity 150ms ease-out, transform 150ms ease-out',
  captureVictimFadeDelayMs: 160,

  landAnimation: 'animate-land',
  landAnimationDurationMs: 250,
});
