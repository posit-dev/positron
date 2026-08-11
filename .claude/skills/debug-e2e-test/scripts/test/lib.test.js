import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deriveTriageId, workRoot, repoRoot, isUsableInsightsApiKey, resolveInsightsApiKey, mainWorktreeRoot } from '../lib.js';

test('isUsableInsightsApiKey rejects blanks and the example placeholder', () => {
	assert.equal(isUsableInsightsApiKey('sk-real-key'), true);
	assert.equal(isUsableInsightsApiKey('"sk-real-key"'), true);
	assert.equal(isUsableInsightsApiKey(undefined), false);
	assert.equal(isUsableInsightsApiKey('   '), false);
	// The value an engineer gets by copying .env.e2e.example, in either source.
	assert.equal(isUsableInsightsApiKey('your_e2e_insights_api_key_here'), false);
	assert.equal(isUsableInsightsApiKey(' "your_e2e_insights_api_key_here" '), false);
});

test('resolveInsightsApiKey prefers the environment and unquotes it', () => {
	const prev = process.env.E2E_INSIGHTS_API_KEY;
	try {
		process.env.E2E_INSIGHTS_API_KEY = '"sk-from-env"';
		assert.equal(resolveInsightsApiKey(), 'sk-from-env');
		// A placeholder in the environment must not shadow the file lookup behind
		// it -- otherwise an exported example value silently wins over a real key.
		process.env.E2E_INSIGHTS_API_KEY = 'your_e2e_insights_api_key_here';
		assert.notEqual(resolveInsightsApiKey(), 'your_e2e_insights_api_key_here');
	} finally {
		if (prev === undefined) { delete process.env.E2E_INSIGHTS_API_KEY; }
		else { process.env.E2E_INSIGHTS_API_KEY = prev; }
	}
});

test('mainWorktreeRoot resolves the checkout owning the shared git dir', () => {
	const root = mainWorktreeRoot();
	assert.ok(path.isAbsolute(root));
	// Only the main checkout holds a real .git *directory*; a linked worktree has
	// a .git file pointing at it. This holds whichever one the tests run from,
	// which is the property the .env.e2e fallback depends on.
	assert.ok(fs.statSync(path.join(root, '.git')).isDirectory());
});

test('deriveTriageId is stable, slugged, and hash-suffixed', () => {
	const id = deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts');
	assert.match(id, /^opens-a-file-[0-9a-f]{8}$/);
	// Stable across calls.
	assert.equal(id, deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts'));
});

test('deriveTriageId does not collide when two tests share a leaf name', () => {
	// Same leaf ("opens a file"), different suite + spec -> must be distinct dirs.
	const a = deriveTriageId('Data Explorer > opens a file|||data-explorer.test.ts');
	const b = deriveTriageId('Plots > opens a file|||plots.test.ts');
	assert.notEqual(a, b);
});

test('workRoot lives under the shared git common dir, not the per-worktree .claude/work', () => {
	// .claude/work is gitignored and per-worktree, so state stored there is invisible
	// to `--resume` run from any other worktree. Anchoring on the git *common* dir
	// gives every worktree the same absolute path.
	const root = workRoot();
	assert.doesNotMatch(root, /[/\\]\.claude[/\\]work[/\\]/);
	const commonDir = path.resolve(
		repoRoot(),
		execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: repoRoot(), encoding: 'utf8' }).trim()
	);
	assert.equal(root, path.join(commonDir, 'debug-e2e-test'));
});
