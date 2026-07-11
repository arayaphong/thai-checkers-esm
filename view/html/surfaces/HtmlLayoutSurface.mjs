import { layoutClassMap } from '../styles/layoutClassMap.mjs';

// HtmlLayoutSurface — owns the small remaining layout concern that no
// other surface claimed: dimming the game area while the setup panel
// is expanded. Added here since GameView needs an HTML-layer home for
// this to stay DOM-free itself.

export const createLayoutSurface = (registry) => {
  const gameAreaEl = registry.getGameArea();

  const showGameAreaActive = () => {
    gameAreaEl.classList.remove(...layoutClassMap.gameAreaInactiveModifier.split(' '));
  };

  const showGameAreaDimmed = () => {
    gameAreaEl.classList.add(...layoutClassMap.gameAreaInactiveModifier.split(' '));
  };

  return {
    showGameAreaActive,
    showGameAreaDimmed,
  };
};
