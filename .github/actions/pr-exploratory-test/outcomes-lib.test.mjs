/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCheckPrompt, candidateIssues, decideOutcome, diffEvidence, droppedPaths, extractPaths, isCut, markDuplicates, packDiffs, parseCheck, guarded, issueOf, parsePageFindings, parseResultComment, capDiff, pickPrCheck, prOwnChanges, prOwnCommits, prOwnMessages, prPreview, renderTable, resolveTestedSha, savedPrChecks, searchTerms, settledRows } from './outcomes-lib.mjs';

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

test('extractPaths reads paths outside backticks and drops line ranges, resolving partial paths and bare names against the repo', () => {
	const files = ['src/vs/a/positronCanvasService.ts', 'src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts', 'src/vs/workbench/services/lifecycle/electron-browser/lifecycleService.ts', 'src/a/dup.ts', 'src/b/dup.ts'];
	const finding = {
		cause: 'The handler (src/vs/a/positronCanvasService.ts:534-552) keeps `positron.canvasMode.active` only when set in handleWillShutdown (lifecycle/electron-browser/lifecycleService.ts:159). '
			+ 'lifecycleMainService.registerAuxWindow (lifecycleMainService.ts:485-497) checks session.metadata.owner. Also dup.ts, e.g. https://example.com/x/index.html.',
	};
	assert.deepEqual(extractPaths(finding, files), [
		'src/vs/a/positronCanvasService.ts',
		'src/vs/platform/lifecycle/electron-main/lifecycleMainService.ts',
		'src/vs/workbench/services/lifecycle/electron-browser/lifecycleService.ts',
	]);
});

test('packDiffs groups commits in order up to the limit, and gives a commit past it a group of its own', () => {
	const parts = [{ sha: 'a', diff: 'xxxx' }, { sha: 'b', diff: 'yyy' }, { sha: 'c', diff: 'z'.repeat(20) }, { sha: 'd', diff: 'w' }];
	assert.deepEqual(packDiffs(parts, 10), [
		{ shas: ['a', 'b'], diff: 'xxxx\nyyy' },
		{ shas: ['c'], diff: 'z'.repeat(20) },
		{ shas: ['d'], diff: 'w' },
	]);
	assert.deepEqual(packDiffs([], 10), []);
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
const issue = (state, answer = 'yes') => ({ answer, reason: 'same bug', source: 'issue #9', issue: { number: 9, url: 'https://github.com/o/r/issues/9', state } });

test('decideOutcome: a yes in the PR wins, then a yes later', () => {
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), laterChecks: [yes('#1')] }).outcome, 'fixed-in-pr');
	const later = decideOutcome({ ...base, prCheck: no('commit abc'), laterChecks: [yes('main def')] });
	assert.deepEqual(later, { outcome: 'fixed-later', decidedBy: 'diff+model', evidence: 'main def: fixes it' });
});

test('decideOutcome: open PRs are pending; merged with no yes is not fixed at once', () => {
	assert.equal(decideOutcome({ ...base, prState: 'open' }).outcome, 'pending');
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc') }), { outcome: 'not-fixed', decidedBy: 'merged-no-fix', evidence: 'commit abc: unrelated' });
});

test('decideOutcome: a closed PR didn\'t ship, even with a fix in it, unless an issue or main says otherwise', () => {
	const closed = { ...base, prState: 'closed' };
	assert.deepEqual(decideOutcome({ ...closed, prCheck: no('commit abc') }), { outcome: 'didnt-ship', decidedBy: 'closed-unmerged', evidence: 'commit abc: unrelated' });
	assert.deepEqual(decideOutcome({ ...closed, prCheck: yes('commit abc') }), { outcome: 'didnt-ship', decidedBy: 'closed-unmerged', evidence: 'commit abc: fixes it' });
	assert.equal(decideOutcome({ ...closed, prCheck: yes('commit abc'), laterChecks: [issue('open')] }).outcome, 'filed-issue');
	assert.equal(decideOutcome({ ...closed, laterChecks: [issue('closed as completed')] }).outcome, 'fixed-later');
	// A fix that lands on main after the PR closed counts as fixed later.
	assert.deepEqual(decideOutcome({ ...closed, prCheck: no('commit abc'), laterChecks: [yes('main def')] }), { outcome: 'fixed-later', decidedBy: 'diff+model', evidence: 'main def: fixes it' });
	// With no tested commit, or no files named, it still didn't ship.
	assert.equal(decideOutcome({ ...closed, hasPaths: false }).outcome, 'didnt-ship');
	assert.equal(decideOutcome({ ...closed, prCheck: { answer: 'unclear', reason: 'x', source: 'pr' } }).outcome, 'didnt-ship');
});

