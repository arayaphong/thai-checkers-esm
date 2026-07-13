// ============================================
// controlPanelClassMap — owns class names for the setup / control panel
// (game mode selector, difficulty selector, start button).
// ============================================

export const controlPanelClassMap = Object.freeze({
  collapsedToggle:
    'w-full flex items-center justify-between text-sm text-gray-400 hover:text-gray-200 transition-colors',
  collapsedModeLabel: 'text-emerald-400',
  collapsedDifficultyLabel: 'text-amber-400 text-xs',
  collapsedEditHint: 'text-xs underline',

  modeGrid: 'grid grid-cols-2 gap-2 mb-4',
  modeButtonSelected:
    'px-3 py-2.5 rounded-lg text-sm font-semibold transition-all border bg-emerald-600/20 border-emerald-500 text-emerald-400',
  modeButtonUnselected:
    'px-3 py-2.5 rounded-lg text-sm font-semibold transition-all border bg-neutral-800 border-neutral-700 text-gray-400 hover:bg-neutral-700 hover:text-gray-200',

  difficultyRow: 'flex gap-2 mb-4',
  difficultyButtonSelected:
    'flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all border bg-amber-600/20 border-amber-500 text-amber-400',
  difficultyButtonUnselected:
    'flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all border bg-neutral-800 border-neutral-700 text-gray-400 hover:bg-neutral-700',
  difficultyDescription: 'text-[10px] font-normal opacity-70',

  startButton:
    'w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors text-lg mt-2',

  hidden: 'hidden',
});
