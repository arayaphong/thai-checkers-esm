// ============================================
// GameViewAnimationLifecycle — tracks the single active move animation as
// one explicit record ({ generation, abortController, donePromise }) instead
// of separately-nulled variables. GameView supplies the actual animation
// work as a callback to beginAnimation(); this module owns only
// start/settle/end/cancel and the "is this still the current animation"
// guard, via a monotonic generation counter rather than object-identity
// comparisons.
//
// isAnimating() is true from beginAnimation() until the returned promise
// settles (or is cancelled). There is no separate "settling" phase; the
// animation promise is the only source of truth for when motion is done.
// ============================================

export const createGameViewAnimationLifecycle = () => {
  let generation = 0;
  let current = null;

  const isCurrent = (myGeneration) => current !== null && current.generation === myGeneration;

  const isAnimating = () => current !== null;

  const waitForAnimation = () =>
    current ? current.donePromise.catch(() => {}) : Promise.resolve();

  const beginAnimation = (run) => {
    generation += 1;
    const myGeneration = generation;
    const abortController = new AbortController();
    const entry = {
      generation: myGeneration,
      abortController,
      donePromise: null,
    };
    current = entry;

    const donePromise = (async () => {
      try {
        return await run(abortController.signal);
      } finally {
        if (isCurrent(myGeneration)) current = null;
      }
    })();

    entry.donePromise = donePromise;
    return donePromise;
  };

  const cancelAnimation = () => {
    if (current) current.abortController.abort();
    current = null;
  };

  return { isAnimating, waitForAnimation, beginAnimation, cancelAnimation };
};
