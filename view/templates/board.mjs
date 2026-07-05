export const coordLabel = (text, isDark) =>
  `<span class="abs-coord ${isDark ? 'text-white' : 'text-stone-400/50'}">${text}</span>`;

export const moveDot = (color) =>
  `<div class="dot abs-fill flex-center z-20 pointer-events-none"><div class="w-4 h-4 sm:w-6 sm:h-6 rounded-full shadow-lg shadow-black/40 animate-bounce-dot ${color}"></div></div>`;

export const rippleInner = '<div class="w-2 h-2 rounded-full bg-white/20 animate-ripple"></div>';
