import { UiIntent } from './UiIntent.mjs';

const toPosition = ({ row, col }) => ({ r: row, c: col });

// ============================================
// UiIntentResolver — translates a raw semantic UI event (as emitted
// by HtmlUiEventSource) into a UiIntent. Determines actor/action from
// the event's visible role; never touches the DOM and never calls the
// controller.
// ============================================

export const resolveUiIntent = (rawEvent) => {
  if (!rawEvent) return null;

  switch (rawEvent.visibleRole) {
    case 'piece':
      return UiIntent.selectPiece({ position: toPosition(rawEvent.position) });
    case 'boardSquare':
      return UiIntent.chooseMoveTarget({ position: toPosition(rawEvent.position) });
    case 'gameModeOption':
      return UiIntent.chooseGameMode({ mode: rawEvent.mode });
    case 'difficultyOption':
      return UiIntent.chooseDifficulty({ difficulty: rawEvent.difficulty });
    case 'startGameAction':
      return UiIntent.startGame();
    case 'restartGameAction':
      return UiIntent.restartGame();
    case 'setupPanel':
      return UiIntent.expandSetup();
    default:
      return null;
  }
};
