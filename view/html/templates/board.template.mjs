import { boardClassMap } from '../styles/boardClassMap.mjs';
import { motionClassMap } from '../styles/motionClassMap.mjs';

export const coordLabel = (text, isDark) =>
  `<span class="${isDark ? boardClassMap.coordLabelOnDark : boardClassMap.coordLabelOnLight}">${text}</span>`;

export const moveDot = (color) =>
  `<div class="${boardClassMap.dotBase}"><div class="${boardClassMap.dotInnerBase} ${color}"></div></div>`;

export const rippleInner = `<div class="${motionClassMap.rippleInner}"></div>`;
