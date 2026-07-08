import { createGameController } from './controller/GameController.mjs';
import { createHtmlGameView } from './view/html/HtmlGameViewFactory.mjs';

// ============================================
// Entry Point - Pure ESM, no React
// Composition root: wires the controller to the HTML view via
// HtmlGameViewFactory (GameView + GameViewBinder + the actor/action/
// intent flow).
// ============================================

const controller = createGameController({ whiteIsAI: false, blackIsAI: false });
const { gameView, binder } = createHtmlGameView(controller, 'root');

// Expose for debugging
globalThis.game = { controller, gameView, binder };
