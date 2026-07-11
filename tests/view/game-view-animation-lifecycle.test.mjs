import { describe, test } from '@jest/globals';
import assert from 'node:assert/strict';
import { createGameViewAnimationLifecycle } from '../../view/GameViewAnimationLifecycle.mjs';

// A controllable "run" callback: resolves only when the test calls
// settle(), and records the signal it was invoked with so assertions can
// drive it directly.
const controllableRun = () => {
  const { promise, resolve } = Promise.withResolvers();
  let capturedSignal;
  const run = (signal) => {
    capturedSignal = signal;
    return promise;
  };
  return {
    run,
    settle: (value) => resolve(value),
    getSignal: () => capturedSignal,
  };
};

describe('GameViewAnimationLifecycle', () => {
  test('beginAnimation starts animating; resolving clears state', async () => {
    const lifecycle = createGameViewAnimationLifecycle();
    const { run, settle } = controllableRun();

    const donePromise = lifecycle.beginAnimation(run);
    assert.equal(lifecycle.isAnimating(), true);

    settle();
    await donePromise;
    assert.equal(lifecycle.isAnimating(), false);
  });

  test('cancelAnimation aborts the signal and clears state synchronously mid-flight', () => {
    const lifecycle = createGameViewAnimationLifecycle();
    const { run, getSignal } = controllableRun();

    lifecycle.beginAnimation(run);
    assert.equal(lifecycle.isAnimating(), true);
    assert.equal(getSignal().aborted, false);

    lifecycle.cancelAnimation();
    assert.equal(getSignal().aborted, true);
    assert.equal(lifecycle.isAnimating(), false);
  });

  test('a stale animation resolving after cancelAnimation does not clobber the newer one', async () => {
    const lifecycle = createGameViewAnimationLifecycle();
    const a = controllableRun();
    const b = controllableRun();

    lifecycle.beginAnimation(a.run);
    lifecycle.cancelAnimation();
    const bDone = lifecycle.beginAnimation(b.run);

    assert.equal(lifecycle.isAnimating(), true);

    // A's continuation resolves late.
    a.settle();
    await Promise.resolve();
    await Promise.resolve();

    // State must still reflect B, unaffected by A's late completion.
    assert.equal(lifecycle.isAnimating(), true);

    b.settle();
    await bDone;
    assert.equal(lifecycle.isAnimating(), false);
  });

  test('waitForAnimation never rejects even if the in-flight animation rejects', async () => {
    const lifecycle = createGameViewAnimationLifecycle();
    const { promise, reject } = Promise.withResolvers();

    const donePromise = lifecycle.beginAnimation(() => promise);
    const waitPromise = lifecycle.waitForAnimation();
    reject(new Error('boom'));

    await assert.rejects(donePromise, /boom/);
    await waitPromise;
  });

  test('waitForAnimation resolves immediately when nothing is animating', async () => {
    const lifecycle = createGameViewAnimationLifecycle();
    await lifecycle.waitForAnimation();
    assert.equal(lifecycle.isAnimating(), false);
  });
});
