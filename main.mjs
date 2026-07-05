import { GameController } from './controller/GameController.mjs';
import { DOMView } from './view/DOMView.mjs';

// ============================================
// Entry Point - Pure ESM, no React
// Connects Controller to DOM View
// ============================================

const controller = new GameController({ whiteIsAI: false, blackIsAI: false });
const view = new DOMView(controller, 'root');

// Expose for debugging
window.game = { controller, view };
