// ============================================
// HtmlUiEventSource — listens for DOM events on the root element (one
// delegated listener, not one per interactive element) and emits raw
// semantic UI events with no DOM element attached. Reads DOM/dataset/
// visible-role details here only; everything downstream (UiIntent-
// Resolver, UiIntentDispatcher) works with plain data.
//
// Raw event shape:
//   { source, visibleRole, visibleAction, position? | mode? | difficulty? }
// ============================================

export const createUiEventSource = (registry) => {
  const listeners = [];

  const emit = (rawEvent) => listeners.forEach((listener) => listener(rawEvent));

  const handleClick = (event) => {
    const squareEl = event.target.closest('[data-row]');
    if (squareEl) {
      const hasDot = !!squareEl.querySelector('.dot');
      const hasPiece = !!squareEl.querySelector('.piece');
      emit({
        source: 'board',
        visibleRole: hasDot ? 'boardSquare' : (hasPiece ? 'piece' : 'boardSquare'),
        visibleAction: 'press',
        position: { row: Number(squareEl.dataset.row), col: Number(squareEl.dataset.col) },
      });
      return;
    }

    const modeEl = event.target.closest('[data-mode]');
    if (modeEl) {
      emit({ source: 'control-panel', visibleRole: 'gameModeOption', visibleAction: 'press', mode: modeEl.dataset.mode });
      return;
    }

    const diffEl = event.target.closest('[data-diff]');
    if (diffEl) {
      emit({ source: 'control-panel', visibleRole: 'difficultyOption', visibleAction: 'press', difficulty: diffEl.dataset.diff });
      return;
    }

    if (event.target.closest('#startBtn')) {
      emit({ source: 'control-panel', visibleRole: 'startGameAction', visibleAction: 'press' });
      return;
    }

    if (event.target.closest('#resetBtn')) {
      emit({ source: 'status', visibleRole: 'restartGameAction', visibleAction: 'press' });
      return;
    }

    if (event.target.closest('[data-ui-role="setupPanel"]')) {
      emit({ source: 'control-panel', visibleRole: 'setupPanel', visibleAction: 'press' });
    }
  };

  registry.root.addEventListener('click', handleClick);

  return {
    onUiEvent: (listener) => listeners.push(listener),
  };
};
