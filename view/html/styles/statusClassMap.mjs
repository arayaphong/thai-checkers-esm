// ============================================
// statusClassMap — owns class names for the status/turn/result panel.
// ============================================

export const statusClassMap = Object.freeze({
  turnBadgeActiveWhite: 'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all bg-stone-50 border-emerald-500',
  turnBadgeActiveBlack: 'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all bg-neutral-700 border-emerald-500',
  turnBadgeInactive: 'flex items-center gap-2 px-3 py-2 rounded-lg border transition-all bg-neutral-800 border-neutral-700 opacity-60',

  whiteLabelActive: 'font-bold text-neutral-800',
  whiteLabelInactive: 'font-bold text-gray-400',
  blackLabelActive: 'font-bold text-gray-100',
  blackLabelInactive: 'font-bold text-gray-400',

  resultBannerWinner: 'text-lg font-bold text-emerald-400',
  aiThinkingText: 'text-emerald-400 animate-pulse flex items-center justify-center gap-2',
  currentTurnLabelWhite: 'text-stone-100 ml-2 font-bold',
  currentTurnLabelBlack: 'text-gray-300 ml-2 font-bold',
  mandatoryCaptureBadge: 'text-sm font-bold text-rose-400 animate-pulse bg-rose-900/30 px-3 py-1 rounded-full inline-flex items-center gap-1 border border-rose-800 mt-2',

  resetButton: 'flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-gray-200 px-4 py-2 rounded-lg font-semibold transition-colors border border-neutral-700',

  pieceCountWhiteValue: 'font-bold text-stone-300 text-sm',
  pieceCountBlackValue: 'font-bold text-neutral-300 text-sm',

  hidden: 'hidden',
});
