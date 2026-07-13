// ============================================
// layoutClassMap — owns class names for the page shell/layout
// (root, header, panels, board frame, footer).
// ============================================

export const layoutClassMap = Object.freeze({
  rootShell:
    'min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4 font-sans text-gray-100',

  headerWrapper: 'mb-6 text-center space-y-2',
  headerTitle:
    'text-4xl font-black text-emerald-400 tracking-tight flex items-center justify-center gap-3',
  headerIcon: 'w-10 h-10',
  headerSubtitle: 'text-gray-400 font-medium',

  setupPanel: 'bg-neutral-900 rounded-2xl p-5 w-full max-w-lg mb-6 border border-neutral-700',

  gameAreaBase: 'w-full flex flex-col items-center transition-opacity duration-500',
  gameAreaInactiveModifier: 'opacity-30 pointer-events-none',

  statusPanel:
    'bg-neutral-900 shadow-xl rounded-2xl p-5 w-full max-w-lg mb-6 border border-neutral-700',

  boardFrameWrapper: 'relative group',
  boardFrameGlow:
    'absolute -inset-3 bg-gradient-to-br from-stone-700 to-stone-900 rounded-lg shadow-2xl shadow-black/60 z-0',
  boardFrameInner: 'absolute -inset-1 bg-stone-800 rounded z-0',
  boardGrid:
    'relative z-10 grid grid-cols-8 grid-rows-8 w-[340px] h-[340px] sm:w-[480px] sm:h-[480px] border-2 border-stone-900 bg-stone-950 shadow-inner overflow-hidden',

  animLayer: 'absolute z-30 pointer-events-none',
  animLayerCssText: 'position:absolute;top:0;left:0;width:100%;height:100%;',
  animLayerUiRole: 'animLayer',

  footer: 'mt-8 text-gray-400 text-sm max-w-lg text-center leading-relaxed',
  rotateButton:
    'absolute top-2 right-2 z-20 p-2 bg-neutral-950/60 hover:bg-neutral-900/80 border border-neutral-700/50 text-gray-400 hover:text-white rounded-full opacity-40 hover:opacity-100 transition-all duration-200 shadow-md backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50 pointer-events-auto',
});
