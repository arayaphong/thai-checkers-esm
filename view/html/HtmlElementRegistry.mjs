// ============================================
// HtmlElementRegistry — owns DOM lookups for the game's HTML
// implementation. Keeps selector/id strings out of the legacy view
// and (later) out of the HTML surfaces, so only this file knows how
// landmark elements and per-square elements are actually found.
// ============================================

const key = (position) => `${position.r},${position.c}`;

export const createElementRegistry = (root) => {
  const squares = new Map();

  return {
    root,

    getSetupPanel: () => root.querySelector('#setupPanel'),
    getStatusPanel: () => root.querySelector('#statusPanel'),
    getGameArea: () => root.querySelector('#gameArea'),
    getBoard: () => root.querySelector('#board'),

    registerSquare: (position, element) => squares.set(key(position), element),
    getSquare: (position) => squares.get(key(position)),
  };
};