test('decideOutcome: a matching issue is filed as issue, carrying the issue, and a fix wins over it', () => {
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc'), laterChecks: [issue('open')] }),
		{ outcome: 'filed-issue', decidedBy: 'issue+model', evidence: 'issue #9: same bug', issue: issue('open').issue });
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open'), yes('main def')] }).outcome, 'fixed-later');
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), laterChecks: [issue('open')] }).outcome, 'fixed-in-pr');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open', 'no')] }).outcome, 'not-fixed');
});

test('decideOutcome: an issue closed as completed is fixed later; closed as not planned is won\'t fix', () => {
	const done = decideOutcome({ ...base, laterChecks: [issue('closed as completed')] });
	assert.equal(done.outcome, 'fixed-later');
	assert.equal(done.decidedBy, 'issue-closed');
	assert.equal(done.issue.number, 9);
	assert.deepEqual(decideOutcome({ ...base, laterChecks: [issue('closed as not planned')] }),
		{ outcome: 'wont-fix', decidedBy: 'issue-not-planned', evidence: 'issue #9: same bug', issue: issue('closed as not planned').issue });
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open'), issue('closed as not planned')] }).outcome, 'filed-issue');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open'), issue('closed as completed')] }).outcome, 'fixed-later');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('closed as not planned', 'no')] }).outcome, 'not-fixed');
});

test('decideOutcome: a filed issue that closes as not planned becomes won\'t fix', () => {
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open')] }).outcome, 'filed-issue');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('closed as not planned')] }).outcome, 'wont-fix');
});

test('decideOutcome: a match the run made to a not-planned issue is won\'t fix, unless the PR is open, an issue is still open, or something fixed it', () => {
	const intended = [{ number: 7, url: 'https://github.com/o/r/issues/7', state: 'closed as not planned' }];
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc'), intended }),
		{ outcome: 'wont-fix', decidedBy: 'issue-not-planned', evidence: 'issue #7: the run matched it, closed as not planned', issue: intended[0] });
	assert.equal(decideOutcome({ ...base, prState: 'open', intended }).outcome, 'pending');
	assert.equal(decideOutcome({ ...base, prState: 'closed', intended }).outcome, 'wont-fix');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open')], intended }).outcome, 'filed-issue');
	assert.equal(decideOutcome({ ...base, prCheck: yes('commit abc'), intended }).outcome, 'fixed-in-pr');
	assert.equal(decideOutcome({ ...base, laterChecks: [yes('main def')], intended }).outcome, 'fixed-later');
});

test('droppedPaths names the tested files the merged PR no longer changes, and none if it still changes any', () => {
	const paths = ['src/a.ts', 'src/b.ts'];
	assert.deepEqual(droppedPaths({ paths, tested: ['src/a.ts', 'test/x.test.ts'], merged: ['test/x.test.ts'] }), ['src/a.ts']);
	assert.deepEqual(droppedPaths({ paths, tested: ['src/a.ts'], merged: ['src/b.ts'] }), []);
	// A finding about a file the PR never touched is not a dropped change.
	assert.deepEqual(droppedPaths({ paths, tested: ['src/c.ts'], merged: [] }), []);
});

test('decideOutcome: a dropped change didn\'t ship, beating not fixed and unclear, but not a fix or a filed issue', () => {
	const dropped = ['src/a.ts'];
	assert.deepEqual(decideOutcome({ ...base, prCheck: no('commit abc'), dropped }),
		{ outcome: 'didnt-ship', decidedBy: 'dropped', evidence: 'the merged PR no longer changes `src/a.ts`' });
	assert.equal(decideOutcome({ ...base, prCheck: { answer: 'unclear', reason: 'x', source: 'pr' }, dropped }).outcome, 'didnt-ship');
	assert.equal(decideOutcome({ ...base, laterChecks: [yes('main def')], dropped }).outcome, 'fixed-later');
	assert.equal(decideOutcome({ ...base, laterChecks: [issue('open')], dropped }).outcome, 'filed-issue');
});

