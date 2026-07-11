// ============================================
// boardClassMap — owns the real CSS class names for board squares,
// pieces, hint dots and coordinate labels. Semantic components import
// through surfaces, not from here.
// ============================================

export const boardClassMap = Object.freeze({
  squareDark:
    'w-full h-full flex items-center justify-center relative bg-slate-700 hover:bg-slate-600 cursor-pointer',
  squareLight: 'w-full h-full flex items-center justify-center relative bg-stone-800/60',

  coordLabelOnDark: 'abs-coord text-white',
  coordLabelOnLight: 'abs-coord text-stone-400/50',

  pieceBase:
    'piece w-[80%] h-[80%] rounded-full shadow-lg flex items-center justify-center relative z-10 transition-transform duration-200 hover:scale-105',
  pieceWhite:
    'bg-gradient-to-b from-white via-stone-200 to-stone-400 border-2 border-stone-300 shadow-stone-500/30',
  pieceBlack:
    'bg-gradient-to-b from-neutral-600 to-neutral-900 border-2 border-neutral-950 shadow-black/40',

  pieceSelected: 'ring-4 ring-yellow-400 ring-offset-2 ring-offset-slate-900',
  pieceMandatoryCapture:
    'ring-4 ring-rose-500 ring-offset-2 ring-offset-slate-700 animate-piece-pulse',
  pieceMoveableHint: 'ring-2 ring-amber-400',

  pieceInnerWhite:
    'w-[70%] h-[70%] rounded-full border flex items-center justify-center border-stone-400/40',
  pieceInnerBlack:
    'w-[70%] h-[70%] rounded-full border flex items-center justify-center border-neutral-600/40',

  kingIconWhite: 'w-3/5 h-3/5 text-amber-600',
  kingIconBlack: 'w-3/5 h-3/5 text-amber-400',

  dotBase: 'dot abs-fill flex-center z-20 pointer-events-none',
  dotInnerBase: 'w-4 h-4 sm:w-6 sm:h-6 rounded-full shadow-lg shadow-black/40 animate-target-pulse',
  dotTargetWalk: 'bg-emerald-300',
  dotTargetCapture: 'bg-rose-400 dot-capture',
});
