import { layoutClassMap } from '../styles/layoutClassMap.mjs';

export const renderShell = () => `
    <div class="${layoutClassMap.headerWrapper}">
      <h1 class="${layoutClassMap.headerTitle}">
        <svg class="${layoutClassMap.headerIcon}"><use href="#icon-crown"/></svg> หมากฮอสไทย
      </h1>
    </div>
    <div id="setupPanel" class="${layoutClassMap.setupPanel}"></div>
    <div id="gameArea" class="${layoutClassMap.gameAreaBase} ${layoutClassMap.gameAreaInactiveModifier}">
      <div id="statusPanel" class="${layoutClassMap.statusPanel}"></div>
      <div class="${layoutClassMap.boardFrameWrapper}">
        <div id="boardGlow" class="${layoutClassMap.boardFrameGlow} board-rotation-transition"></div>
        <div id="boardInner" class="${layoutClassMap.boardFrameInner} board-rotation-transition"></div>
        <div id="board" class="${layoutClassMap.boardGrid}"></div>
        <button id="rotateBtn" class="${layoutClassMap.rotateButton}" title="หมุนกระดาน">
          <svg class="w-5 h-5"><use href="#icon-rotate"/></svg>
        </button>
      </div>
    </div>
    <div class="${layoutClassMap.footer}">
      <p>เวอร์ชั่น 0.0.1</p>
    </div>
  `;
