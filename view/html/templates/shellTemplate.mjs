import { layoutClassMap } from '../styles/layoutClassMap.mjs';

export const renderShell = () => `
    <div class="${layoutClassMap.headerWrapper}">
      <h1 class="${layoutClassMap.headerTitle}">
        <svg class="${layoutClassMap.headerIcon}"><use href="#icon-crown"/></svg> หมากฮอสไทย
      </h1>
      <p class="${layoutClassMap.headerSubtitle}">Thai Checkers — Pure ESM</p>
    </div>
    <div id="setupPanel" class="${layoutClassMap.setupPanel}"></div>
    <div id="gameArea" class="${layoutClassMap.gameAreaBase} ${layoutClassMap.gameAreaInactiveModifier}">
      <div id="statusPanel" class="${layoutClassMap.statusPanel}"></div>
      <div class="${layoutClassMap.boardFrameWrapper}">
        <div class="${layoutClassMap.boardFrameGlow}"></div>
        <div class="${layoutClassMap.boardFrameInner}"></div>
        <div id="board" class="${layoutClassMap.boardGrid}"></div>
      </div>
    </div>
    <div class="${layoutClassMap.footer}">
      <p>เวอร์ชั่น 0.0.1</p>
    </div>
  `;
