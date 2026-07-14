// Conformance checker for docs/ws-engine-api-spec.md — verifies a WS AI
// engine (this repo's own, or a third-party implementation) produces
// responses the reference caller can actually apply: well-formed, and
// pointing at a real, moveKey-matching legal move for the sessions sent.
//
// Run with: node examples/checkWsEngineConformance.mjs <ws-url>
// Example:  node examples/checkWsEngineConformance.mjs ws://localhost:8787
import { readFile } from 'node:fs/promises';
import { GameDriver, moveKey } from '../cli/GameDriver.mjs';
import { WsGameDriver } from '../controller/WsGameDriver.mjs';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node examples/checkWsEngineConformance.mjs <ws-url>');
  console.error('Example: node examples/checkWsEngineConformance.mjs ws://localhost:8787');
  process.exitCode = 1;
  process.exit();
}

const demo1 = JSON.parse(await readFile(new URL('./demos/demo1.json', import.meta.url), 'utf8'));

// Each case is a fresh authoritative GameDriver (independent of the engine
// under test) plus a set of depths to request. The authoritative driver is
// what the response gets checked against — mirroring exactly what a real
// caller (controller/gameController.mjs, cli/cli.mjs) does.
const cases = [
  { label: 'fresh game', buildDriver: () => new GameDriver(), depths: [1, 4] },
  {
    label: 'demo1 (branching chain capture)',
    buildDriver: () => new GameDriver(demo1),
    depths: [1, 4],
  },
];

const checkOne = async ({ label, buildDriver, depth }) => {
  const driver = buildDriver();
  const session = driver.toJSON();
  const name = `${label} @ depth ${depth}`;

  let choice;
  try {
    choice = await new WsGameDriver({ session, url }).playAiMove(depth);
  } catch (error) {
    return { name, ok: false, reason: `request failed: ${error.message}` };
  }

  if (!choice.played) {
    // A position with no legal moves is a valid (if unusual) response;
    // both our test positions have legal moves, so this counts as a fail.
    return { name, ok: false, reason: 'engine reported played: false for a position with legal moves' };
  }

  if (typeof choice.matchIndex !== 'number' || typeof choice.moveKey !== 'string') {
    return { name, ok: false, reason: `malformed response: ${JSON.stringify(choice)}` };
  }

  const moves = driver.getMoves();
  const move = moves[choice.matchIndex];
  if (!move) {
    return { name, ok: false, reason: `matchIndex ${choice.matchIndex} out of range (0..${moves.length - 1})` };
  }
  if (moveKey(move) !== choice.moveKey) {
    return {
      name,
      ok: false,
      reason: `moveKey mismatch: engine said ${choice.moveKey}, matchIndex ${choice.matchIndex} is actually ${moveKey(move)} — see "the critical compatibility constraint" in docs/ws-engine-api-spec.md`,
    };
  }

  return { name, ok: true, reason: `${move.from}->${move.to} (score=${choice.score}, nodes=${choice.nodes})` };
};

console.log(`Checking WS AI engine conformance at ${url}\n`);

const results = [];
for (const testCase of cases) {
  for (const depth of testCase.depths) {
    // Sequential on purpose: keeps output ordered and avoids concurrent
    // load skewing timing on a possibly-single-threaded vendor engine.
    results.push(await checkOne({ ...testCase, depth }));
  }
}

for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name} — ${result.reason}`);
}

const failures = results.filter((result) => !result.ok);
console.log(`\n${results.length - failures.length}/${results.length} checks passed.`);
if (failures.length > 0) {
  console.log('Not conformant with docs/ws-engine-api-spec.md.');
}

WsGameDriver.terminate();
process.exitCode = failures.length > 0 ? 1 : 0;
