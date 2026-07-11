import { describe, expect, test } from '@jest/globals';
import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const semanticTargets = [
  'view/components',
  'view/intent',
  'view/GameView.mjs',
  'view/GameViewBinder.mjs',
  'view/GameViewStateFactory.mjs',
];

const forbiddenImplementationTokens = [
  'document',
  'window',
  'HTMLElement',
  'querySelector',
  'querySelectorAll',
  'getElementById',
  'createElement',
  'innerHTML',
  'insertAdjacentHTML',
  'className',
  'classList',
  'dataset',
  'style.cssText',
];

const forbiddenHtmlTokens = [
  '<div',
  '<span',
  '<button',
  '<svg',
  'data-mode',
  'data-diff',
  'data-row',
  'data-col',
];

const forbiddenCssTokens = [
  'hint-target',
  'hint-moveable',
  'hint-mandatory-capture',
  'hint-captured',
  'ring-',
  'bg-',
  'text-',
  'rounded',
  'shadow',
  'border-',
  'opacity-',
  'pointer-events',
  'animate-',
  'z-',
  'w-[',
  'h-[',
  'sm:',
  'abs-',
  'flex-center',
];

const htmlDetailDirectoriesThatMustNotExist = ['view/templates'];

const cssDetailFilesThatMustNotExist = [
  'view/game.css',
  'view/tailwind.css',
  'view/tailwind-input.css',
];

const legacyViewFilesThatMustNotExist = ['view/DOMView.mjs'];

const exists = async (filePath) => {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
};

const walkFiles = async (rootDir, targetPath) => {
  const absolutePath = path.join(rootDir, targetPath);
  if (!(await exists(absolutePath))) return [];

  const targetStat = await stat(absolutePath);
  if (targetStat.isFile()) {
    return absolutePath.endsWith('.mjs') ? [absolutePath] : [];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const childFiles = await Promise.all(
    entries.map((entry) => {
      const childPath = path.join(targetPath, entry.name);
      return walkFiles(rootDir, childPath);
    }),
  );
  return childFiles.flat();
};

const lineMatches = (line, tokens) =>
  tokens.filter((token) => line.includes(token)).map((token) => ({ token, line }));

const collectViewBoundaryViolations = async ({ rootDir = process.cwd() } = {}) => {
  const files = (
    await Promise.all(semanticTargets.map((target) => walkFiles(rootDir, target)))
  ).flat();
  const tokenGroups = [
    { label: 'DOM/API implementation detail', tokens: forbiddenImplementationTokens },
    { label: 'HTML/template detail', tokens: forbiddenHtmlTokens },
    { label: 'CSS class/detail', tokens: forbiddenCssTokens },
  ];

  const violations = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf8');
    const lines = source.split(/\r?\n/);

    lines.forEach((line, index) => {
      tokenGroups.forEach(({ label, tokens }) => {
        lineMatches(line, tokens).forEach(({ token }) => {
          violations.push({
            filePath,
            lineNumber: index + 1,
            label,
            token,
            line: line.trim(),
          });
        });
      });
    });
  }

  for (const directory of htmlDetailDirectoriesThatMustNotExist) {
    const absolutePath = path.join(rootDir, directory);
    if (await exists(absolutePath)) {
      const entries = await readdir(absolutePath);
      if (entries.length > 0) {
        violations.push({
          filePath: absolutePath,
          lineNumber: 0,
          label: 'HTML detail outside view/html',
          token: directory,
          line: 'Move HTML templates/details under view/html/**.',
        });
      }
    }
  }

  for (const filePath of cssDetailFilesThatMustNotExist) {
    const absolutePath = path.join(rootDir, filePath);
    if (await exists(absolutePath)) {
      violations.push({
        filePath: absolutePath,
        lineNumber: 0,
        label: 'CSS detail outside view/css',
        token: filePath,
        line: 'Move CSS files under view/css/**.',
      });
    }
  }

  for (const filePath of legacyViewFilesThatMustNotExist) {
    const absolutePath = path.join(rootDir, filePath);
    if (await exists(absolutePath)) {
      violations.push({
        filePath: absolutePath,
        lineNumber: 0,
        label: 'Retired legacy view file',
        token: filePath,
        line: 'Runtime should use HtmlGameViewFactory/GameViewBinder instead.',
      });
    }
  }

  return violations;
};

const formatViewBoundaryViolations = (violations, { rootDir = process.cwd() } = {}) => {
  if (violations.length === 0) return 'View boundary check passed.';

  const lines = ['View boundary check failed:'];
  for (const violation of violations) {
    const relativePath = path.relative(rootDir, violation.filePath);
    const location =
      violation.lineNumber > 0 ? `${relativePath}:${violation.lineNumber}` : relativePath;
    lines.push(`- ${location} [${violation.label}] ${violation.token}`);
    lines.push(`  ${violation.line}`);
  }
  return lines.join('\n');
};

describe('view architecture boundaries', () => {
  test('semantic view code has no DOM, HTML, CSS, or retired legacy-view leaks', async () => {
    const violations = await collectViewBoundaryViolations();
    expect(formatViewBoundaryViolations(violations)).toBe('View boundary check passed.');
    expect(violations).toEqual([]);
  });
});
