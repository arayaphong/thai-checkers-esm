// ============================================
// BoardSquareView — semantic description of a single board square
// (its position and whether it renders as a dark or light square).
// Carries no DOM/CSS knowledge; it is handed to the HTML board
// surface so the surface can decide how a square actually looks.
// ============================================

export const createBoardSquareView = (position, isDark) => ({ position, isDark });
