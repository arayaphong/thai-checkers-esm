// ============================================
// UiIntentDispatcher — receives a UiIntent and maps it to the
// appropriate controller command. This is the only place in the
// intent flow that talks to the controller.
//
// chooseGameMode needs to translate a mode key (e.g. "pve") into the
// whiteIsAI/blackIsAI config booleans the controller expects -- that
// mapping is owned by ControlPanelView (view/components/control-
// panel/ControlPanelView.mjs), so the dispatcher is constructed with a reference to its
// options rather than hardcoding the mapping itself.
// ============================================

export const createUiIntentDispatcher = (controller, modeOptions) => (intent) => {
  if (!intent) return;

  if (intent.isSelectPiece()) {
    controller.selectPiece(intent.actor.payload.position);
    return;
  }
  if (intent.isChooseMoveTarget()) {
    controller.attemptMove(intent.actor.payload.position);
    return;
  }
  if (intent.isChooseGameMode()) {
    const option = modeOptions.find((m) => m.key === intent.actor.payload.mode);
    if (option) {
      controller.updateConfig({ whiteIsAI: option.whiteIsAI, blackIsAI: option.blackIsAI });
    }
    return;
  }
  if (intent.isChooseDifficulty()) {
    controller.updateConfig({ aiDifficulty: intent.actor.payload.difficulty });
    return;
  }
  if (intent.isStartGame()) {
    controller.reset({ paused: false });
    return;
  }
  if (intent.isRestartGame()) {
    controller.reset({ paused: true });
  }
  // isExpandSetup() has no controller command -- it's pure view
  // navigation, handled by the caller.
};
