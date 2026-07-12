import { describe, test, afterEach } from '@jest/globals';
import assert from 'node:assert/strict';
import { GameDriver, moveKey } from '../../cli/GameDriver.mjs';
import { requestAiMove } from '../../controller/AiMoveChannel.mjs';
import { WorkerGameDriver } from '../../controller/WorkerGameDriver.mjs';

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.prototype.toString.call(value) === '[object Object]';

const isCloneSafeDto = (value) => {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isCloneSafeDto);
  if (isPlainObject(value)) return Object.values(value).every(isCloneSafeDto);
  return false;
};

const standardDriver = () => new GameDriver();

afterEach(() => {
  WorkerGameDriver.terminate();
});

describe('AiMoveChannel', () => {
  test('returns a structured-clone-safe DTO and leaves the authoritative driver untouched', async () => {
    const driver = standardDriver();
    const before = driver.toJSON();
    const beforeHistory = driver.history().length;

    const choice = await requestAiMove({ session: before, depth: 1 });

    assert.equal(choice.played, true);
    assert.equal(typeof choice.matchIndex, 'number');
    assert.equal(typeof choice.moveKey, 'string');
    assert.equal(typeof choice.score, 'number');
    assert.equal(typeof choice.nodes, 'number');
    assert.equal(typeof choice.elapsedMs, 'number');
    assert.ok(isCloneSafeDto(choice), 'choice DTO is structured-clone-safe');

    assert.deepEqual(driver.toJSON(), before, 'authoritative session is unchanged');
    assert.equal(driver.history().length, beforeHistory, 'authoritative history is unchanged');
  });

  test('pre-aborted request returns an aborted result without running analysis', async () => {
    const driver = standardDriver();
    const before = driver.toJSON();
    const abortController = new AbortController();
    abortController.abort();

    const choice = await requestAiMove({
      session: before,
      depth: 1,
      signal: abortController.signal,
    });

    assert.deepEqual(choice, { played: false, aborted: true });
    assert.deepEqual(driver.toJSON(), before, 'driver is untouched after pre-abort');
  });

  test('a valid choice commits the authoritative driver exactly once', async () => {
    const driver = standardDriver();
    const choice = await requestAiMove({ session: driver.toJSON(), depth: 1 });
    assert.equal(choice.played, true);

    const before = driver.history().length;
    driver.playMoveIndex(choice.matchIndex);
    assert.equal(driver.history().length, before + 1, 'driver advanced exactly once');
  });

  test('stale index/key pair would be rejected by controller validation', async () => {
    const driver = standardDriver();
    const choice = await requestAiMove({ session: driver.toJSON(), depth: 1 });

    // Advance the driver so the saved matchIndex/key no longer describes the
    // current position.
    driver.playMoveIndex(choice.matchIndex);
    const moves = driver.getMoves();
    const movedTo = moves[choice.matchIndex];

    if (movedTo) {
      assert.notEqual(
        moveKey(movedTo),
        choice.moveKey,
        'same index now points to a different move',
      );
    } else {
      assert.ok(choice.matchIndex >= moves.length, 'stale index is out of range');
    }
  });
});
