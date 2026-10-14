/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPrompt, decideOutcome, extractPaths, markDuplicates, parseCheck, guarded, issueOf, parsePageFindings, parseResultComment, capDiff, pickPrCheck, prOwnChanges, prOwnCommits, prOwnMessages, prPreview, renderTable, resolveTestedSha, savedPrChecks, searchTerms, settledRows } from './outcomes-lib.mjs';

const BASE = 'https://d38p2avprg8il3.cloudfront.net/exploratory-report-38443304195-1-opus-ubuntu-x64';
const RESULT = `<!-- exploratory-test -->\n**\u{1F50E} Exploratory testing** 78afc20\n\n1 moderate · 1 minor\n[View report →](${BASE}/index.html)\n`;

test('parseResultComment takes the short SHA, report base and run id from a result comment', () => {
	assert.deepEqual(parseResultComment(RESULT), { shortSha: '78afc20', reportBase: BASE, run: '38443304195', trigger: 'explore' });
});

test('parseResultComment marks a run the auto-run experiment started', () => {
	const auto = `${RESULT}\n> Started automatically for the [auto-run experiment](https://github.com/posit-dev/positron/issues/16610). Was it useful?\n`;
	assert.equal(parseResultComment(auto).trigger, 'auto');
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

const yes = source => ({ answer: 'yes', reason: 'fixes it', source });
const no = source => ({ answer: 'no', reason: 'unrelated', source });
const base = { prState: 'merged', hasPaths: true, prCheck: null, laterChecks: [] };

test('decideOutcome: a yes in the PR wins, then a yes later', () => {
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), laterChecks: [yes('#1')] }).outcome, 'fixed-in-pr');
	const later = decideOutcome({ ...base, prCheck: no('commit abc'), laterChecks: [yes('main def')] });
	assert.deepEqual(later, { outcome: 'fixed-later', decidedBy: 'diff+model', evidence: 'main def: fixes it' });
});

test('decideOutcome: open PRs are pending; merged or closed with no yes is not fixed at once', () => {
	assert.equal(decideOutcome({ ...base, prState: 'open' }).outcome, 'pending');
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc') }), { outcome: 'not-fixed', decidedBy: 'merged-no-fix', evidence: 'commit abc: unrelated' });
	assert.equal(decideOutcome({ ...base, prState: 'closed', prCheck: no('commit abc') }).decidedBy, 'closed-unmerged');
});

const issue = (state, answer = 'yes') => ({ answer, reason: 'same bug', source: 'issue #9', issue: { number: 9, url: 'https://github.com/o/r/issues/9', state } });

test('decideOutcome: a matching issue is filed as issue, carrying the issue, and a fix wins over it', () => {
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc'), laterChecks: [issue('open')] }),
		{ outcome: 'filed-issue', decidedBy: 'issue+model', evidence: 'issue #9: same bug', issue: issue('open').issue });
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open'), yes('main def')] }).outcome, 'fixed-later');
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), laterChecks: [issue('open')] }).outcome, 'fixed-in-pr');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open', 'no')] }).outcome, 'not-fixed');
});

test('decideOutcome: an issue closed as completed is fixed later; closed as not planned stays filed', () => {
	const done = decideOutcome({ ...base, laterChecks: [issue('closed as completed')] });
	assert.equal(done.outcome, 'fixed-later');
	assert.equal(done.decidedBy, 'issue-closed');
	assert.equal(done.issue.number, 9);
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('closed as not planned')] }).outcome, 'filed-issue');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open'), issue('closed as completed')] }).outcome, 'fixed-later');
});

test('issueOf names an issue\'s state the way the page shows it', () => {
	const at = (state, state_reason) => issueOf({ number: 9, html_url: 'https://github.com/o/r/issues/9', state, state_reason });
	assert.deepEqual(at('open', null), { number: 9, url: 'https://github.com/o/r/issues/9', state: 'open' });
	assert.equal(at('closed', 'completed').state, 'closed as completed');
	assert.equal(at('closed', 'not_planned').state, 'closed as not planned');
	assert.equal(at('closed', 'duplicate').state, 'closed');
});

