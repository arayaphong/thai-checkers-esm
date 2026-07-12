import { renderShell } from './templates/shell.template.mjs';
import { layoutClassMap } from './styles/layoutClassMap.mjs';
import { createElementRegistry } from './HtmlElementRegistry.mjs';
import { createBoardSurface } from './surfaces/HtmlBoardSurface.mjs';
import { createMotionSurface } from './surfaces/HtmlMotionSurface.mjs';
import { createStatusSurface } from './surfaces/HtmlStatusSurface.mjs';
import { createControlPanelSurface } from './surfaces/HtmlControlPanelSurface.mjs';
import { createUiEventSource } from './HtmlUiEventSource.mjs';
import {
  createControlPanelView,
  MODE_OPTIONS,
} from '../components/control-panel/ControlPanelView.mjs';
import { createGameView } from '../GameView.mjs';
import { createGameViewBinder } from '../GameViewBinder.mjs';
import * as stateFactory from '../GameViewStateFactory.mjs';
import { createUiCommandDispatcher } from '../UiCommandDispatcher.mjs';

// ============================================
// HtmlGameViewFactory — composition root for the HTML implementation
// of the view. Builds the shell, every HTML surface, every semantic
// component and wires plain UI commands to the controller, then
// hands back a GameView + GameViewBinder ready to run. This is the
// only place that knows the full HTML/CSS/DOM implementation of the
// view end to end.
// ============================================

export const createHtmlGameView = (controller, rootId) => {
  const root = document.getElementById(rootId);
  if (!root) throw new Error(`#${rootId} not found in DOM`);

  root.className = layoutClassMap.rootShell;
  root.innerHTML = renderShell();

  const registry = createElementRegistry(root);

  const boardView = createBoardSurface(registry);
  const animationView = createMotionSurface(registry);
  const statusView = createStatusSurface(registry);
  const controlPanelSurface = createControlPanelSurface(registry);
  const controlPanelView = createControlPanelView(controlPanelSurface);

  const gameView = createGameView({
    boardView,
    animationView,
    statusView,
    controlPanelView,
  });
  const binder = createGameViewBinder(controller, stateFactory, gameView);

  const dispatchCommand = createUiCommandDispatcher(controller, binder, MODE_OPTIONS);
  const uiEventSource = createUiEventSource(registry);
  uiEventSource.onUiCommand(dispatchCommand);

  binder.refreshNow();

  return { gameView, binder };
};
