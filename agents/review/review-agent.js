#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = globalThis.process.cwd();

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: globalThis.process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 1,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function git(args) {
  return run('git', args);
}

function fail(message) {
  globalThis.console.error(`\n❌ ${message}`);
  globalThis.process.exit(1);
}

function info(message) {
  globalThis.console.log(`ℹ️ ${message}`);
}

function baseRef() {
  return git(['remote']).stdout.includes('origin') ? 'origin/main' : 'main';
}

function main() {
  const reviewEnabled = !['0', 'false', 'off', ''].includes((globalThis.process.env.REVIEW_GATE ?? '0').toLowerCase());
  if (!reviewEnabled) {
    globalThis.console.log('ℹ️  Review agent is off by default. Set REVIEW_GATE=1 to enable tracker and branch validation.');
    return;
  }

  globalThis.console.log('=== Review Agent ===');

  const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  if (currentBranch.status !== 0 || !currentBranch.stdout.trim() || currentBranch.stdout.trim() === 'main') {
    fail('You are on the protected main branch. Switch to anirudh-e2e-setup before pushing.');
  }

  const mainRef = baseRef();
  const mainCheck = git(['rev-parse', '--verify', mainRef]);
  if (mainCheck.status === 0) {
    const leftRight = git(['rev-list', '--left-right', '--count', `${mainRef}...HEAD`]);
    const [behind = 0, ahead = 0] = (leftRight.stdout || '0 0').split(/\s+/).map(Number);

    if (behind > 0) {
      fail(`Your branch is behind ${mainRef}. Merge it before pushing. Run: git fetch origin && git merge origin/main`);
    }

    if (ahead === 0) {
      fail(`No commits are ahead of ${mainRef}. Nothing to push.`);
    }
  }

  const reviewChecks = [
    'pnpm --filter @reaplift/shared build',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm test',
  ];

  for (const command of reviewChecks) {
    const [bin, ...args] = command.split(' ');
    globalThis.console.log(`\n--- Running: ${command} ---`);
    const result = run(bin, args);

    if (result.stdout) {
      globalThis.console.log(result.stdout);
    }

    if (result.stderr) {
      globalThis.console.error(result.stderr);
    }

    if (result.status !== 0) {
      fail(`Review agent failed: ${command}`);
    }
  }

  const trackerFile = `${root}/docs/project-tracker.md`;
  if (!existsSync(trackerFile)) {
    fail('The tracker file is missing. Restore docs/project-tracker.md before pushing.');
  }

  const trackerText = readFileSync(trackerFile, 'utf8');
  if (!/## Current status/i.test(trackerText) || !/(Success criteria|Acceptance criteria)/i.test(trackerText)) {
    fail('The tracker is missing the required Current status and success criteria / acceptance criteria sections. Update docs/project-tracker.md before pushing.');
  }

  const changedFiles = git(['diff', '--name-only', 'HEAD']);
  const files = (changedFiles.stdout || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const codeFiles = files.filter((file) => !file.startsWith('docs/') && !file.startsWith('.githooks/') && !file.startsWith('.github/'));
  if (codeFiles.length > 0 && !files.includes('docs/project-tracker.md')) {
    fail('Code changes were detected without updating docs/project-tracker.md. Update the tracker before pushing.');
  }

  const hasDbChange = files.some((file) => file.startsWith('db/') || file.startsWith('apps/server/') || file.startsWith('packages/shared/'));
  if (hasDbChange) {
    info('Database or server code changed. Running integration tests...');
    const dbUp = run('pnpm', ['db:up']);
    if (dbUp.status !== 0) {
      fail('Database setup command failed.');
    }

    const testResult = run('pnpm', ['test:int']);
    if (testResult.status !== 0) {
      fail('Integration tests failed.');
    }
  }

  if (files.some((file) => file.includes('meta') || file.includes('wallet') || file.includes('send'))) {
    info('Meta or money-sensitive logic changed. Confirm no real sends or wallet charges are used in automated tests.');
  }

  if (files.length > 0 && !files.some((file) => file.startsWith('docs/'))) {
    info('Code changed without a docs change. If design or behaviour changed, update the relevant docs before merge.');
  }

  globalThis.console.log('\n✅ Review Agent PASS');
  globalThis.console.log('This branch is ready for PR review and merge approval.');
}

main();
