/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outside, pathsFromNumstatZ, pathsFromStatus, pathsFromSummaryZ } from './scope.ts';

test('status: modified, untracked and both sides of a rename', () => {
	const z = [' M .claude/skills/drive-positron/scripts/dp-ui.ts', '?? .claude/skills/drive-positron/heal/x.ts', 'R  src/vs/new.ts', '.claude/skills/drive-positron/old.ts', ''].join('\0');
	assert.deepEqual(pathsFromStatus(z), ['.claude/skills/drive-positron/scripts/dp-ui.ts', '.claude/skills/drive-positron/heal/x.ts', 'src/vs/new.ts', '.claude/skills/drive-positron/old.ts']);
});

test('a look-alike sibling directory is outside', () => {
	assert.deepEqual(outside(['.claude/skills/drive-positron-old/a.ts', '.claude/skills/drive-positron/a.ts', '.claude/skills/drive-positron']), ['.claude/skills/drive-positron-old/a.ts', '.claude/skills/drive-positron']);
});

test('numstat: plain, rename and non-ASCII entries', () => {
	const z = ['1\t0\t.claude/skills/drive-positron/a.ts', '0\t0\t', 'src/old.ts', '.claude/skills/drive-positron/new.ts', '-\t-\tsrc/\u00e9.ts', ''].join('\0');
	assert.deepEqual(pathsFromNumstatZ(z), ['.claude/skills/drive-positron/a.ts', 'src/old.ts', '.claude/skills/drive-positron/new.ts', 'src/\u00e9.ts']);
	assert.deepEqual(outside(pathsFromNumstatZ(z)), ['src/old.ts', 'src/\u00e9.ts']);
});

test('numstat: garbage and truncated renames throw', () => {
	assert.throws(() => pathsFromNumstatZ('not numstat\0'));
	assert.throws(() => pathsFromNumstatZ('0\t0\t\0only-one\0'));
});

test('summary: rename source, and every split of an ambiguous arrow', () => {
	assert.deepEqual(pathsFromSummaryZ(' rename src/a.ts => .claude/skills/drive-positron/b.ts (100%)\n create mode 100644 x\n'), ['src/a.ts', '.claude/skills/drive-positron/b.ts']);
	assert.deepEqual(pathsFromSummaryZ(' copy a => b => c (90%)\n'), ['a', 'b => c', 'a => b', 'c']);
	assert.throws(() => pathsFromSummaryZ(' rename nonsense\n'));
});

test('control characters in a path are outside', () => {
	assert.deepEqual(outside(['.claude/skills/drive-positron/a\nb.ts']), ['.claude/skills/drive-positron/a\nb.ts']);
});

test('a path containing .. is outside', () => {
	assert.deepEqual(outside(['.claude/skills/drive-positron/../x.ts', '.claude/skills/drive-positron/x.ts']), ['.claude/skills/drive-positron/../x.ts']);
});

test('status: copy entry', () => {
	const z = ['C  .claude/skills/drive-positron/old.ts', '.claude/skills/drive-positron/new.ts', ''].join('\0');
	assert.deepEqual(pathsFromStatus(z), ['.claude/skills/drive-positron/old.ts', '.claude/skills/drive-positron/new.ts']);
});
