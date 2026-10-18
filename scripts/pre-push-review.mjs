#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const argv = new Set(globalThis.process.argv.slice(2));
const isCI = argv.has('--ci');
const root = globalThis.process.cwd();

function run(command, args = []) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: globalThis.process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });

  const stdout = (result.stdout || '').trim();
  const stderr = (result.stderr || '').trim();

  return {
    status: result.status ?? 1,
    stdout,
    stderr,
  };
}

function git(args) {
  return run('git', args);
}

function printHeader(title) {
  globalThis.console.log(`\n=== ${title} ===`);
}

function fail(message) {
  globalThis.console.error(`\n❌ ${message}`);
  globalThis.process.exit(1);
}

function info(message) {
  globalThis.console.log(`ℹ️ ${message}`);
}

function isBranchProtected() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  return branch.status === 0 ? branch.stdout.trim() : '';
}

function baseRef() {
  const remotes = git(['remote']).stdout.trim();
  if (remotes.includes('origin')) {
    return 'origin/main';
  }
  return 'main';
}

function ensureBranchRules() {
  if (isCI) {
    info('CI mode: skipping local branch protection checks.');
    return;
  }

  const branch = isBranchProtected();
  if (!branch || branch === 'main') {
    fail('You are on the protected main branch. Create or switch to your personal branch before pushing.');
  }

  const mainRef = baseRef();
  const mainCheck = git(['rev-parse', '--verify', mainRef]);

  if (mainCheck.status !== 0) {
    info(`Base ref ${mainRef} is not available yet. Skipping rebase check for now.`);
    return;
  }

  const counts = git(['rev-list', '--left-right', '--count', `${mainRef}...HEAD`]).stdout.trim();
  const [behind, ahead] = (counts || '0 0').split(/\s+/).map(Number);

  if (Number(behind) > 0) {
    fail(`Your branch is behind ${mainRef}. Rebase before pushing. Run: git fetch origin && git rebase origin/main`);
  }

  if (Number(ahead) === 0) {
    fail(`No local commits are ahead of ${mainRef}. Nothing to push.`);
  }
}

function gatherChangedFiles() {
  const mainRef = baseRef();
  const mainCheck = git(['rev-parse', '--verify', mainRef]);

  if (mainCheck.status !== 0) {
    return [];
  }

  const result = git(['diff', '--name-only', `${mainRef}...HEAD`]);
  if (result.status !== 0) {
    return [];
  }

  return (result.stdout || '')
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function runChecks(commands) {
  for (const command of commands) {
    const [bin, ...args] = command.split(' ');
    printHeader(`Running: ${command}`);
    const result = run(bin, args);

    if (result.stdout) {
      globalThis.console.log(result.stdout);
    }

    if (result.stderr) {
      globalThis.console.error(result.stderr);
    }

    if (result.status !== 0) {
      fail(`Command failed: ${command}`);
    }
  }
}

function runHumanReviewNotes(changedFiles) {
  printHeader('Review guidance');

  const codeFiles = changedFiles.filter((file) => file.startsWith('apps/') || file.startsWith('packages/') || file.startsWith('db/'));
  const docFiles = changedFiles.filter((file) => file.startsWith('docs/'));

  if (codeFiles.length > 0 && docFiles.length === 0) {
    globalThis.console.log('⚠️  Code changed without any docs change. If the design or public behavior changed, update the relevant docs before merge.');
  }

  if (changedFiles.some((file) => file.includes('meta') || file.includes('wallet') || file.includes('send'))) {
    globalThis.console.log('⚠️  This diff touches Meta or money-sensitive logic. Confirm no real sends or wallet charges are used in tests.');
  }

  if (changedFiles.some((file) => file.startsWith('db/'))) {
    globalThis.console.log('⚠️  Database migration or schema change detected. Review migration safety and verify the migration is additive only.');
  }

  globalThis.console.log('Review notes: the deterministic checks above are enforced. Human review is still required for scope, design fit, and approval.');
}

function main() {
  printHeader('Pre-push review');
  ensureBranchRules();

  const changedFiles = gatherChangedFiles();
  const sharedBuildNeeded = changedFiles.some((file) => file.startsWith('packages/shared/'));
  const baseChecks = ['pnpm lint', 'pnpm typecheck', 'pnpm test'];
  const integrationChecks = ['pnpm db:up', 'pnpm test:int'];

  if (sharedBuildNeeded) {
    runChecks(['pnpm --filter @reaplift/shared build']);
  }

  runChecks(baseChecks);

  const needsIntegration = changedFiles.some((file) => file.startsWith('db/') || file.startsWith('apps/server/') || file.startsWith('packages/shared/'));
  if (needsIntegration) {
    runChecks(integrationChecks);
  }

  runHumanReviewNotes(changedFiles);

  globalThis.console.log('\n✅ Pre-push review passed. Proceed with PR review and merge approval.');
}

main();