test('decideOutcome: no paths unless an issue says yes; unclear beats pending', () => {
	assert.equal(decideOutcome({ ...base, hasPaths: false }).outcome, 'no-paths');
	assert.equal(decideOutcome({ ...base, hasPaths: false, laterChecks: [yes('issue #9')] }).outcome, 'filed-issue');
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

test('resolveTestedSha prefers the report\'s full SHA, else looks up the short one, else says why not', async () => {
	const full = 'a'.repeat(40);
	assert.deepEqual(await resolveTestedSha({ headSha: full, shortSha: 'bbbbbbb', lookup: async () => { throw new Error('unused'); } }), { sha: full, reason: '' });
	assert.deepEqual(await resolveTestedSha({ shortSha: 'bbbbbbb', lookup: async s => `${s}${'0'.repeat(33)}` }), { sha: `bbbbbbb${'0'.repeat(33)}`, reason: '' });
	assert.deepEqual(await resolveTestedSha({ shortSha: 'bbbbbbb', lookup: async () => { throw new Error('404'); } }), { sha: null, reason: 'tested commit bbbbbbb not found: Error: 404' });
});

test('parsePageFindings reads each finding from the page when report.json was not published', () => {
	const prompt = (n, sev, title, status, cause) => `<script type="text/plain" id="prompt-f${n}">## Finding ${n} — ${sev}\n\n${title}\n\nStatus: ${status}\nReproduced: 2/2\n\n### Observed\nIt shows uv.\n\n### Expected\nIt hides uv.\n\n### Likely cause (hypothesis, not verified)\n${cause}\n\n### Context\nx</script>`;
	const html = `<p>x</p>${prompt(1, 'Moderate', 'Lists uv when it is off.', 'Confirmed', '`getRanked` in `src/a/b.ts:126` returns it.')}<script type="text/plain" id="issue-f1">## Describe</script>${prompt(2, 'Minor', 'Focus is lost', 'Unresolved', 'Unknown.')}`;
	assert.deepEqual(parsePageFindings(html), [
		{ n: 1, title: 'Lists uv when it is off', severity: 'moderate', verified: 'confirmed', observed: 'It shows uv.', expected: 'It hides uv.', cause: '`getRanked` in `src/a/b.ts:126` returns it.' },
		{ n: 2, title: 'Focus is lost', severity: 'minor', verified: 'unresolved', observed: 'It shows uv.', expected: 'It hides uv.', cause: 'Unknown.' },
	]);
	assert.deepEqual(extractPaths(parsePageFindings(html)[0]), ['src/a/b.ts']);
	assert.deepEqual(parsePageFindings('<p>no findings</p>'), []);
});

test('prOwnCommits keeps the PR\'s own commits after the tested one, leaving out merges from main', () => {
	const c = (sha, ...parents) => ({ sha, parents: parents.map(p => ({ sha: p })) });
	const commits = [c('a1', 'm0'), c('t2', 'a1'), c('b3', 't2'), c('x4', 'b3', 'main9'), c('d5', 'x4')];
	assert.deepEqual(prOwnCommits(commits, 't2'), ['b3', 'd5']);
	assert.deepEqual(prOwnCommits(commits, 'd5'), []);
	assert.equal(prOwnCommits(commits, 'zz'), null);
});

test('guarded turns a failed lookup into an unclear check, never a lost PR', async () => {
	assert.deepEqual(await guarded('issues', async () => [{ answer: 'no', reason: '', source: 'issue #1' }]), [{ answer: 'no', reason: '', source: 'issue #1' }]);
	assert.deepEqual(await guarded('issues', async () => { throw new Error('403 rate limit'); }), [{ answer: 'unclear', reason: 'issues failed: Error: 403 rate limit', source: 'issues' }]);
});

test('parsePageFindings keeps every paragraph of a section', () => {
	const html = '<script type="text/plain" id="prompt-f1">## Finding 1 — Minor\n\nT\n\nStatus: Confirmed\n\n### Observed\nline one\nline two\n\n### Likely cause (hypothesis, not verified)\nFirst.\n\nThen `src/a/b.ts:3` too.</script>';
	const [f] = parsePageFindings(html);
	assert.equal(f.observed, 'line one\nline two');
	assert.deepEqual(extractPaths(f), ['src/a/b.ts']);
});

test('prOwnChanges diffs tested..head in one piece unless main was merged in after the run', () => {
	const c = (sha, ...parents) => ({ sha, parents: parents.map(p => ({ sha: p })) });
	assert.deepEqual(prOwnChanges([c('t1', 'm0'), c('b2', 't1'), c('d3', 'b2')], 't1'), { range: ['t1', 'd3'] });
	assert.deepEqual(prOwnChanges([c('t1', 'm0'), c('b2', 't1'), c('x3', 'b2', 'main9'), c('d4', 'x3')], 't1'), { shas: ['b2', 'd4'] });
	assert.deepEqual(prOwnChanges([c('t1', 'm0')], 't1'), { shas: [] });
	assert.equal(prOwnChanges([c('t1', 'm0')], 'zz'), null);
});

test('buildCheckPrompt adds the commit messages, says when the diff is the whole PR, and counts an unreachable problem as fixed', () => {
	const finding = { title: 'T', observed: 'O', expected: 'E', cause: 'C' };
	const narrow = buildCheckPrompt({ finding, kind: 'diff', text: 'DIFF' });
	assert.ok(!narrow.includes('<commits>'));
	assert.match(narrow, /can no longer be reached/);
	const wide = buildCheckPrompt({ finding, kind: 'diff', text: 'DIFF', messages: 'abc1234567 drop the callout\n\nuv is no longer offered', whole: true });
	assert.match(wide, /<commits>\nabc1234567 drop the callout\n\nuv is no longer offered\n<\/commits>/);
	assert.match(wide, /whole change/);
});

test('prOwnMessages gives the messages of the PR\'s own commits after the tested one', () => {
	const c = (sha, message, ...parents) => ({ sha, commit: { message }, parents: parents.map(p => ({ sha: p })) });
	const commits = [c('t1aaaaaaaaaa', 'tested', 'm0'), c('b2bbbbbbbbbb', 'fix the text\n\nbecause', 't1'), c('x3', 'Merge main', 'b2', 'main9'), c('d4dddddddddd', 'tidy', 'x3')];
	assert.equal(prOwnMessages(commits, 't1aaaaaaaaaa'), 'b2bbbbbbbb fix the text\n\nbecause\n\nd4dddddddd tidy');
	assert.equal(prOwnMessages(commits, 'd4dddddddddd'), '');
	assert.equal(prOwnMessages(commits, 'zz'), null);
});

test('pickPrCheck: a yes on the whole PR wins, otherwise the check on the named files stands', () => {
	const c = (answer, source) => ({ answer, reason: '', source });
	assert.deepEqual(pickPrCheck(c('no', 'pr a'), c('yes', 'pr (whole) a')), c('yes', 'pr (whole) a'));
	assert.deepEqual(pickPrCheck(c('unclear', 'pr a'), c('no', 'pr (whole) a')), c('unclear', 'pr a'));
	assert.deepEqual(pickPrCheck(null, c('no', 'pr (whole) a')), c('no', 'pr (whole) a'));
	assert.deepEqual(pickPrCheck(c('yes', 'pr a'), null), c('yes', 'pr a'));
	assert.equal(pickPrCheck(null, null), null);
});

test('capDiff cuts a long diff and says so, so the model does not read a cut diff as the whole change', () => {
	assert.equal(capDiff('abc', 5), 'abc');
	assert.equal(capDiff('abcdefgh', 5), 'abcde\n[diff cut at 5 of 8 characters]');
});

test('extractPaths finds a bare file name in the repo when exactly one file has it', () => {
	const files = ['src/a/runtimeSession.ts', 'src/b/dup.ts', 'src/c/dup.ts'];
	const finding = { cause: 'Throws at `runtimeSession.ts:684`, also in `dup.ts` and `missing.ts`.' };
	assert.deepEqual(extractPaths(finding, files), ['src/a/runtimeSession.ts']);
	assert.deepEqual(extractPaths(finding), []);
});

test('buildCheckPrompt compares the PR as tested with the PR as merged after a force-push', () => {
	const prompt = buildCheckPrompt({ finding: { title: 'T' }, kind: 'diff', text: 'AFTER', before: 'BEFORE' });
	assert.ok(prompt.indexOf('<before>\nBEFORE\n</before>') < prompt.indexOf('<diff>\nAFTER\n</diff>'));
	assert.match(prompt, /only if what changed between them addresses/);
	assert.doesNotMatch(buildCheckPrompt({ finding: { title: 'T' }, kind: 'diff', text: 'D' }), /<before>/);
});

test('decideOutcome keeps the reason a check said no, so a not-fixed row can be checked by hand', () => {
	const checks = { prCheck: no('pr abc'), laterChecks: [no('issue #9')] };
	assert.equal(decideOutcome({ ...base, ...checks, mergedAt: '2026-10-02T00:00:00Z' }).evidence, 'pr abc: unrelated');
	assert.equal(decideOutcome({ ...base, ...checks, prState: 'closed', mergedAt: null }).evidence, 'pr abc: unrelated');
	assert.equal(decideOutcome({ ...base, prCheck: null, laterChecks: [no('main def')] }).evidence, 'main def: unrelated');
	assert.equal(decideOutcome({ ...base, prState: 'open', mergedAt: null }).evidence, '');
});

test('parseCheck says an empty reply is no reply, so a stopped call reads as such', () => {
	assert.deepEqual(parseCheck(''), { answer: 'unclear', reason: 'no reply: the model call was stopped or timed out' });
});

test('settledRows keeps a previous run\'s fixed rows by run and finding, without duplicate marks; not fixed is checked again', () => {
	const prev = [
		{ run: '10', finding: 1, outcome: 'fixed-in-pr', dupOf: '9#1' },
		{ run: '10', finding: 2, outcome: 'fixed-later' },
		{ run: '11', finding: 1, outcome: 'not-fixed', dupMaybe: '10#1' },
		{ run: '11', finding: 2, outcome: 'pending' },
		{ run: '12', finding: 1, outcome: 'unclear' },
		{ run: '12', finding: 2, outcome: 'no-paths' },
	];
	const kept = settledRows(prev);
	assert.deepEqual([...kept.keys()], ['10#1', '10#2']);
	assert.deepEqual(kept.get('10#1'), { run: '10', finding: 1, outcome: 'fixed-in-pr' });
});

test('savedPrChecks keeps a merged PR\'s "no" answer by run and finding, and never an unclear one', () => {
	const no = { answer: 'no', reason: 'touches other code', source: 'pr abc1234' };
	const kept = savedPrChecks([
		{ run: '10', finding: 1, outcome: 'pending', prCheck: no },
		{ run: '10', finding: 2, outcome: 'pending', prCheck: { answer: 'unclear', reason: 'no reply', source: 'pr' } },
		{ run: '11', finding: 1, outcome: 'pending' },
	]);
	assert.deepEqual([...kept.keys()], ['10#1']);
	assert.deepEqual(kept.get('10#1'), no);
});

const pull = extra => ({
	title: 'Plots: one accessible name per thumbnail', user: { login: 'someone' }, body: 'Fixes the thing.', state: 'closed',
	created_at: '2026-10-01T10:00:00Z', merged_at: '2026-10-03T09:00:00Z', closed_at: '2026-10-03T09:00:00Z', additions: 38, deletions: 12, changed_files: 3, ...extra,
});

test('prPreview keeps what the PR card shows, dated by merge, close or open', () => {
	assert.deepEqual(prPreview(pull()), { title: 'Plots: one accessible name per thumbnail', author: 'someone', state: 'merged', date: '2026-10-03T09:00:00Z', additions: 38, deletions: 12, files: 3, desc: 'Fixes the thing.' });
	assert.equal(prPreview(pull({ merged_at: null })).state, 'closed');
	const open = prPreview(pull({ state: 'open', merged_at: null, closed_at: null }));
	assert.deepEqual([open.state, open.date], ['open', '2026-10-01T10:00:00Z']);
	assert.equal(prPreview(pull({ body: null })).desc, '');
});

test('prPreview takes the first paragraph of prose, skipping headings, references, lists and checklists', () => {
	const desc = body => prPreview(pull({ body })).desc;
	assert.equal(desc('### Summary\n\nFixes keyboard focus being lost after #16450 merged.\n- A bullet\n- Another'), 'Fixes keyboard focus being lost after #16450 merged.');
	assert.equal(desc('Fixes #12081\nFixes #14767\n\n### Summary\n\nAdds an `interpreters.definitions` setting.\n\nMore.'), 'Adds an interpreters.definitions setting.');
	assert.equal(desc('- Addresses #10753\n- Related to https://github.com/quarto-dev/quarto/pull/1193\n\n### Summary\n\nExtensions can show a stop button.'), 'Extensions can show a stop button.');
	assert.equal(desc('<!-- Thank you! -->\n- [ ] Tested\n\n```json\n{}\n```\n\nSee the **[docs](https://x.y)** for ![shot](https://x.y/a.png) _details_.'), 'See the docs for details.');
	assert.equal(desc('<img width="10" src="a.png" />\n\nBefore this PR,\nthe Viewer had no stop button.'), 'Before this PR, the Viewer had no stop button.');
	assert.equal(desc('### Only a heading\n- [x] done'), '');
	assert.equal(desc('Fixes #13104 .\r\n\r\n### Summary\r\nA missing uv no longer dead-ends the flow.\r\n- Install uv'), 'A missing uv no longer dead-ends the flow.');
});
