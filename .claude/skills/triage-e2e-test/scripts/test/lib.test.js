import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deriveTriageId, workRoot, repoRoot } from '../lib.js';

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
	assert.equal(root, path.join(commonDir, 'triage-e2e-test'));
});
