// ============================================
// HtmlUiEventSource — translates delegated DOM clicks directly into
// plain UI commands. No DOM element or HTML-specific coordinate shape
// crosses this boundary.
// ============================================

export const createUiEventSource = (registry) => {
  const listeners = [];

  const emit = (command) => listeners.forEach((listener) => listener(command));

  const handleClick = (event) => {
    const squareEl = event.target.closest('[data-row]');
    if (squareEl) {
      const hasDot = !!squareEl.querySelector('.dot');
      const hasPiece = !!squareEl.querySelector('.piece');
      emit({
        type: hasDot || !hasPiece ? 'chooseMoveTarget' : 'selectPiece',
        position: { r: Number(squareEl.dataset.row), c: Number(squareEl.dataset.col) },
      });
      return;
    }

    const modeEl = event.target.closest('[data-mode]');
    if (modeEl) {
      emit({ type: 'chooseGameMode', mode: modeEl.dataset.mode });
      return;
    }

    const diffEl = event.target.closest('[data-diff]');
    if (diffEl) {
      emit({ type: 'chooseDifficulty', difficulty: diffEl.dataset.diff });
      return;
    }

    if (event.target.closest('#cancelBtn')) {
      emit({ type: 'collapseSetup' });
      return;
    }

    if (event.target.closest('#startBtn')) {
      emit({ type: 'startGame' });
      return;
    }

    if (event.target.closest('#resetBtn')) {
      emit({ type: 'restartGame' });
      return;
    }

    if (event.target.closest('[data-ui-role="setupPanel"]')) {
      emit({ type: 'expandSetup' });
    }
  };

  registry.root.addEventListener('click', handleClick);

  return {
    onUiCommand: (listener) => listeners.push(listener),
  };
};
