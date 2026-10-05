/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outside, pathsFromPatch, pathsFromStatus } from './scope.ts';

test('status: modified, untracked and both sides of a rename', () => {
	const z = [' M .claude/skills/drive-positron/scripts/dp-ui.ts', '?? .claude/skills/drive-positron/heal/x.ts', 'R  src/vs/new.ts', '.claude/skills/drive-positron/old.ts', ''].join('\0');
	assert.deepEqual(pathsFromStatus(z), ['.claude/skills/drive-positron/scripts/dp-ui.ts', '.claude/skills/drive-positron/heal/x.ts', 'src/vs/new.ts', '.claude/skills/drive-positron/old.ts']);
});

test('a look-alike sibling directory is outside', () => {
	assert.deepEqual(outside(['.claude/skills/drive-positron-old/a.ts', '.claude/skills/drive-positron/a.ts', '.claude/skills/drive-positron']), ['.claude/skills/drive-positron-old/a.ts', '.claude/skills/drive-positron']);
});

test('patch: both sides of a rename, and new and deleted files', () => {
	const patch = [
		'diff --git a/.claude/skills/drive-positron/a.ts b/src/a.ts',
		'similarity index 100%',
		'rename from .claude/skills/drive-positron/a.ts',
		'rename to src/a.ts',
		'diff --git a/.claude/skills/drive-positron/b.ts b/.claude/skills/drive-positron/b.ts',
		'new file mode 100644',
		'--- /dev/null',
		'+++ b/.claude/skills/drive-positron/b.ts',
	].join('\n');
	assert.deepEqual(outside(pathsFromPatch(patch)), ['src/a.ts']);
});

test('a patch line that only looks like a header inside a hunk is ignored', () => {
	const patch = ['diff --git a/.claude/skills/drive-positron/c.md b/.claude/skills/drive-positron/c.md', '@@ -1 +1 @@', '-x', '+rename to src/evil.ts'].join('\n');
	assert.deepEqual(outside(pathsFromPatch(patch)), []);
});

test('quoted patch header with mode-only change on path outside skill', () => {
	const patch = ['diff --git "a/src/evil.ts" "b/src/evil.ts"', 'old mode 100644', 'new mode 100755'].join('\n');
	assert.deepEqual(outside(pathsFromPatch(patch)), ['src/evil.ts']);
});

test('a path containing .. is outside', () => {
	assert.deepEqual(outside(['.claude/skills/drive-positron/../x.ts', '.claude/skills/drive-positron/x.ts']), ['.claude/skills/drive-positron/../x.ts']);
});

test('status: copy entry', () => {
	const z = ['C  .claude/skills/drive-positron/old.ts', '.claude/skills/drive-positron/new.ts', ''].join('\0');
	assert.deepEqual(pathsFromStatus(z), ['.claude/skills/drive-positron/old.ts', '.claude/skills/drive-positron/new.ts']);
});
