import { createGameController } from './controller/GameController.mjs';
import { createHtmlGameView } from './view/html/HtmlGameViewFactory.mjs';

// ============================================
// Entry Point - Pure ESM, no React
// Composition root: wires the controller to the HTML view via
// HtmlGameViewFactory (GameView + GameViewBinder + plain UI commands).
// ============================================

const getDemoParam = () => {
  const href = window.location.href;
  const pathname = window.location.pathname;
  const match =
    href.match(/[?&#]demo=([^/&?#]+)/) ||
    href.match(/#(demo\d+)/) ||
    pathname.match(/^\/demo=(demo\d+)/) ||
    pathname.match(/^\/(demo\d+)/);
  return match ? match[1] : null;
};

const loadDemoParams = async (demoName) => {
  try {
    const response = await fetch(`./examples/demos/${demoName}.json`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    const board = Array.from({ length: 8 }, () => Array(8).fill(0));
    const COLOR_MAP = { WHITE: 1, BLACK: -1 };
    const TYPE_MAP = { PION: 1, DAME: 2 };

    for (const [square, info] of data.pieces) {
      const col = square.toUpperCase().charCodeAt(0) - 65;
      const row = 8 - parseInt(square.substring(1), 10);
      const colorSign = COLOR_MAP[info.color.toUpperCase()];
      const pieceType = TYPE_MAP[info.type.toUpperCase()];
      board[row][col] = colorSign * pieceType;
    }
    const turn = data.sideToMove === 'BLACK' ? -1 : 1;
    return { board, turn };
  } catch (err) {
    console.error('Failed to load demo:', err);
    return null;
  }
};

let controllerParams = { config: { whiteIsAI: false, blackIsAI: false } };
const demoName = getDemoParam();
if (demoName) {
  const demoParams = await loadDemoParams(demoName);
  if (demoParams) {
    controllerParams = {
      ...demoParams,
      config: { whiteIsAI: false, blackIsAI: false },
    };
  }
}

const controller = createGameController(controllerParams);
const { gameView, binder } = createHtmlGameView(controller, 'root');

// If a demo was successfully loaded, jump directly to playing screen
if (demoName && controllerParams.board) {
  binder.markGameStarted();
}

// Expose for debugging
globalThis.game = { controller, gameView, binder };
