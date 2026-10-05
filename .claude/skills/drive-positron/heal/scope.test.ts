/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { outside, pathsFromNumstatZ, pathsFromPatch, pathsFromStatus, pathsFromSummaryZ } from './scope.ts';

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

test('summary: plain arrow, ambiguous arrow, unbalanced braces', () => {
	assert.deepEqual(pathsFromSummaryZ(' rename src/a.ts => .claude/skills/drive-positron/b.ts (100%)\n create mode 100644 x\n'), ['src/a.ts', '.claude/skills/drive-positron/b.ts']);
	assert.deepEqual(pathsFromSummaryZ(' copy a => b => c (90%)\n'), ['a', 'b => c', 'a => b', 'c']);
	assert.throws(() => pathsFromSummaryZ(' rename nonsense\n'));
	assert.throws(() => pathsFromSummaryZ(' rename a/{b => c (100%)\n'));
	assert.throws(() => pathsFromSummaryZ(' rename a/{b}/c (100%)\n'));
});

// Builds a repo, stages `moves`, and runs pathsFromPatch on a real `git diff -M -C` patch.
function patchPaths(files: string[], run: (git: (...a: string[]) => void, write: (p: string, s: string) => void) => void): string[] {
	const dir = mkdtempSync(join(tmpdir(), 'scope-test-'));
	try {
		const git = (...a: string[]) => { execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=n', ...a], { cwd: dir, stdio: 'pipe' }); };
		const write = (p: string, s: string) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), s); };
		git('init', '-q');
		for (const f of files) { write(f, 'line\n'.repeat(30)); }
		git('add', '-A');
		git('commit', '-qm', 'i');
		run(git, write);
		git('add', '-A');
		const patch = execFileSync('git', ['--no-pager', 'diff', '--no-color', '--cached', '-M', '-C', '--find-copies-harder'], { cwd: dir, encoding: 'utf8' });
		writeFileSync(join(dir, 'p.patch'), patch);
		return pathsFromPatch(join(dir, 'p.patch'), dir);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SK = '.claude/skills/drive-positron';

test('real git: same-dir rename in the skill is accepted', () => {
	const p = patchPaths([`${SK}/a.ts`], git => git('mv', `${SK}/a.ts`, `${SK}/b.ts`));
	assert.deepEqual(outside(p), []);
	assert.ok(p.includes(`${SK}/a.ts`) && p.includes(`${SK}/b.ts`));
});

test('real git: subdir move in the skill is accepted', () => {
	const p = patchPaths([`${SK}/a.ts`], (git, w) => { w(`${SK}/sub/.keep`, 'x'); git('mv', `${SK}/a.ts`, `${SK}/sub/a.ts`); });
	assert.deepEqual(outside(p), []);
});

test('real git: empty-half brace forms are normalized and accepted', () => {
	const into = patchPaths([`${SK}/x.ts`], (git, w) => { w(`${SK}/sub/.keep`, 'x'); git('mv', `${SK}/x.ts`, `${SK}/sub/x.ts`); });
	assert.ok(into.includes(`${SK}/x.ts`) && into.includes(`${SK}/sub/x.ts`));
	assert.ok(!into.some(x => x.includes('//')));
	const outof = patchPaths([`${SK}/sub/x.ts`], git => git('mv', `${SK}/sub/x.ts`, `${SK}/x.ts`));
	assert.ok(outof.includes(`${SK}/sub/x.ts`) && outof.includes(`${SK}/x.ts`));
	assert.deepEqual(outside([...into, ...outof]), []);
});

test('real git: skill-to-sibling-skill rename is rejected with expanded paths', () => {
	const p = patchPaths([`${SK}/a.ts`], (git, w) => { w('.claude/skills/other/.keep', 'x'); git('mv', `${SK}/a.ts`, '.claude/skills/other/a.ts'); });
	assert.deepEqual([...new Set(outside(p))].filter(x => !x.endsWith('.keep')), ['.claude/skills/other/a.ts']);
	assert.ok(!p.some(x => /[{}]/.test(x)));
});

test('real git: rename from src into the skill is rejected', () => {
	const p = patchPaths(['src/s.ts'], (git, w) => { w(`${SK}/.keep`, 'x'); git('add', '-A'); git('mv', 'src/s.ts', `${SK}/s.ts`); });
	assert.deepEqual([...new Set(outside(p))], ['src/s.ts']);
});

test('real git: a copy reports its source and destination', () => {
	const p = patchPaths([`${SK}/e.ts`], (_git, w) => { w(`${SK}/e-copy.ts`, 'line\n'.repeat(30) + 'z\n'); });
	assert.deepEqual(outside(p), []);
	assert.ok(p.includes(`${SK}/e.ts`) && p.includes(`${SK}/e-copy.ts`));
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
