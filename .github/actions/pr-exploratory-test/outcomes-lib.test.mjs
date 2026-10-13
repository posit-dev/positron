/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPrompt, decideOutcome, extractPaths, markDuplicates, parseCheck, parseResultComment, renderTable, searchTerms } from './outcomes-lib.mjs';

const BASE = 'https://d38p2avprg8il3.cloudfront.net/exploratory-report-38443304195-1-opus-ubuntu-x64';
const RESULT = `<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\n1 moderate · 1 minor\n[View report →](${BASE}/index.html)\n`;

test('parseResultComment takes the short SHA, report base and run id from a result comment', () => {
	assert.deepEqual(parseResultComment(RESULT), { shortSha: '78afc20', reportBase: BASE, run: '38443304195' });
});

test('parseResultComment skips comments with no report: running, declined, cancelled, not ours', () => {
	const run = '[View run →](https://github.com/posit-dev/positron/actions/runs/1)';
	assert.equal(parseResultComment(`<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\nOff exploring, back soon…\n${run}\n`), null);
	assert.equal(parseResultComment(`<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\nCancelled before the agent produced a report.\n${run}\n`), null);
	assert.equal(parseResultComment(RESULT.replace('<!-- exploratory-test -->\n', '')), null);
});

test('extractPaths takes backticked repo paths from the cause and test case paths', () => {
	const finding = {
		cause: '`createSizingItems` is called without the id (`src/vs/workbench/contrib/positronPlots/browser/positronPlotsActions.ts`, also `extensions/positron-python/src/a.ts:12`). See `positronPlotsActions.ts`.',
		tests: { cases: [{ path: 'test/e2e/tests/plots/plots.test.ts' }, { path: '' }] },
	};
	assert.deepEqual(extractPaths(finding), [
		'extensions/positron-python/src/a.ts',
		'src/vs/workbench/contrib/positronPlots/browser/positronPlotsActions.ts',
		'test/e2e/tests/plots/plots.test.ts',
	]);
	assert.deepEqual(extractPaths({ cause: 'only `positronPlotsActions.ts` is named' }), []);
	assert.deepEqual(extractPaths({}), []);
});

test('searchTerms keeps up to six plain words from a title', () => {
	assert.equal(searchTerms('Change Plot Sizing Policy fails with `Plot not found` when only an editor plot is open'), 'Change Plot Sizing Policy fails Plot');
});

test('buildCheckPrompt carries the finding and the evidence, and asks for one line', () => {
	const p = buildCheckPrompt({ finding: { title: 'T', observed: 'O', expected: 'E', cause: 'C' }, kind: 'diff', text: 'DIFF' });
	for (const s of ['T', 'O', 'E', 'C', 'DIFF', 'yes', 'no', 'unclear']) {
		assert.ok(p.includes(s), s);
	}
});

test('parseCheck reads yes, no and unclear in any casing or markdown, and anything else as unclear', () => {
	assert.deepEqual(parseCheck('yes - the toast now routes the error'), { answer: 'yes', reason: 'the toast now routes the error' });
	assert.deepEqual(parseCheck('\n**No**: unrelated refactor'), { answer: 'no', reason: 'unrelated refactor' });
	assert.equal(parseCheck('UNCLEAR. The diff is partial.').answer, 'unclear');
	assert.equal(parseCheck('Probably fixed').answer, 'unclear');
	assert.equal(parseCheck('').answer, 'unclear');
});

const NOW = new Date('2026-12-01T00:00:00Z');
const yes = source => ({ answer: 'yes', reason: 'fixes it', source });
const no = source => ({ answer: 'no', reason: 'unrelated', source });
const base = { prState: 'merged', mergedAt: '2026-11-20T00:00:00Z', now: NOW, hasPaths: true, prCheck: null, laterChecks: [] };

test('decideOutcome: a yes in the PR wins, then a yes later', () => {
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), laterChecks: [yes('#1')] }).outcome, 'fixed-in-pr');
	const later = decideOutcome({ ...base, prCheck: no('commit abc'), laterChecks: [yes('issue #9')] });
	assert.deepEqual(later, { outcome: 'fixed-later', decidedBy: 'issue+model', evidence: 'issue #9: fixes it' });
});

test('decideOutcome: open PRs are pending, closed unmerged with no yes is not acted on', () => {
	assert.equal(decideOutcome({ ...base, prState: 'open', mergedAt: null }).outcome, 'pending');
	assert.equal(decideOutcome({ ...base, prState: 'closed', mergedAt: null, prCheck: no('commit abc') }).outcome, 'not-acted-on');
});

test('decideOutcome: the 60-day window, counted from merge', () => {
	assert.equal(decideOutcome({ ...base, mergedAt: '2026-10-02T00:00:00Z' }).outcome, 'pending');
	assert.equal(decideOutcome({ ...base, mergedAt: '2026-10-01T23:59:59Z' }).outcome, 'not-acted-on');
});

test('decideOutcome: no paths unless an issue says yes; unclear beats pending', () => {
	assert.equal(decideOutcome({ ...base, hasPaths: false }).outcome, 'no-paths');
	assert.equal(decideOutcome({ ...base, hasPaths: false, laterChecks: [yes('issue #9')] }).outcome, 'fixed-later');
	assert.equal(decideOutcome({ ...base, prCheck: { answer: 'unclear', reason: 'model failed: x', source: 'commit abc' } }).outcome, 'unclear');
});

test('markDuplicates: same title or same paths is a duplicate of the earlier run; a close title is flagged', () => {
	const row = (run, finding, title, paths) => ({ pr: 1, run, finding, title, paths });
	const rows = markDuplicates([
		row('10', 1, 'Picker loses `focus` after typing', ['a/b.ts']),
		row('11', 1, 'picker loses focus after typing', ['c/d.ts']),
		row('11', 2, 'Something else', ['a/b.ts']),
		row('11', 3, 'Picker loses focus after a reload', ['e/f.ts']),
		row('11', 4, 'Unrelated', []),
	]);
	assert.equal(rows[0].dupOf, undefined);
	assert.equal(rows[1].dupOf, '10#1');
	assert.equal(rows[2].dupOf, '10#1');
	assert.equal(rows[3].dupMaybe, '10#1');
	assert.equal(rows[4].dupOf, undefined);
	assert.equal(rows[4].dupMaybe, undefined);
});

test('renderTable lists each row and the counts, leaving duplicates out of the counts', () => {
	const out = renderTable([
		{ pr: 1, run: '10', finding: 1, title: 'A | B', severity: 'minor', outcome: 'fixed-in-pr', evidence: 'commit abc: x' },
		{ pr: 1, run: '11', finding: 1, title: 'A', severity: 'minor', outcome: 'fixed-in-pr', evidence: 'e', dupOf: '10#1' },
	]);
	assert.match(out, /\| #1 \| 10#1 \| minor \| A \\\| B \| fixed-in-pr \| commit abc: x \|/);
	assert.match(out, /fixed-in-pr: 1/);
});