test('candidateIssues adds issues that mention the PR to the search\'s, each once', () => {
	const repo = 'posit-dev/positron';
	const issue = (number, created_at, extra = {}) => ({ number, created_at, repository: { full_name: repo }, ...extra });
	const ref = i => ({ event: 'cross-referenced', source: { type: 'issue', issue: i } });
	const got = candidateIssues({
		found: [issue(1, '2026-10-02'), issue(2, '2026-09-30'), issue(3, '2026-10-02', { pull_request: {} })],
		timeline: [
			{ event: 'commented' },
			ref(issue(1, '2026-10-02')),
			ref(issue(4, '2026-10-03')),
			ref(issue(5, '2026-10-03', { pull_request: {} })),
			ref(issue(6, '2026-10-03', { repository: { full_name: 'posit-dev/ark' } })),
			ref(issue(7, '2026-09-30')),
		],
		postedAt: '2026-10-01',
		repo,
	});
	assert.deepEqual(got.map(i => [i.number, i.mentionsPr]), [[1, true], [4, true]]);
	assert.equal(candidateIssues({ found: [issue(8, '2026-10-02')], timeline: [], postedAt: '2026-10-01', repo })[0].mentionsPr, false);
	assert.deepEqual(candidateIssues({ found: [], timeline: undefined, postedAt: '2026-10-01', repo }), []);
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

test('diffEvidence names the files in the diff and the named ones that did not change, even past the cut', () => {
	const diff = 'diff --git a/src/a.ts b/src/a.ts\n+x\n'.padEnd(40, '+') + '\ndiff --git a/src/b.ts b/src/b.ts\n+y\n';
	const e = diffEvidence(diff, ['src/b.ts', 'ext/r.ts'], 30);
	assert.deepEqual(e.files, ['src/a.ts', 'src/b.ts']);
	assert.deepEqual(e.unchanged, ['ext/r.ts']);
	assert.match(e.text, /\[diff cut at 30 of \d+ characters\]$/);
});

test('buildCheckPrompt says which files the diff covers, which named ones did not change, and how to read a cut diff', () => {
	const finding = { title: 'T' };
	const p = buildCheckPrompt({ finding, kind: 'diff', text: 'D\n[diff cut at 1 of 9 characters]', files: ['src/a.ts'], unchanged: ['ext/r.ts'] });
	assert.match(p, /covers src\/a\.ts\./);
	assert.match(p, /also names ext\/r\.ts, which did not change, so it is not in the diff/);
	assert.match(p, /answer unclear only if the fix could be in the part that was cut/);
	const plain = buildCheckPrompt({ finding, kind: 'diff', text: 'D' });
	assert.doesNotMatch(plain, /covers|did not change|was cut/);
	assert.match(buildCheckPrompt({ finding, kind: 'diff', text: 'D', before: 'B\n[diff cut at 1 of 9 characters]' }), /was cut/);
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

test('a fix read from a cut diff is marked cut and not kept, so the next run asks again', () => {
	const cutNote = '\n[diff cut at 1 of 9 characters]';
	assert.equal(isCut({ text: 'D' + cutNote }), true);
	assert.equal(isCut({ text: 'D', before: 'B' + cutNote }), true);
	assert.equal(isCut({ text: 'D' }), false);
	const yes = (source, cut) => ({ answer: 'yes', reason: 'fixes it', source, ...(cut ? { cut } : {}) });
	assert.equal(decideOutcome({ ...base, prCheck: yes('pr a', true) }).cut, true);
	assert.equal(decideOutcome({ ...base, laterChecks: [yes('main b', true)] }).cut, true);
	assert.equal(decideOutcome({ ...base, laterChecks: [yes('main b')] }).cut, undefined);
	const prev = [
		{ run: '10', finding: 1, outcome: 'fixed-later', cut: true },
		{ run: '10', finding: 2, outcome: 'fixed-in-pr' },
		{ run: '10', finding: 3, outcome: 'not-fixed', prCheck: { ...no('pr c'), cut: true } },
		{ run: '10', finding: 4, outcome: 'not-fixed', prCheck: no('pr d') },
	];
	assert.deepEqual([...settledRows(prev).keys()], ['10#2']);
	assert.deepEqual([...savedPrChecks(prev).keys()], ['10#4']);
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
