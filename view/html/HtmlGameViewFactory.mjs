import { renderShell } from './templates/shell.template.mjs';
import { layoutClassMap } from './styles/layoutClassMap.mjs';
import { createElementRegistry } from './HtmlElementRegistry.mjs';
import { createBoardSurface } from './surfaces/HtmlBoardSurface.mjs';
import { createMotionSurface } from './surfaces/HtmlMotionSurface.mjs';
import { createStatusSurface } from './surfaces/HtmlStatusSurface.mjs';
import { createControlPanelSurface } from './surfaces/HtmlControlPanelSurface.mjs';
import { createLayoutSurface } from './surfaces/HtmlLayoutSurface.mjs';
import { createUiEventSource } from './HtmlUiEventSource.mjs';
import { createBoardView } from '../components/board/BoardView.mjs';
import { createBoardMoveAnimationView } from '../components/board/BoardMoveAnimationView.mjs';
import { createGameStatusView } from '../components/status/GameStatusView.mjs';
import { createControlPanelView } from '../components/control-panel/ControlPanelView.mjs';
import { createGameView } from '../GameView.mjs';
import { createGameViewBinder } from '../GameViewBinder.mjs';
import * as stateFactory from '../GameViewStateFactory.mjs';
import { resolveUiIntent } from '../intent/UiIntentResolver.mjs';
import { createUiIntentDispatcher } from '../intent/UiIntentDispatcher.mjs';

// Top-level await: this module's own evaluation (and so main.mjs's static
// import of it) doesn't finish until the page's fonts are ready, so
// createHtmlGameView() never builds the shell mid-font-swap. The current
// UI only uses the system font stack, so this settles close to instantly
// today, but stays correct if a web font is ever added.
await document.fonts.ready;

// ============================================
// HtmlGameViewFactory — composition root for the HTML implementation
// of the view. Builds the shell, every HTML surface, every semantic
// component, wires the actor/action/intent flow to the controller, and
// hands back a GameView + GameViewBinder ready to run. This is the
// only place that knows the full HTML/CSS/DOM implementation of the
// view end to end.
// ============================================

export const createHtmlGameView = (controller, rootId) => {
  const root = document.getElementById(rootId);
  if (!root) throw new Error(`#${rootId} not found in DOM`);

  root.innerHTML = '';
  root.className = layoutClassMap.rootShell;
  root.innerHTML = renderShell();

  const registry = createElementRegistry(root);

  const boardSurface = createBoardSurface(registry);
  const boardView = createBoardView(boardSurface);
  boardView.showBoard();

  const motionSurface = createMotionSurface(registry);
  const animationView = createBoardMoveAnimationView(motionSurface);

  const statusSurface = createStatusSurface(registry);
  const statusView = createGameStatusView(statusSurface);

  const controlPanelSurface = createControlPanelSurface(registry);
  const controlPanelView = createControlPanelView(controlPanelSurface);

  const layoutSurface = createLayoutSurface(registry);

  const gameView = createGameView({ boardView, animationView, statusView, controlPanelView, layoutSurface });
  const binder = createGameViewBinder(controller, stateFactory, gameView);

  const dispatchIntent = createUiIntentDispatcher(controller, controlPanelView.modeOptions);
  const uiEventSource = createUiEventSource(registry);

  uiEventSource.onUiEvent((rawEvent) => {
    const intent = resolveUiIntent(rawEvent);
    if (!intent) return;

    if ((intent.isSelectPiece() || intent.isChooseMoveTarget()) && (!binder.isGameStarted || binder.isAIThinking)) {
      return;
    }

    // Flag/screen bookkeeping happens before dispatching to the controller:
    // reset() synchronously emits 'stateChanged', which the binder's own
    // listener re-syncs from -- it needs to already see the updated
    // gameStarted flag (matching the pre-Phase-7 ordering).
    if (intent.isStartGame()) {
      binder.markGameStarted();
    } else if (intent.isRestartGame()) {
      binder.markGameStopped();
    } else if (intent.isExpandSetup()) {
      binder.markSetupExpanded();
    }

    dispatchIntent(intent);
  });

  binder.refreshNow();

  return { gameView, binder };
};
