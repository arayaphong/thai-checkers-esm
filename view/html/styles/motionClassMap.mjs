// ============================================
// motionClassMap — owns class names and timing constants for board
// move/capture animation (slide, ripple, fade, landing). Visual durations
// live in CSS; this module only keeps the transition strings and class
// names the DOM surface needs.
// ============================================

export const motionClassMap = Object.freeze({
  rippleWrapper: 'abs-fill flex-center z-10 pointer-events-none',
  rippleInner: 'w-2 h-2 rounded-full bg-white/20 animate-ripple',

  slideOverlay: 'absolute pointer-events-none',
  slideTransitionCss: 'transition:top 220ms ease-out,left 220ms ease-out;',

  captureVictimFadeTransitionCss: 'opacity 120ms ease-out, transform 120ms ease-out',

  landAnimation: 'animate-land',
});
