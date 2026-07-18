import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameDriverServer } from '../../server/gameDriverServer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'cli', 'cli.mjs');

// Run the REPL as a child process, sending commands and collecting output.
// Mirrors tests/cli/repl.test.mjs's runRepl helper.
const runRepl = (args, commands) =>
  new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));

    let i = 0;
    const sendNext = () => {
      if (i >= commands.length) {
        setTimeout(() => child.stdin.end(), 100);
        return;
      }
      const cmd = commands[i++];
      child.stdin.write(cmd + '\n');
      setTimeout(sendNext, 100);
    };
    setTimeout(sendNext, 100);
  });

// A port guaranteed to have nothing listening on it right now.
const reserveClosedPort = async () => {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const { port } = probe.address();
  await new Promise((resolve) => probe.close(resolve));
  return port;
};

describe('CLI -ws flag', () => {
  let server;

  beforeAll(async () => {
    server = await createGameDriverServer({ port: 0 });
  });

  afterAll(async () => {
    if (server) await server.close();
  });

  test('plays a move via the configured WS engine', async () => {
    const port = server.address().port;
    const { code, stdout } = await runRepl(['-ws', String(port)], ['ai 1', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('AI played:');
    expect(stdout).toContain('Player to move: BLACK');
  });

  test('unreachable configured engine prints an error and the REPL stays usable', async () => {
    const closedPort = await reserveClosedPort();
    const { code, stdout } = await runRepl(['-ws', String(closedPort)], ['ai 1', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Error:');
    expect(stdout).not.toContain('AI played:');
    // The REPL kept prompting after the error instead of crashing.
    expect(stdout.match(/> /g).length).toBeGreaterThanOrEqual(2);
  });

  test('no -ws flag behaves exactly like today (direct/local analysis)', async () => {
    const { code, stdout } = await runRepl([], ['ai 1', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('AI played:');
    expect(stdout).toContain('Player to move: BLACK');
  });
});
