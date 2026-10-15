/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import type { CaseResult, SmokeResults } from '../test/smoke-lib.ts';
import { addedKeys, affectedHelpers, postSections, readGraph, selectorUsers } from './affected.ts';

const scripts = join(dirname(new URL(import.meta.url).pathname), '../scripts');
const g = readGraph(scripts);
const P = '.claude/skills/drive-positron/';
const hit = (...paths: string[]) => { const a = affectedHelpers(paths.map(p => P + p), g); return a === 'all' ? 'all' : [...a].sort(); };

test('readGraph knows the module of every command a .sh runs', () => {
	for (const f of readdirSync(scripts).filter(f => f.endsWith('.sh'))) {
		for (const m of readFileSync(join(scripts, f), 'utf8').matchAll(/dp\.ts" ([a-z][a-z-]*)/g)) {
			if (!['help', 'log', 'fail', 'usage-error'].includes(m[1])) { assert.ok(g.moduleOf.has(m[1]), `${f}: dp.ts ${m[1]} has no module`); }
		}
	}
});

test('a dp-<area>.ts reaches its own helpers and the recipes that call them', () => {
	assert.deepEqual(hit('scripts/dp-terminal.ts'), ['terminal-run.sh']);
	assert.deepEqual(hit('scripts/dp-plots.ts'), ['plots.sh']);
	assert.ok((hit('scripts/ui.sh') as string[]).includes('debug.sh'));
});

test('a module reaches the helpers of every module that imports it', () => {
	const palette = hit('scripts/dp-palette.ts') as string[];
	for (const h of ['palette-run.sh', 'console-run.sh', 'terminal-run.sh', 'panel.sh']) { assert.ok(palette.includes(h), h); }
	assert.ok(!palette.includes('editor.sh'));
});

test('shared files are all; docs and heal/ are nothing', () => {
	for (const p of ['scripts/dp.ts', 'scripts/dp-lib.ts', 'scripts/page-lib.ts', 'scripts/selectors.ts', 'test/smoke.ts', 'fixture/analysis.R']) { assert.equal(hit(p), 'all', p); }
	assert.deepEqual(hit('SKILL.md', 'scripts/README.md', 'heal/fixer.md'), []);
	assert.equal(affectedHelpers(['src/vs/x.ts'], g), 'all');
});

const c = (name: string, helper: string, group?: string): CaseResult => ({ name, status: 'PASS', helper, args: [], problem: '', ms: 10, ...(group ? { group } : {}) });
const r = (cases: CaseResult[]): SmokeResults => ({ startedAt: '2026-10-06T03:40:00Z', until: null, quick: false, launch: 'PASS', launchProblem: '', cases });
const base = r([c('a1', 'console-run.sh', 'a'), c('a2', 'ui.sh', 'a'), c('b1', 'editor.sh', 'b'), c('c1', 'terminal-run.sh', 'c'), c('c2', 'ui.sh', 'c'), c('d1', 'plots.sh', 'd'), c('e1', 'nb.sh', 'e')]);

test('postSections: the sections whose cases use a helper, with each one\'s last case', () => {
	assert.deepEqual(postSections(base, new Set(['terminal-run.sh']), { case: 'c1', helper: 'terminal-run.sh' }, 1), [{ id: 'c', last: 'c2' }]);
	assert.deepEqual(postSections(base, new Set(['ui.sh']), { helper: 'ui.sh' }, 1), [{ id: 'a', last: 'a2' }, { id: 'c', last: 'c2' }]);
});

test('postSections always has the fix\'s own case', () => {
	assert.deepEqual(postSections(base, new Set(), { case: 'b1', helper: 'editor.sh' }, 1), [{ id: 'b', last: 'b1' }]);
	assert.deepEqual(postSections(base, new Set(['plots.sh']), { case: 'e1', helper: 'nb.sh' }, 1), [{ id: 'd', last: 'd1' }, { id: 'e', last: 'e1' }]);
});

test('postSections is a full run for a shared change, no sections, or when the launches cost as much', () => {
	assert.equal(postSections(base, 'all', { case: 'c1', helper: 'terminal-run.sh' }), null);
	assert.equal(postSections(base, new Set(), { helper: 'not-in-smoke.sh' }), null);
	assert.equal(postSections(r([c('x', 'ui.sh')]), new Set(['ui.sh']), { helper: 'ui.sh' }), null);
	// Cases are 10 ms each, 70 in all: a, b, c (50 ms) on three launches.
	const three = new Set(['ui.sh', 'editor.sh']);
	assert.equal(postSections(base, three, { helper: 'ui.sh' }, 5)?.length, 3); // 50 + 15 < 70 + 5
	assert.equal(postSections(base, three, { helper: 'ui.sh' }, 10), null); // 50 + 30 >= 70 + 10
});

const diff = (...lines: string[]) => ['diff --git a/x b/x', 'index 1..2 100644', '--- a/x', '+++ b/x', '@@ -258,0 +259 @@ export const names = {', ...lines].join('\n');

test('addedKeys: added entries only, else null', () => {
	assert.deepEqual(addedKeys(diff("+\t\topenAccessibleView: 'Open Accessible View',", '+', "+\t\t'x-y': '.x', // why")), ['openAccessibleView', 'x-y']);
	assert.deepEqual(addedKeys(diff("+\t\tsimilarCommands: '.a',")), ['similarCommands']);
	assert.equal(addedKeys(diff("-\t\told: 'a',", "+\t\told: 'b',")), null);
	assert.equal(addedKeys(diff('+\t\tgroup: {')), null);
	assert.equal(addedKeys(diff("+\t\tlong: 'a' +")), null);
	assert.deepEqual(addedKeys(''), []);
});

test('selectorUsers: the scripts that use a key, null when a shared file does', () => {
	assert.deepEqual(selectorUsers(['accessibleView'], scripts), [P + 'scripts/dp-terminal.ts']);
	assert.deepEqual(selectorUsers(['cursorStatusPattern'], scripts), null);
	assert.deepEqual(selectorUsers(['notUsedAnywhere'], scripts), []);
	assert.equal(selectorUsers(null, scripts), null);
	const prev = selectorUsers(['previous'], scripts) ?? [];
	assert.ok(prev.includes(P + 'scripts/plots.sh'), 'bash $plots_previous');
});
