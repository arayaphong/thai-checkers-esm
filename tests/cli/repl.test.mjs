import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'cli', 'cli.mjs');

// Run the REPL as a child process, sending commands and collecting output.
// Commands are written one per tick so readline processes them as separate
// lines (piped stdin otherwise buffers everything at once).
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
        // Give the loop a moment to print the final state, then close.
        setTimeout(() => child.stdin.end(), 100);
        return;
      }
      const cmd = commands[i++];
      child.stdin.write(cmd + '\n');
      setTimeout(sendNext, 100);
    };
    setTimeout(sendNext, 100);
  });

describe('REPL end-to-end', () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'thai-cli-e2e-'));
  });

  afterAll(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('plays a move by number and shows the board', async () => {
    const { code, stdout } = await runRepl([], ['3', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Player to move: WHITE');
    expect(stdout).toContain('Player to move: BLACK');
    expect(stdout).toContain('[3] C2 -> D3');
  });

  test('starts with a demo file and shows its metadata', async () => {
    const demoPath = path.join(ROOT, 'examples', 'demos', 'demo1.json');
    const { code, stdout } = await runRepl([demoPath], ['quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Demo 1: branching chain capture');
  });

  test('ambiguous coordinate move prints candidate routes', async () => {
    const demoPath = path.join(ROOT, 'examples', 'demos', 'demo1.json');
    const { code, stdout } = await runRepl([demoPath], ['e4 e8', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Ambiguous move');
    expect(stdout).toContain('E4 -> G6 -> E8* (xF5 xF7)');
    expect(stdout).toContain('E4 -> C6 -> E8* (xD5 xD7)');
  });

  test('ambiguous move with choice applies the selected route', async () => {
    const demoPath = path.join(ROOT, 'examples', 'demos', 'demo1.json');
    const { code, stdout } = await runRepl([demoPath], ['e4 e8 1', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Player to move: BLACK');
  });

  test('ai command makes a move without hanging', async () => {
    const { code, stdout } = await runRepl([], ['ai 1', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Player to move: BLACK');
  });

  test('invalid command keeps the process alive', async () => {
    const { code, stdout } = await runRepl([], ['notacommand', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Unknown command');
  });

  test('save then load in a new process restores the position', async () => {
    const saveFile = path.join(tmpDir, 'session.json');
    const first = await runRepl([], ['3', `save ${saveFile}`, 'quit']);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain(`Saved session to ${saveFile}`);

    const saved = JSON.parse(await readFile(saveFile, 'utf8'));
    expect(saved.format).toBe('thai-checkers-cli-session-v1');
    expect(saved.moveSequence.length).toBe(1);

    const second = await runRepl([saveFile], ['history', 'quit']);
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('1. C2 -> D3');
  });

  test('undo and redo commands work', async () => {
    const { code, stdout } = await runRepl([], ['3', 'undo', 'redo', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('Player to move: BLACK');
  });

  test('history command lists played moves only', async () => {
    const { code, stdout } = await runRepl([], ['3', 'history', 'quit']);
    expect(code).toBe(0);
    expect(stdout).toContain('1. C2 -> D3');
  });
});
