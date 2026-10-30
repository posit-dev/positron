/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Tests for the report model and page. Markup is pinned by scenes at the end:
// each renders one case and names the decision it shows, and
// fixtures/scenes.expected.txt holds what each rendered. After a change you
// meant, rewrite it and review its diff:
//   UPDATE_PAGES=1 node --test report.test.mjs
// The tests above the scenes check what a saved page cannot: values the page
// does not show, what its scripts do, and what a hostile report cannot do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseLedger, parseSystemLine } from '../shared/ledger.mjs';
import { modelDisplayName, safeUrl } from '../shared/text.mjs';
import { renderReportHtml } from './html.mjs';
import { skillVersion } from './page-common.mjs';
import { reportFromJson } from './report-json.mjs';
import { checkScenes } from '../shared/scene-check.mjs';
import { withLogsRun } from '../shared/tmp-dirs.mjs';

// The renders these tests spawn must not post usage rows.
process.env.EXPLORATORY_TEST_NO_USAGE = '1';

// ---- Inputs ----------------------------------------------------------------

const HEADER = {
	title: 'Exploratory test: something',
	branch: 'branch/name',
	sha: 'abc1234',
	result: 'It works. **But not on slow sources.**',
	tested: 'the summary panel on two backends, 3 scenarios',
	notExercised: 'the web build',
};

/** A report.json with the shared header, and `parts` over it; `parts.header` merges into the header. */
function rep(parts = {}) {
	const { header, ...rest } = parts;
	return { header: { ...HEADER, ...header }, findings: [], ...rest };
}

/** A finding with only what the schema requires, and `fields` over it. */
function fnd(n, fields = {}) {
	return { n, severity: 'minor', reproduced: { n: 1, m: 1 }, feature: 'data explorer', title: 'a claim', observed: '', expected: '', steps: [], tests: { cases: [], related: [] }, ...fields };
}

const act = text => ({ kind: 'action', text });
const pass = (text, fields = {}) => ({ kind: 'verify', text, result: 'pass', ...fields });
const fail = (text, finding, fields = {}) => ({ kind: 'verify', text, result: 'fail', finding, ...fields });

/** The page for report.json `json`, dated so it renders the same every year; `options.ledger` builds Coverage. */
function render(json, options = {}) {
	return renderReportHtml(reportFromJson(json, { ledger: options.ledger }), { startedAt: new Date('2026-09-29T00:00:00Z'), ...options });
}

/** The model for report.json `json`. */
const model = (json, ledger) => reportFromJson(json, { ledger });

/** A ledger section per scenario: `[id, name, status, result]`, and `[id, name, reason]` for not run. */
function ledgerOf(rows) {
	const run = rows.filter(r => r.length === 4).map(([id, name, status, result]) => `## ${id} - ${name}\nStatus: ${status}\nResult: ${result}\n`);
	const notRun = rows.filter(r => r.length === 3).map(([id, name, reason]) => `- ${id} - ${name} - ${reason}`);
	return [...run, ...(notRun.length ? ['## Not run', ...notRun] : [])].join('\n');
}

/** A report with one of everything the template lays out. */
const FULL = rep({
	header: {
		details: [
			{ title: 'Change under test', body: '`git diff a...b`.' },
			{ title: 'Environment', body: 'A pre-launched instance.' },
		],
	},
	findings: [
		fnd(1, {
			severity: 'major',
			reproduced: { n: 3, m: 3 },
			title: 'a longer claim',
			verified: 'confirmed',
			preconditions: [{ name: 'pandas console', text: 'a console with pandas' }],
			steps: [act('Run the thing.'), act('Wait 15 s.')],
			observed: 'it spun forever.',
			expected: 'it should have stopped.',
			evidence: [
				{ kind: 'shot', path: 'https://cdn.example/shots/01-stuck.png', caption: 'the spinner, 60 s later', featured: true },
				{ kind: 'log', path: 'logs/app.log', when: 'repeated twice', quote: '[123:INFO:CONSOLE] "RPC timed out after 5 seconds"' },
			],
			cause: 'the timeout was cut to 10 s.',
		}),
		fnd(2, {
			title: 'a second claim',
			verified: 'confirmed',
			observed: 'the icon touches the text.',
			expected: 'a 6 px gap.',
		}),
	],
	verification: { failed: false, text: 'A second agent re-read this report.\n\n**1.** Checks out.' },
	cost: {
		passes: [
			{ label: 'explore', model: 'claude-opus-5-5', costUsd: 3.12, turns: 77, maxTurns: 200, durationMs: 1560000 },
			{ label: 'verify', model: null, costUsd: 0.63, turns: 31, durationMs: 300000 },
		],
	},
});
const FULL_LEDGER = ledgerOf([
	['S01', 'pandas frame', 'pass', 'everything loads'],
	['S02', 'polars frame', 'pass', 'same as pandas'],
	['S03', 'expand while paused', 'fail - Finding 1', 'dots never resolve'],
	['N01', 'the web build', 'desktop only'],
]);
const fullHtml = (json = FULL, options = {}) => render(json, { ledger: FULL_LEDGER, ...options });
/** FULL with finding `n`'s fields replaced. */
const fullWith = (n, fields) => ({ ...FULL, findings: FULL.findings.map(f => (f.n === n ? { ...f, ...fields } : f)) });

/** A finding with every collapsed row and step-tagged shots, and Coverage from a ledger with steps. */
const RICH = rep({
	findings: [
		fnd(1, {
			severity: 'major',
			reproduced: { n: 3, m: 3 },
			title: 'A column never loads, and Retry cannot help',
			steps: [act('Open it.'), act('Wait.'), act('Click Retry.')],
			observed: 'it never loads.',
			evidence: [
				{ kind: 'shot', path: 'https://cdn.example/shots/c.png', caption: 'Variant: five columns' },
				{ kind: 'shot', path: 'https://cdn.example/shots/b.png', step: 3, caption: 'after Retry' },
				{ kind: 'shot', path: 'https://cdn.example/shots/a.png', step: 2, caption: 'the notice' },
				{ kind: 'log', path: 'logs/app.log', quote: 'timed out' },
			],
			errors: [
				{
					source: 'logs/app.log',
					process: 'Renderer',
					count: 2,
					message: 'Error: get_column_profiles timed out after 10 seconds',
					frames: [{ fn: 'Client.getColumnProfiles', path: 'src/vs/client.ts', line: 212 }, { fn: '', path: '/abs/out/cache.js', line: 538 }],
				},
				{ source: 'logs/ext.log', process: 'Extension host', message: 'Warning: no stack here' },
			],
			cause: 'the timeout was cut.',
			tests: {
				cases: [
					{ text: 'Retry after a timeout loads the summary.', level: 'unit', path: 'src/vs/test/cache.test.ts', isNew: false },
					{ text: 'A slow source offers no Retry.', level: 'e2e', path: 'test/e2e/tests/slow.test.ts', isNew: true },
				],
				related: [
					{ path: 'src/vs/test/cache.test.ts', level: 'unit', note: 'already named above' },
					{ path: 'src/vs/test/client.test.ts', level: 'unit', note: 'checks request shape only' },
				],
			},
		}),
		fnd(2, {
			title: 'b claim with nothing collapsed',
			observed: 'the icon touches the text.',
			tests: { cases: [{ text: 'One case only.', level: 'unit', path: 'src/vs/test/icon.test.ts', isNew: false }], related: [] },
		}),
	],
});
const RICH_LEDGER = [
	'## S01 - pandas frame', 'Status: pass', 'Result: everything loads', '', 'Steps:', '1. Build `df`.', '2. Run `%view df`.', '',
	'## S02 - polars frame', 'Status: pass', 'Result: same as pandas', '',
	'## S03 - arrow frame', 'Status: pass', 'Result: same as pandas', '', 'Steps:', '1. Build `tbl`.', '2. VERIFY it loads. -> PASS', '   Evidence: https://cdn.example/shots/arrow.png', '',
	'## S04 - duckdb frame', 'Status: pass', 'Result: same as pandas', '',
	'## S05 - slow column', 'Status: fail - Finding 1', 'Result: Fails 3/3', '', 'Steps:', '1. Should not render.', '',
	'## Not run', '- N01 - the web build - desktop only', '',
].join('\n');
const richHtml = (json = RICH, options = {}) => render(json, { ledger: RICH_LEDGER, ...options });
/** RICH with finding `n`'s fields replaced. */
const richWith = (n, fields) => ({ ...RICH, findings: RICH.findings.map(f => (f.n === n ? { ...f, ...fields } : f)) });

// Two findings from a real run, with S08, S09, S01 and S04 of its ledger: two failing scenarios, two passing.
const SLOW_PY = { name: '`slow.py` loaded', text: '`slow.py` loaded with `%run -i slow.py`.' };
const TYPED = rep({
	header: {
		title: 'Exploratory test: column summaries on slow sources',
		branch: 'midleman/exp-ab-dx-opus',
		sha: 'ed2487a1a2',
		pr: { repo: 'posit-dev/positron', number: 1234 },
		result: 'Column summaries load and pause on schedule. **A column over 10 s never loads, and Continue loads the wrong columns.**',
		tested: 'the summary panel on pandas and a slow source, 4 scenarios',
	},
	findings: [
		fnd(1, {
			severity: 'major',
			reproduced: { n: 3, m: 3 },
			title: 'A column over 10 s never loads, and Retry cannot help',
			preconditions: [SLOW_PY],
			steps: [
				act('Run `one12 = make_slow(ncols=1, nrows=1000, delay=0.012)`. One string column whose frequency table takes about 13 s.'),
				act('Run `%view one12` and wait 15 s.'),
				fail('the column summary loads.', 1, {
					observed: 'Loading dots, then "Some summaries unavailable. Retry"; the sparkline slot empties.',
					shots: ['shots/09-one12-unavailable.png', 'shots/07-slow12-unavailable.png'],
					log: { source: 'get_column_profiles timed out after 10 seconds (Renderer, 2x)' },
				}),
				act('Click Retry and wait 15 s. Repeat once.'),
				fail('the summary loads after Retry.', 1, { observed: 'Same notice after each Retry.', shots: ['shots/08-slow12-after-retry.png'] }),
			],
			observed: 'The summary never loads; the panel shows "Some summaries unavailable. Retry", and Retry shows it again.',
			expected: 'The summary loads, or Retry loads it.',
			evidence: [
				{ kind: 'shot', path: 'shots/09-one12-unavailable.png', caption: 'The notice on a one-column frame' },
				{ kind: 'shot', path: 'shots/07-slow12-unavailable.png', caption: 'The notice on a twelve-column frame' },
				{ kind: 'shot', path: 'shots/08-slow12-after-retry.png', caption: 'Same notice after Retry' },
			],
		}),
		fnd(2, {
			severity: 'moderate',
			reproduced: { n: 2, m: 2 },
			title: 'Continue loads off-screen columns, not the visible ones',
			preconditions: [SLOW_PY],
			steps: [
				act('Run `slow80 = make_slow(ncols=80, nrows=1000, delay=0.002)`, then `%view slow80`.'),
				act('Wait about 35 s until "Summaries paused. Continue" appears.'),
				pass('s00 to s13 have sparklines.'),
				act('Scroll the summary panel to the bottom (s62 to s79 visible), click Continue and wait until "Summaries paused." returns (32 s).'),
				fail('the visible columns s62 to s79 get sparklines.', 2, { observed: 'Only s62 has one.', shots: ['shots/23-continue-visible-still-empty.png'] }),
				act('Scroll the summary panel up by about one screen.'),
				fail('Continue spent its budget on the visible columns, not the ones above them.', 2, { observed: 's49 to s61, off-screen when Continue was pressed, got sparklines.', shots: ['shots/22-continue-loaded-offscreen.png'] }),
			],
			observed: 'After Continue, the visible columns stay empty while columns above them load.',
			expected: 'Continue loads the columns on screen first.',
			evidence: [
				{ kind: 'shot', path: 'shots/23-continue-visible-still-empty.png', caption: 'Visible columns still empty' },
				{ kind: 'shot', path: 'shots/22-continue-loaded-offscreen.png', caption: 'Columns above the fold loaded instead' },
			],
		}),
	],
});
const LEDGER = readFileSync(new URL('../fixtures/ledger.md', import.meta.url), 'utf8');
/** TYPED with finding `n`'s step `k` (1-based) replaced. */
const typedStep = (n, k, step) => ({ ...TYPED, findings: TYPED.findings.map(f => (f.n === n ? { ...f, steps: f.steps.map((s, i) => (i === k - 1 ? step : s)) } : f)) });
const typedHtml = (json = TYPED, options = {}) => render(json, { ledger: LEDGER, ...options });
const FENCED = typedStep(1, 1, {
	kind: 'action',
	text: 'In the Python console, make a one-column table:',
	code: '```python\n%run -i slow.py\none12 = make_slow(ncols=1, nrows=1000, delay=0.012)\n```',
});

const STACKED = rep({
	findings: [fnd(1, {
		severity: 'major',
		reproduced: { n: 3, m: 3 },
		title: 'A column never loads',
		steps: [act('Open it.'), act('Wait.'), pass('a notice offers Retry'), act('Click Retry.'), fail('it loads', 1)],
		evidence: [
			{ kind: 'shot', path: 'shots/a.png', step: 3, caption: 'after Retry' },
			{ kind: 'shot', path: 'shots/c.png', step: 5, caption: 'still empty' },
			{ kind: 'shot', path: 'shots/b.png', step: 3, caption: 'the notice again' },
		],
	})],
});

const LOGS_DIR = new URL('../fixtures/logs-run/', import.meta.url);
const LOGS_FIXTURE = JSON.parse(readFileSync(new URL('report.json', LOGS_DIR), 'utf8'));
/** The logs run's report.json, with no Features and the explorer's cost. */
const LOGS_REPORT = {
	...LOGS_FIXTURE,
	findings: LOGS_FIXTURE.findings.map(f => ({ ...f, feature: '', preconditions: [SLOW_PY] })),
	cost: { passes: [{ label: 'explore', model: 'claude-opus-5-5', costUsd: null, turns: 120, durationMs: 1500000 }] },
};
/** LOGS_REPORT with finding `n`'s fields replaced. */
const logsWith = (n, fields) => ({ ...LOGS_REPORT, findings: LOGS_REPORT.findings.map(f => (f.n === n ? { ...f, ...fields } : f)) });
const LOGS_LEDGER = readFileSync(new URL('ledger.md', LOGS_DIR), 'utf8');
const logsRead = p => {
	try { return readFileSync(new URL(p, LOGS_DIR)); } catch { return null; }
};
/** The logs run as published, with its files read for the issue bodies. */
const logsHtml = (json = LOGS_REPORT, options = {}) => render(json, { ledger: LOGS_LEDGER, base: 'https://cdn.example/run1', readFile: logsRead, ...options });

// Known issues: issues the PR fixes and issues that mention it, fetched before the run.
const KI_VERIFICATION = { failed: false, text: 'A second agent.\n\n**1.** Checks out.', linked: [{ issue: 23, severity: 'major' }, { issue: 20, severity: 'minor' }, { issue: 26, severity: 'minor' }] };
const KI_REPORT = {
	header: { title: 'Exploratory test: x', branch: 'b', sha: 'abc1234', result: 'It works.', tested: 'the panel', notExercised: 'the web build' },
	findings: [
		fnd(1, { severity: 'major', reproduced: { n: 3, m: 3 }, title: 'Still jumps', verified: 'confirmed', known: [11, 15102], observed: 'it jumps.', expected: 'it stays.' }),
		fnd(2, { severity: 'minor', reproduced: { n: 2, m: 2 }, title: 'Old bug back', verified: 'disputed', known: [21], observed: 'it is back.', expected: 'it is gone.' }),
		fnd(3, { severity: 'moderate', reproduced: { n: 2, m: 2 }, title: 'Looks known', verified: 'unresolved', known: [25, 20], observed: 'it is slow.', expected: 'it is fast.' }),
	],
	verification: KI_VERIFICATION,
};
/** KI_REPORT with finding `n`'s fields replaced. */
const kiWith = (n, fields) => ({ ...KI_REPORT, findings: KI_REPORT.findings.map(f => (f.n === n ? { ...f, ...fields } : f)) });
const KI_LEDGER = `## S01 - fix one
Status: pass
Result: loads
Issue: #10 fix held
Issue: #26 observed

## S02 - fix two
Status: fail - Finding 1
Result: jumps
Issue: #11 fix did not hold

## S03 - old bug
Status: fail - Finding 2
Result: back
Issue: #21 came back

## S04 - slow
Status: fail - Finding 3
Result: slow
Issue: #25 observed

## S05 - other
Status: pass
Result: fine
Issue: #22 observed
Issue: #23 observed
Issue: #26 observed

## Not run
- N01 - web - Fix for #12 not exercised: desktop only
- N02 - scroll - Already filed as #24
`;
const KI_ISSUES = {
	pr: 100,
	issues: [
		{ number: 10, relation: 'fixes', state: 'open', title: 'held', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 11, relation: 'fixes', state: 'open', title: 'failed', createdAt: '2026-08-20T00:00:00Z', summary: 'x' },
		{ number: 12, relation: 'fixes', state: 'open', title: 'skipped', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 13, relation: 'fixes', state: 'open', title: 'unaccounted <b>"&', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 20, relation: 'linked', state: 'open', title: 'also similar', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 21, relation: 'linked', state: 'closed', title: 'regressed', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 22, relation: 'linked', state: 'open', title: 'Title "<script>&', createdAt: '2026-08-20T00:00:00Z', summary: 'a "<b>" & c' },
		{ number: 23, relation: 'linked', state: 'open', title: 'major one', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 24, relation: 'linked', state: 'open', title: 'not seen', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 25, relation: 'linked', state: 'open', title: 'similar', createdAt: '2026-08-20T00:00:00Z', summary: '' },
		{ number: 26, relation: 'linked', state: 'open', title: 'minor one', createdAt: '2026-08-20T00:00:00Z', summary: '' },
	],
};
const kiHtml = (json = KI_REPORT, options = {}) => render(json, { ledger: KI_LEDGER, knownIssues: KI_ISSUES, base: 'https://cdn.example/run1', ...options });
const NO_FINDINGS = { ...KI_REPORT, findings: [], verification: { failed: false, text: 'A second agent.', linked: KI_VERIFICATION.linked } };
/** KI_LEDGER with every scenario passing and every fix held. */
const passing = ledger => ledger.replace(/Status: fail - Finding \d/g, 'Status: pass').replace('Issue: #11 fix did not hold', 'Issue: #11 fix held').replace(/^Issue: #2[15] .*\n/gm, '');

// ---- Slices of a page ------------------------------------------------------

/** From `start` to the first `end` after it. */
const between = (html, start, end) => {
	const i = html.indexOf(start);
	const j = i === -1 ? -1 : html.indexOf(end, i);
	return j === -1 ? '' : html.slice(i, j);
};
/** The card as rendered, without its prompt block. */
function card(html, n) {
	const start = html.indexOf(`<article id="f${n}"`);
	const end = html.indexOf('</article>', start);
	const prompt = html.indexOf('<script type="text/plain"', start);
	return html.slice(start, prompt !== -1 && prompt < end ? prompt : end);
}
/** The text of finding `n`'s copyable prompt block. */
const promptText = (html, n) => new RegExp(`<script type="text/plain" id="prompt-f${n}">([\\s\\S]*?)</script>`).exec(html)?.[1] ?? null;
const issueBlock = (html, n) => new RegExp(`<script type="text/plain" id="issue-f${n}">([\\s\\S]*?)</script>`).exec(html)?.[1] ?? null;
const issueAnchor = (html, n) => new RegExp(`<a class="gh-btn"[^>]*aria-label="File a GitHub issue for finding ${n} [^"]*">`).exec(html)?.[0];
const unescapeHtml = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const issueUrl = (html, n) => new URL(unescapeHtml(/href="([^"]*)"/.exec(issueAnchor(html, n))[1]));
// What the page's copy handler hands the clipboard.
const issueCopied = (html, n) => issueBlock(html, n).replace(/<\\(?=\/script|!--)/gi, '<');
const tiles = html => between(html, '<section class="tiles">', '</section>');
const coverageOf = html => between(html, 'id="coverage"', '</section>');
const findingsOf = html => between(html, 'id="findings"', '</section>');
const findingRow = (html, n) => new RegExp(`<a href="#f${n}" class="row findings-grid[^"]*">[\\s\\S]*?</a>(?=\\n)`).exec(html)?.[0] ?? '';
const runDetails = html => between(html, '<details id="run-details">', '</details></section>');
const footer = html => between(html, '<footer', '</footer>');
const foldLabels = html => [...runDetails(html).matchAll(/<div class="fold-label">([^<]+)<\/div>/g)].map(m => m[1]).join(', ');
/** Which of the page's optional scripts it ships. */
const scripts = html => Object.entries({
	copy: '.cp-btn,.code-cp', codeCopy: 'code.cc\').forEach', feedback: 'exploratory-feedback', issueList: 'closest(\'.ki-cnt\')', issuePreview: 'a.ki-num[data-title]',
}).filter(([, s]) => html.includes(s)).map(([k]) => k).join(' ') || '(none)';
/** The Evidence row of a finding whose evidence is `items`, or '' when it has none. */
const evidenceRow = items => /<details class="lc ev">[\s\S]*?<\/details>/.exec(card(render(rep({ findings: [fnd(1, { observed: 'it broke.', evidence: items })] })), 1))?.[0] ?? '';

// ---- The model -------------------------------------------------------------

// The saved pages and scenes pin the title, chips and the lead's own emphasis.
test('reportFromJson drops emphasis on the whole lead, the scope\'s count, and chips with no branch', () => {
	// Emphasis on everything emphasises nothing.
	assert.doesNotMatch(model(rep({ header: { result: '**Everything is broken everywhere.**' } })).leadHtml, /<strong>/);
	// Coverage's own table is the count, so the scope does not repeat it.
	assert.equal(model(FULL).scopeHtml, 'The summary panel on two backends.');
	// No branch, so no chips, whatever else is backticked.
	assert.deepEqual(model(rep({ header: { branch: undefined, sha: undefined }, findings: [fnd(1, { observed: '`some/path.ts` misbehaves.' })] })).chips, []);
});

test('reportFromJson keeps a featured shot first in Evidence, once, and a step\'s cited shot before its listed ones', () => {
	const shots = f => f.evidence.filter(e => e.kind === 'shot');
	const full = shots(model(FULL).findings[0]);
	assert.equal(full.filter(e => e.file === '01-stuck.png').length, 1);
	assert.deepEqual([full[0].featured, full[0].caption], [true, 'The spinner, 60 s later']);
	const [f] = model(rep({
		findings: [fnd(1, {
			steps: [act('Run `%view df`.'), fail('it loads', 1, { shots: ['shots/S03-03.png', 'shots/S03-03b.png'] })],
			evidence: [
				{ kind: 'shot', path: 'shots/S03-13.png', step: 2, caption: 'pandas loads the same column' },
				{ kind: 'shot', path: 'shots/S03-03b.png', step: 2, caption: 'still loading 15 s later' },
			],
		})],
	})).findings;
	assert.deepEqual(shots(f).map(e => `${e.file} ${e.caption}`),
		['S03-03.png Verify it loads', 'S03-03b.png Still loading 15 s later', 'S03-13.png pandas loads the same column']);
});

test('a log line the report and the ledger both cite is one error, kept as the copy that says more', () => {
	// The report's copy keeps the line's timestamp; the ledger's names the process and the count.
	const json = rep({ findings: [fnd(1, { steps: [act('Open it.'), fail('it loads', 1, { log: { source: 'logs/1-supervisor.log:515', body: '01:48:02 [INFO] Child exited: signal 9' } })] })] });
	const ledger = '## S01 - x\nStatus: fail - Finding 1\nResult: Fails 1/1\n\nSteps:\n1. Open it.\n2. VERIFY it loads -> FAIL - Finding 1\n   Observed: dead\n   Log: logs/1-supervisor.log:515 | Kernel supervisor | 1x (01:48:02)\n     Child exited: signal 9\n';
	assert.deepEqual(model(json, ledger).findings[0].errors.map(e => [e.source, e.meta]), [['logs/1-supervisor.log:515', ['Kernel supervisor', 'Logged 1x (01:48:02)']]]);
});

test('reportFromJson takes Run details from the header and the verdicts from the findings', () => {
	const r = model(fullWith(2, { verified: 'disputed' }));
	assert.deepEqual(r.runDetails.map(s => s.title), ['Change under test', 'Environment']);
	assert.deepEqual(r.verification.verdicts, [{ n: 1, word: 'confirmed' }, { n: 2, word: 'disputed' }]);
	// The saved pages pin where the ledger's Environment goes; the report's own wins.
	const own = model({ ...TYPED, header: { ...TYPED.header, details: [{ title: 'Change under test', body: 'x' }, { title: 'Environment', body: 'mine' }] } }, LEDGER).runDetails;
	assert.deepEqual(own.filter(s => s.title === 'Environment').map(s => s.html.trim()), ['<p>mine</p>']);
});

// The uv-run page pins the Agents table, and scenes the Run tile with and without a total.
test('reportFromJson reads a cost pass under a minute, or with no model', () => {
	const { passes: [p], total } = model(rep({ cost: { passes: [{ label: 'verify', model: null, costUsd: 0.02, turns: 3, durationMs: 20000 }] } })).cost;
	assert.deepEqual([p.duration, p.model, total], ['<1m', null, '$0.02']);
});

test('derived: a finding\'s status comes from its rate: 0/M is Unproven', () => {
	const [f] = model(TYPED).findings;
	assert.deepEqual([f.confirmed, f.reproduced], ['Confirmed', '3/3']);
	assert.equal(model(rep({ findings: [fnd(1, { reproduced: { n: 0, m: 3 } })] })).findings[0].confirmed, 'Unproven');
	// A check with no result gets no invented one.
	const steps = model(rep({ findings: [fnd(1, { steps: [act('Open it.'), { kind: 'verify', text: 'Check that it loads.' }] })] })).findings[0].steps;
	assert.deepEqual(steps.map(s => [s.kind, s.result]), [['action', null], ['verify', null]]);
});

test('modelDisplayName reads a model id the way the report names it', () => {
	assert.deepEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5[1m]', 'sonnet', 'some-other-model', null].map(modelDisplayName),
		['Opus 5.5', 'Sonnet 5', 'Haiku 4.5', 'Opus 5.5', 'Sonnet', 'some-other-model', null]);
});

test('skillVersion reads SKILL.md\'s frontmatter, never its body, with no v', () => {
	assert.match(skillVersion(), /^\d+\.\d+/);
	assert.equal(skillVersion('---\nname: x\nmetadata:\n  version: "2.3"\n---\n'), '2.3');
	assert.equal(skillVersion('---\nname: x\nmetadata:\n  version: v2.3\n---\n'), '2.3');
	assert.equal(skillVersion('---\nname: x\n---\n\nversion: 9.9\n'), null);
});

// ---- The ledger ------------------------------------------------------------

test('ledger: parses scenarios, preconditions, typed steps and not-run rows', () => {
	const cov = parseLedger(LEDGER);
	assert.deepEqual(cov.exercised.map(r => `${r.id}:${r.status}:${r.finding ?? ''}`),
		['S01:pass:', 'S02:pass:', 'S03:pass:', 'S04:pass:', 'S05:pass:', 'S06:pass:', 'S08:fail:1', 'S09:fail:2']);
	const s03 = cov.exercised[2];
	assert.deepEqual(s03.pre.map(p => p.from), ['S02']);
	assert.match(s03.pre[0].howHtml, /opened with <code>%view edge<\/code>/);
	assert.deepEqual(cov.exercised[7].steps.map(s => s.result ?? 'action'), ['action', 'action', 'pass', 'action', 'fail', 'action', 'fail']);
	assert.deepEqual(cov.exercised[6].steps[2].evidence.map(e => e.href), ['shots/09-one12-unavailable.png', 'shots/07-slow12-unavailable.png']);
	assert.deepEqual(cov.notExercised.map(r => r.id), ['N01', 'N02', 'N05']);
	assert.equal(cov.notExercised[1].reasonHtml, 'Could not make value fetches slow: the slow-hash trick only slows profiling');
	// Environment is whole-run context for Run details, never a Coverage row.
	assert.doesNotMatch(JSON.stringify([cov.exercised, cov.notExercised]), /CDP 44987/);
	assert.match(cov.environment.join('\n'), /CDP 44987/);
});

test('ledger: reads the middle-dot and arrow forms the same as ASCII', () => {
	const cov = parseLedger([
		'## S01 \u00b7 slow column', 'Status: fail \u00b7 Finding 3', 'Result: Fails 3/3', '',
		'Steps:', '1. Run it.', '2. VERIFY The summary loads. \u2192 FAIL \u00b7 Finding 3', '   Observed: Dots.', '',
		'## Not run', '- N01 \u00b7 Positron web \u00b7 Desktop build only',
	].join('\n'));
	assert.equal(cov.exercised[0].finding, 3);
	assert.equal(cov.exercised[0].steps[1].md, 'Verify the summary loads.');
	assert.equal(cov.exercised[0].steps[1].observed, 'Dots.');
	assert.equal(cov.notExercised[0].reasonHtml, 'Desktop build only');
	assert.equal(parseLedger('# Test ledger\n\n## Environment\n- x'), null);
});

test('ledger: a step\'s code block keeps a fenced block pasted inside it whole', () => {
	const block = lines => parseLedger(['## S01 - x', 'Status: pass', 'Result: ok', '', 'Steps:', '1. Add a cell with this source:', ...lines.map(l => `   ${l}`), '2. VERIFY it renders -> PASS', ''].join('\n')).exercised[0].steps[0].blockHtml;
	// Three backticks inside three would otherwise close the block early.
	assert.equal(block(['```', '# Title', '```python', 'x = 1', '```', 'after', '```']), '<pre><code># Title\n```python\nx = 1\n```\nafter\n</code></pre>\n');
	assert.equal(block(['```', '```python', 'x = 1', '```', '```']), '<pre><code>```python\nx = 1\n```\n</code></pre>\n');
	// A tilde fence already holds backticks.
	assert.equal(block(['~~~', '```python', 'x = 1', '```', '~~~']), '<pre><code>```python\nx = 1\n```\n</code></pre>\n');
	assert.equal(block(['```', 'no close']), '<pre><code>no close\n</code></pre>\n');
});

// The logs-run page pins its Logs section and a Log with a stack.
test('ledger: a Log that found nothing is no error', () => {
	assert.equal(parseLedger('## S01 - x\nSteps:\n1. VERIFY y -> FAIL - Finding 1\n   Log: none found in logs/a.log\n').exercised[0].steps[0].error, null);
});

test('issue: parseSystemLine reads the ledger line, and "not recorded" where it says so', () => {
	assert.deepEqual(parseSystemLine('- Positron 2026.10.0 build 12, dev build of ed2487a1a2 (Code - OSS 1.105.0), on Ubuntu 22.04 (Linux x64).'),
		{ positron: '2026.10.0 build 12 (`ed2487a1a2`)', os: 'Ubuntu 22.04 (Linux x64)' });
	assert.deepEqual(parseSystemLine('Positron 2026.9.1 build 3, a release build of 0123abcd99 (Code - OSS 1.104.0), on macOS 15.1 (Darwin arm64)'),
		{ positron: '2026.9.1 build 3 (`0123abcd99`)', os: 'macOS 15.1 (Darwin arm64)' });
	assert.deepEqual(parseSystemLine('- Positron not recorded, on not recorded.'), { positron: 'not recorded', os: 'not recorded' });
	assert.equal(parseSystemLine('- Positron (pre-launched, CDP 44987), workspace /tmp/x.'), null);
});

// ---- What a hostile report cannot do ----------------------------------------
// A report is written by an agent reading a branch's diff, its logs and its UI,
// and the page is published on a domain shared with every other run. Anything a
// hostile branch can get quoted into a report must come out as text.

test('safeUrl keeps http, https, mailto and relative paths, and rejects a scheme that can execute', () => {
	for (const ok of ['https://cdn.example/shots/a.png', 'http://x/a.png', 'mailto:a@b.c', 'shots/a.png', '/shots/a.png']) {
		assert.equal(safeUrl(ok), ok);
	}
	// Browsers ignore control characters inside a scheme; the guard must too.
	for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox', 'java\nscript:alert(1)', '  javascript:alert(1)', '']) {
		assert.equal(safeUrl(bad), null, bad);
	}
});

test('reportFromJson renders raw HTML in a report as text, and strips a link a reader could be made to execute', () => {
	const f = model(rep({
		findings: [fnd(1, {
			observed: 'it broke <img src=x onerror=alert(1)> and <script>alert(2)</script>, see [the log](javascript:alert(1)) and [the shot](https://cdn.example/a.png).',
			expected: 'a `<div>` element, shown as code.',
		})],
	})).findings[0];
	assert.doesNotMatch(f.observedHtml, /<img|<script|javascript:/);
	assert.match(f.observedHtml, /&lt;img src=x onerror=alert\(1\)&gt;.*the log.*<a href="https:\/\/cdn\.example\/a\.png">the shot<\/a>/);
	// A code span still shows its angle brackets, which is why this is escaped at the renderer.
	assert.match(f.expectedHtml, /<code>&lt;div&gt;<\/code>/);
	assert.doesNotMatch(render(rep({ header: { title: 'A <script>alert(1)</script> title' } })), /<title>[^<]*<script>/);
});

test('reportFromJson refuses an evidence shot whose extension hides its scheme', () => {
	const json = rep({
		findings: [fnd(1, {
			evidence: [
				{ kind: 'shot', path: 'javascript:alert(1)//shots/01.png', caption: 'looks like a screenshot' },
				{ kind: 'shot', path: 'https://cdn.example/shots/02.png', caption: 'a real one' },
			],
		})],
	});
	// basename() ends in .png either way, so the extension test alone let it past.
	assert.deepEqual(model(json).findings[0].evidence.filter(e => e.kind === 'shot').map(e => e.src), ['https://cdn.example/shots/02.png']);
	for (const html of [render(json), fullHtml()]) {
		assert.doesNotMatch(html, /javascript:|src="\s*data:/i);
	}
});

test('reportFromJson only links a PR whose repo is a real owner/repo', () => {
	const pr = value => model(rep({ header: { pr: value } })).pr;
	assert.deepEqual(pr({ repo: 'posit-dev/positron', number: 16188 }), { number: 16188, url: 'https://github.com/posit-dev/positron/pull/16188' });
	for (const bad of [{ repo: 'javascript:alert(1)', number: 1 }, { repo: 'evil.com/x/y', number: 1 }, undefined]) {
		assert.equal(pr(bad), undefined);
	}
});

test('renderReportHtml stays self-contained but for Google Fonts', () => {
	const html = fullHtml();
	assert.doesNotMatch(html, /<script[^>]+src=/);
	const sheets = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
	assert.equal(sheets.length, 1);
	assert.match(sheets[0], /^https:\/\/fonts\.googleapis\.com\//);
	// Every family names a system fallback.
	assert.doesNotMatch(html, /--sans: '[^']+';/);
});

test('a prompt or issue mentioning </script> or <!-- cannot end its block, and copies as written', () => {
	const html = render(rep({ findings: [fnd(1, { observed: 'the tag `</script>` and `<!--` ended the block.' })] }));
	assert.doesNotMatch(promptText(html, 1), /<\/script/i);
	assert.doesNotMatch(issueBlock(html, 1), /<\/script|<!--/i);
	// Run the copy handler's own unescape over the block, as the page does.
	const [, pattern, flags, replacement] = /text=el\.textContent\.trim\(\)\.replace\(\/(.+?)\/([a-z]*),'([^']*)'\);/.exec(html);
	assert.match(promptText(html, 1).replace(new RegExp(pattern, flags), replacement), /`<\/script>` and `<!--`/);
	assert.match(issueCopied(html, 1), /`<\/script>` and `<!--`/);
	assert.match(issueUrl(html, 1).searchParams.get('body'), /`<\/script>` and `<!--`/);
});

test('feedback: a local page names the run by its directory, never its path, and a published one never names who ran it', () => {
	const reports = html => [...new Set([...html.matchAll(/entry\.1746253506=([^&"]+)/g)].map(m => decodeURIComponent(m[1])))];
	for (const base of ['/Users/someone/20261001T120000', '/Users/someone/20261001T120000/', '20261001T120000', 'C:\\Users\\someone\\20261001T120000', 'C:\\Users\\someone\\20261001T120000\\']) {
		const html = fullHtml(FULL, { base, skillVersion: '1.2' });
		assert.deepEqual(reports(html), ['local:20261001T120000#f1', 'local:20261001T120000#f2']);
		assert.doesNotMatch([...html.matchAll(/(?:href|data-submit)="(https:\/\/docs\.google\.com[^"]*)"/g)].join(' '), /someone/);
	}
	assert.deepEqual(reports(fullHtml(FULL, { base: '/Users/someone/20261001T120000', author: 'a@posit.co' }))[0], 'local:a@posit.co/20261001T120000#f1');
	assert.doesNotMatch(fullHtml(FULL, { base: 'https://cdn.example/run1', author: 'a@posit.co' }), /a@posit\.co/);
});

// ---- The page's scripts ----------------------------------------------------

test('renderReportHtml emits inline scripts that parse, cut where the HTML parser cuts them', () => {
	for (const html of [fullHtml(FULL, { base: 'https://cdn.example/run1' }), typedHtml(FENCED), kiHtml()]) {
		const srcs = [...html.matchAll(/<script>([\s\S]*?)<\/script[\s/>]/gi)].map(m => m[1]);
		assert.ok(srcs.length >= 2);
		for (const src of srcs) {
			assert.doesNotThrow(() => new Function(src));
		}
	}
});

/** Runs the page script against a stub DOM; returns the toggle, the Share button and what happened. */
function headerDom(html, { secure = true, clipboardFails = false } = {}) {
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('.th-sw'));
	assert.ok(src);
	const attrs = { 'data-theme': 'professional' };
	const root = { getAttribute: k => attrs[k], setAttribute: (k, v) => { attrs[k] = v; } };
	const el = () => {
		const e = { dataset: {}, attrs: {}, classes: new Set(), handlers: {}, textContent: '' };
		e.setAttribute = (k, v) => { e.attrs[k] = v; };
		e.addEventListener = (type, fn) => { e.handlers[type] = fn; };
		e.classList = { add: c => e.classes.add(c), remove: c => e.classes.delete(c), toggle() {} };
		return e;
	};
	const sw = el();
	const share = el();
	const label = el();
	label.textContent = 'Share';
	share.querySelector = () => label;
	const stored = {};
	const copied = [];
	const replaced = [];
	const timers = [];
	let execCopies = 0;
	const document = {
		documentElement: root,
		querySelector: sel => ({ '.th-sw': sw, '.sh-btn': share })[sel] ?? null,
		querySelectorAll: () => [],
		getElementById: () => null,
		addEventListener() {},
		createElement: () => ({ style: {}, setAttribute() {}, select() {}, remove() {} }),
		body: { appendChild: ta => copied.push(ta.value) },
		execCommand: () => { execCopies++; return true; },
	};
	const thenable = ok => ({ then: (done, failed) => (ok ? done() : failed()) });
	const window = { isSecureContext: secure, addEventListener() {}, scrollY: 0 };
	const navigator = { clipboard: { writeText: text => { copied.push(text); return thenable(!clipboardFails); } } };
	const location = { href: 'https://cdn.example/run1/index.html#f2', pathname: '/run1/index.html', search: '' };
	const history = { replaceState: (s, t, url) => replaced.push(url) };
	const localStorage = { setItem: (k, v) => { stored[k] = v; } };
	new Function('document', 'window', 'navigator', 'location', 'history', 'localStorage', 'setTimeout', 'clearTimeout', src)(
		document, window, navigator, location, history, localStorage, fn => timers.push(fn), () => {});
	return { attrs, sw, share, label, stored, copied, replaced, timers, execCopies: () => execCopies };
}

test('header: the toggle switches between light and dark, says which it goes to, and remembers it', () => {
	const h = headerDom(fullHtml());
	assert.equal(h.sw.attrs['aria-label'], 'Switch to dark mode');
	h.sw.handlers.click();
	assert.equal(h.attrs['data-theme'], 'party');
	assert.deepEqual([h.sw.dataset.tip, h.sw.attrs['aria-label']], ['Switch to light mode', 'Switch to light mode']);
	assert.equal(h.stored['exploratory-report-theme'], 'party');
	h.sw.handlers.click();
	assert.equal(h.attrs['data-theme'], 'professional');
	assert.equal(h.sw.dataset.tip, 'Switch to dark mode');
});

test('header: Share copies the report URL with no anchor, clears it from the address bar, and says Copied for a moment', () => {
	const html = fullHtml();
	const h = headerDom(html);
	h.share.handlers.click();
	assert.deepEqual(h.copied, ['https://cdn.example/run1/index.html']);
	assert.deepEqual(h.replaced, ['/run1/index.html']);
	assert.ok(h.share.classes.has('is-copied'));
	assert.equal(h.label.textContent, 'Copied');
	h.timers.pop()();
	assert.ok(!h.share.classes.has('is-copied'));
	assert.equal(h.label.textContent, 'Share');
	// Without the Clipboard API, or when it refuses, a hidden textarea copies it.
	for (const opts of [{ secure: false }, { clipboardFails: true }]) {
		const f = headerDom(html, opts);
		f.share.handlers.click();
		assert.equal(f.execCopies(), 1);
		assert.equal(f.copied.at(-1), 'https://cdn.example/run1/index.html');
		assert.equal(f.label.textContent, 'Copied');
	}
});

test('link: the script copies the page URL with the anchor and updates the address bar in place', () => {
	const src = /<script>(document\.querySelectorAll\('\[data-link-to\]'\)[\s\S]*?)<\/script>/.exec(fullHtml())[1];
	assert.match(src, /location\.href\.split\('#'\)\[0\]\+'#'\+id/);
	assert.match(src, /history\.replaceState\(null,'','#'\+id\)/);
	assert.match(src, /b\.dataset\.tip='Link copied'/);
	assert.match(src, /document\.execCommand\('copy'\)/);
});

test('issue: the link opens a blank bug form titled as the card, with the embedded text as its body', () => {
	const html = logsHtml();
	for (const n of [1, 2]) {
		const title = unescapeHtml(new RegExp(`<article id="f${n}"[\\s\\S]*?<h2 class="card-title">([^<]*)</h2>`).exec(html)[1]);
		const url = issueUrl(html, n);
		assert.equal(`${url.origin}${url.pathname}`, 'https://github.com/posit-dev/positron/issues/new');
		assert.deepEqual([url.searchParams.get('title'), url.searchParams.get('labels'), url.searchParams.get('template')], [title, 'ai-discovered', null]);
		assert.equal(url.searchParams.get('body'), issueCopied(html, n));
		assert.ok(url.href.length <= 8000);
	}
});

test('issue: a body too long for the link drops the file text, then falls back to copying', () => {
	const big = p => p.endsWith('slow.py') ? Buffer.from(`x = 1\n`.repeat(2000)) : logsRead(p);
	const dropped = logsHtml(LOGS_REPORT, { readFile: big });
	const url = issueUrl(dropped, 1);
	assert.ok(url.href.length <= 8000);
	assert.match(url.searchParams.get('body'), /^`slow\.py` is in the report's `files\/` folder\.$/m);
	assert.doesNotMatch(url.searchParams.get('body'), /<summary>slow\.py/);
	assert.doesNotMatch(dropped, /data-issue=/);

	const html = logsHtml(logsWith(1, { observed: `${'very long. '.repeat(900)}${LOGS_REPORT.findings[0].observed}` }));
	const fallback = issueUrl(html, 1);
	assert.deepEqual([fallback.searchParams.get('body'), fallback.searchParams.get('labels')], [null, 'ai-discovered']);
	assert.match(issueAnchor(html, 1), / data-issue="issue-f1"/);
	// The copy holds everything, file text included.
	assert.match(issueCopied(html, 1), /<summary>slow\.py<\/summary>/);

	// Run the page's handler against a stub DOM: a click copies the text and shows the toast.
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('gh-toast'));
	assert.ok(src);
	assert.ok(!logsHtml().includes('gh-toast\''));
	const el = () => ({ classList: { add(c) { this.on = c; }, remove() { this.on = null; } }, setAttribute() {}, appendChild() {}, querySelector: () => ({}) });
	const toast = el();
	let handler, copied;
	const link = { dataset: { issue: 'issue-f1' }, addEventListener: (_, fn) => { handler = fn; } };
	const document = {
		createElement: () => toast, body: { appendChild() {} },
		querySelectorAll: () => [link],
		getElementById: id => id === 'issue-f1' ? { textContent: unescapeHtml(issueBlock(html, 1)) } : null,
	};
	const navigator = { clipboard: { writeText: t => { copied = t; return { then: ok => ok() }; } } };
	new Function('document', 'navigator', 'window', 'setTimeout', 'clearTimeout', src)(document, navigator, { isSecureContext: true }, () => 0, () => {});
	handler();
	assert.equal(copied, issueCopied(html, 1));
	assert.equal(toast.classList.on, 'show');
	assert.match(src, /Description copied\. Paste it into the issue on GitHub\./);
});

test('issue: a body too long for the link drops sections least needed first, and keeps the repro', () => {
	const html = logsHtml(logsWith(1, { cause: 'long hypothesis. '.repeat(400) }));
	const url = issueUrl(html, 1);
	const issue = url.searchParams.get('body');
	assert.ok(url.href.length <= 8000);
	assert.doesNotMatch(issueAnchor(html, 1), /data-issue=/);
	// Dropped in order up to the cause: files, the test gap, the cause.
	assert.doesNotMatch(issue, /Likely cause|Test gap|<summary>slow\.py/);
	// Not reached: the repro and the error output stay.
	assert.match(issue, /## Steps to reproduce/);
	assert.match(issue, /## Observed\nThe summary never loads/);
	assert.doesNotMatch(issue, /## Error messages\n(?:In the|None recorded)/);
});

const FINDING_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLSc98gL34VYnh7oZAJ1MVj0HRvFUV9YI4xc8nFvMtWiqrsxiiw/viewform';

test('feedback: each verdict carries the form\'s exact answers, and a one-click submit address with the same ones', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1/', skillVersion: '1.2' });
	const titles = model(FULL).findings.map(f => f.title);
	const verdicts = ['Real issue', 'Not a bug', 'Enhancement idea', 'Real, but not worth reporting', 'Couldn\'t tell from the report'];
	const links = [...html.matchAll(/<a href="([^"]+)" data-submit="([^"]+)" data-verdict="([^"]+)"/g)];
	const entries = ['entry.1746253506', 'entry.1873070470', 'entry.890833928', 'entry.427792690'];
	const answers = links.map(([, href, submit]) => {
		const form = new URL(href.replace(/&amp;/g, '&'));
		const one = new URL(submit.replace(/&amp;/g, '&'));
		assert.equal(`${form.origin}${form.pathname}`, FINDING_FORM);
		// The address that worked when tried by hand: no usp, and a Submit.
		assert.equal(`${one.origin}${one.pathname}`, FINDING_FORM.replace(/viewform$/, 'formResponse'));
		assert.deepEqual([one.searchParams.get('submit'), one.searchParams.has('usp')], ['Submit', false]);
		assert.deepEqual(entries.map(e => one.searchParams.get(e)), entries.map(e => form.searchParams.get(e)));
		return entries.map(e => form.searchParams.get(e));
	});
	assert.deepEqual(answers, [1, 2].flatMap(n => verdicts.map(v => [`https://cdn.example/run1/index.html#f${n}`, 'v1.2', `Finding ${n} \u00b7 ${titles[n - 1]}`, v])));
	// A missing skill version is sent as unknown, never blank.
	assert.ok([...fullHtml(FULL, { base: 'https://cdn.example/run1' }).matchAll(/entry\.1873070470=([^&"]+)/g)].every(m => m[1] === 'unknown'));
});

/** Runs the page's feedback script against a stub window; returns a click dispatcher and the window.open calls. */
function feedbackPopup(html, { blocked = false } = {}) {
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('exploratory-feedback'));
	assert.ok(src);
	const opens = [];
	let handler;
	const popup = { closed: false, location: { href: '' }, focused: 0, focus() { this.focused++; } };
	const window = {
		screenX: 100, screenY: 50, outerWidth: 1400, outerHeight: 1000,
		open: (url, name, features) => { opens.push({ url, name, features }); return blocked || name === '_blank' ? null : popup; },
	};
	const document = { querySelectorAll: () => [], addEventListener: (type, fn) => { assert.equal(type, 'click'); handler = fn; } };
	new Function('document', 'window', 'screen', 'localStorage', 'setTimeout', src)(document, window, { availWidth: 1440, availHeight: 900 }, null, () => {});
	const click = (href, mods = {}) => {
		const a = { href, dataset: {} };
		const e = { button: 0, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, target: { closest: sel => sel === '.fb a' ? a : null }, ...mods };
		handler(e);
		return e.defaultPrevented;
	};
	return { click, opens, popup };
}

test('feedback: a plain click opens the form in one reused pop-up over the report', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	// The links still work with script off.
	assert.ok([...html.matchAll(/<a href="https:\/\/docs\.google\.com[^>]*>/g)].every(m => / target="_blank" rel="noopener"/.test(m[0])));
	const { click, opens, popup } = feedbackPopup(html);
	assert.equal(click('https://forms.example/finding'), true);
	// 680 x 820, which fits the 1440 x 900 screen; centred across, a third of the way down.
	assert.deepEqual(opens, [{ url: '', name: 'exploratory-feedback', features: 'popup,width=680,height=820,left=460,top=110' }]);
	assert.equal(popup.location.href, 'https://forms.example/finding');
	assert.equal(click('https://forms.example/report'), true);
	assert.equal(opens.length, 1);
	assert.equal(popup.location.href, 'https://forms.example/report');
	assert.equal(popup.focused, 2);
	// Once it is closed, the next click opens a new one.
	popup.closed = true;
	click('https://forms.example/finding');
	assert.equal(opens.length, 2);
});

test('feedback: a modified or middle click keeps the link\'s own behaviour, and a blocked pop-up falls back to a tab', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const { click, opens } = feedbackPopup(html);
	for (const mods of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
		assert.equal(click('https://forms.example/finding', mods), false, JSON.stringify(mods));
	}
	assert.equal(opens.length, 0);
	const blocked = feedbackPopup(html, { blocked: true });
	assert.equal(blocked.click('https://forms.example/finding'), true);
	assert.deepEqual(blocked.opens.map(o => [o.url, o.name, o.features]).at(-1), ['https://forms.example/finding', '_blank', 'noopener']);
});

/** A fake DOM, just enough for the feedback script: a page of rows built from the rendered HTML. */
function feedbackDom(html, storage) {
	const matches = (el, sel) => sel.split(', ').some(one => {
		if (one === '.fb a') {
			return el.tag === 'a' && !!el.parent?.closest('.fb');
		}
		const [, tag, cls, data] = /^(a|button|span|div)?(?:\.([\w-]+))?(?:\[data-([\w-]+)\])?$/.exec(one) ?? [];
		return (!tag || el.tag === tag) && (!cls || el.classList.includes(cls)) && (!data || data in el.dataset);
	});
	class El {
		constructor(tag, parent) { this.tag = tag; this.parent = parent; this.children = []; this.dataset = {}; this.attrs = {}; this.className = ''; this.textContent = ''; this.hidden = false; }
		get classList() { return this.className.split(/\s+/); }
		// Only the empty span the answer pill's label goes in becomes an element.
		set innerHTML(v) { this.html = v; if (v.includes('<span></span>')) { this.appendChild(new El('span', this)); } }
		setAttribute(k, v) { this.attrs[k] = v; if (k.startsWith('data-')) { this.dataset[k.slice(5)] = v; } }
		appendChild(c) { c.parent = this; this.children.push(c); return c; }
		remove() { this.parent.children = this.parent.children.filter(c => c !== this); }
		focus() { page.focused = this; }
		all() { return this.children.flatMap(c => [c, ...c.all()]); }
		querySelectorAll(sel) { return this.all().filter(e => matches(e, sel)); }
		querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
		closest(sel) { for (let e = this; e && e.tag; e = e.parent) { if (matches(e, sel)) { return e; } } return null; }
		get text() { return this.textContent + this.children.map(c => c.text).join(''); }
		get label() { return this.children.filter(c => !c.hidden).map(c => c.text).join('|'); }
	}
	const page = new El('body', null);
	for (const [, attrs, inner] of html.matchAll(/<div class="fb" ([^>]*)>(.*?)<\/div>/g)) {
		const row = page.appendChild(new El('div', page));
		row.className = 'fb';
		for (const [, k, v] of attrs.matchAll(/(data-[\w-]+)="([^"]*)"/g)) { row.setAttribute(k, v); }
		const q = row.appendChild(new El('span', row)); q.className = 'fb-q'; q.textContent = 'Is this finding right?';
		for (const [, href, submit, verdict, label] of inner.matchAll(/<a href="([^"]+)" data-submit="([^"]+)" data-verdict="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
			const a = row.appendChild(new El('a', row));
			a.href = href.replace(/&amp;/g, '&');
			a.setAttribute('data-submit', submit.replace(/&amp;/g, '&'));
			a.setAttribute('data-verdict', verdict.replace(/&#39;/g, '\''));
			a.textContent = label.replace('&rsquo;', '\u2019');
		}
	}
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes('exploratory-feedback'));
	const opens = [];
	let handler;
	const popup = { closed: false, location: {}, focus() {} };
	Object.defineProperty(popup.location, 'href', { set(v) { opens.push(v); } });
	const frames = new El('body', null);
	const timers = [];
	const document = {
		body: frames,
		querySelectorAll: sel => page.querySelectorAll(sel),
		createElement: tag => new El(tag, null),
		createTextNode: text => Object.assign(new El('#text', null), { textContent: text }),
		addEventListener: (_, fn) => { handler = fn; },
	};
	new Function('document', 'window', 'screen', 'localStorage', 'setTimeout', src)(document, { open: () => popup }, {}, storage, fn => timers.push(fn));
	const rows = page.children;
	// The hidden frames a verdict click loads, which record it with no window.
	const sends = () => frames.children.map(f => f.src);
	const click = (el, mods = {}) => {
		const e = { button: 0, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...mods };
		handler(e);
		return e.defaultPrevented;
	};
	const verdict = (row, name) => row.children.find(c => c.dataset.verdict === name);
	return { page, rows, click, opens, sends, frames, timers, verdict };
}

function memoryStorage() {
	const map = new Map();
	return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: k => map.delete(k) };
}

test('feedback: a verdict click records it in one click and shows the answer, remembered on reload', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const storage = memoryStorage();
	const { rows, click, opens, sends, frames, timers, verdict, page } = feedbackDom(html, storage);
	const pick = verdict(rows[1], 'Not a bug');
	assert.equal(click(pick), true);
	// No window: the verdict goes in a hidden frame, which is removed later.
	assert.deepEqual(opens, []);
	assert.deepEqual(sends(), [pick.dataset.submit]);
	const [frame] = frames.children;
	assert.deepEqual([frame.tag, frame.hidden], ['iframe', true]);
	timers.forEach(fn => fn());
	assert.deepEqual(sends(), []);
	assert.equal(rows[1].label, 'Is this finding right?|Not a bug|Add a note');
	const pill = rows[1].querySelector('.fb-done');
	assert.equal(pill.tag, 'button');
	assert.equal(pill.attrs['aria-label'], 'Your answer: Not a bug. Change answer');
	assert.equal(pill.dataset.tip, 'Change answer');
	assert.equal(rows[0].label.split('|').length, 6, 'the other finding is untouched');
	assert.deepEqual([...storage.map].filter(([k]) => k !== 'fb:id'), [['fb:https://cdn.example/run1/index.html#f2', 'Not a bug']]);
	const note = rows[1].querySelector('.fb-note');
	assert.equal(page.focused, note);
	// Add a note opens the pre-filled form, and records nothing more.
	assert.equal(note.href, pick.href);
	click(note);
	assert.deepEqual(opens, [pick.href]);

	// A reload shows the answer again, without submitting.
	const again = feedbackDom(html, storage);
	assert.equal(again.rows[1].label, 'Is this finding right?|Not a bug|Add a note');
	assert.deepEqual([again.opens, again.sends()], [[], []]);
	// Clicking the answer forgets it and brings the buttons back, sending nothing.
	again.click(again.rows[1].querySelector('.fb-done'));
	assert.equal(again.rows[1].label, 'Is this finding right?|Real issue|Not a bug|Enhancement|Not worth reporting|Couldn\u2019t tell');
	assert.deepEqual([...storage.map.keys()], ['fb:id']);
	assert.equal(again.page.focused, again.verdict(again.rows[1], 'Real issue'));
	assert.deepEqual(again.sends(), []);
	// Picking again sends the new verdict.
	const other = again.verdict(again.rows[1], 'Real issue');
	again.click(other);
	assert.deepEqual(again.sends(), [other.dataset.submit]);
});

test('feedback: a modified click opens the form without recording, and blocked storage only loses the memory', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const storage = memoryStorage();
	const { rows, click, opens, sends, verdict } = feedbackDom(html, storage);
	assert.equal(click(verdict(rows[0], 'Real issue'), { metaKey: true }), false);
	assert.deepEqual([opens, sends(), [...storage.map.keys()]], [[], [], ['fb:id']]);
	assert.equal(rows[0].label.split('|').length, 6);

	const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
	const blocked = feedbackDom(html, throwing);
	blocked.click(blocked.verdict(blocked.rows[0], 'Real issue'));
	assert.equal(blocked.sends().length, 1);
	assert.equal(blocked.rows[0].label, 'Is this finding right?|Real issue|Add a note');

	// A stored value that is not one of the page's verdicts is dropped, never shown.
	const planted = memoryStorage();
	planted.setItem('fb:https://cdn.example/run1/index.html#f1', '<img src=x onerror=alert(1)>');
	const p = feedbackDom(html, planted);
	assert.equal(p.rows[0].label.split('|').length, 6);
	assert.deepEqual([...planted.map.keys()], ['fb:id']);
});

test('feedback: every finding answer from a browser carries the same random ID, kept across reloads', () => {
	const html = fullHtml(FULL, { base: 'https://cdn.example/run1', skillVersion: '1.2' });
	const ids = links => links.flatMap(a => [a.href, a.dataset.submit]).map(u => new URL(u).searchParams.getAll('entry.1280428395'));
	const storage = memoryStorage();
	const first = feedbackDom(html, storage);
	const links = first.rows.flatMap(r => r.querySelectorAll('a[data-verdict]'));
	const [[id]] = ids(links);
	assert.match(id, /^[0-9a-f]{12}$/);
	assert.ok(ids(links).every(v => v.length === 1 && v[0] === id), 'once per link, the same everywhere');
	assert.equal(storage.getItem('fb:id'), id);
	const again = feedbackDom(html, storage);
	assert.ok(ids(again.rows.flatMap(r => r.querySelectorAll('a[data-verdict]'))).every(v => v[0] === id));
	// A different browser gets its own.
	assert.notEqual(ids(feedbackDom(html, memoryStorage()).rows[0].querySelectorAll('a[data-verdict]'))[0][0], id);
	// A stored value that is not an ID is replaced.
	const planted = memoryStorage();
	planted.setItem('fb:id', '&entry.427792690=Not%20a%20bug');
	const p = feedbackDom(html, planted);
	assert.match(planted.getItem('fb:id'), /^[0-9a-f]{12}$/);
	assert.ok(ids(p.rows[0].querySelectorAll('a[data-verdict]')).every(v => v[0] === planted.getItem('fb:id')));
});

// ---- render.mjs ------------------------------------------------------------

test('render.mjs fails the run when a listed log was not copied, and still writes the page', () => {
	withLogsRun(({ dir, report, render }) => {
		assert.equal(render(report).status, 0);
		rmSync(join(dir, 'logs', 'python-console.log'));
		const failed = render(report);
		assert.equal(failed.status, 1);
		assert.match(failed.stderr, /logs\/python-console\.log/);
		assert.ok(existsSync(join(dir, 'index.html')));
	});
});

test('logs: every log the page links was copied beside it, and nothing links outside the run', () => {
	const html = logsHtml(LOGS_REPORT, { base: '/runs/r2' });
	const hrefs = [...html.matchAll(/href="(logs\/[^"]*)"/g)].map(m => m[1]);
	assert.ok(hrefs.length > 0);
	for (const href of hrefs) {
		assert.ok(existsSync(new URL(href, LOGS_DIR)), `${href} exists`);
	}
	assert.doesNotMatch(html, /href="(\/(?!#)|~|\/tmp)/);
});

// ---- Scenes ----------------------------------------------------------------
// Each renders one case; its name says what the page should do there. The
// saved pages pin the CSS and the scripts, so scenes show markup and text.

const issueTitle = (claim, observed) => issueUrl(logsHtml(logsWith(1, { title: claim, feature: 'console', ...(observed ? { observed } : {}) })), 1).searchParams.get('title');
const preconditions = text => card(render(rep({ findings: [fnd(1, { preconditions: [{ name: 'defaults', text }], steps: [act('Do the thing.')] })] })), 1);
const passed = n => [`S${String(n).padStart(2, '0')}`, `pass ${n}`, 'pass', 'fine'];
const LONG_LEDGER = ledgerOf([
	...[1, 2, 3, 4, 5].map(passed), ['S20', 'second hit', 'fail - Finding 2', 'broke'], ...[6, 7, 8].map(passed),
	['S21', 'first hit', 'fail - Finding 1', 'broke'], ...[9, 10].map(passed),
	...Array.from({ length: 12 }, (_, i) => [`N${String(i + 1).padStart(2, '0')}`, `skip ${i}`, 'later']),
]);
const KNOWN = fullWith(1, { known: [15102, 14991] });
const ORIGINS = {
	...FULL,
	findings: [...FULL.findings, fnd(3, { title: 'a flaky claim', verified: 'confirmed', reproduced: { n: 2, m: 3 } }), fnd(4, { title: 'a disputed claim', verified: 'disputed' })],
	verification: { ...FULL.verification, origin: { 1: 'introduced', 2: 'exposed', 4: 'inherited' } },
};
const USABLE = { usable: true, name: 'release/2026.10' };
const ISSUE_REFS = [
	{ number: 2330, kind: 'issue', state: 'open', title: 'Zoom spec', createdAt: '2026-08-20T00:00:00Z', summary: 'sizes' },
	{ number: 8126, kind: 'pr', state: 'merged', title: 'Zoom plots', createdAt: '2026-08-20T00:00:00Z', summary: '' },
	{ number: 3698, kind: 'issue', state: 'open', title: 'Blurry labels', createdAt: '2026-08-20T00:00:00Z', summary: '' },
];

const SCENES = {
	// Whole pages, each showing most of the layout once.
	'a card with every collapsed row, step-tagged shots, errors with frames, and a test gap': () => card(richHtml(RICH, { base: '/runs/r1' }), 1),
	'typed steps: verify steps carry PASS or FAIL, a PR run links its PR, and Coverage comes from the ledger': () => {
		const html = typedHtml();
		return [between(html, '<header class="head">', '</header>'), card(html, 1), coverageOf(html)].join('\n--\n');
	},
	'a step\'s shots are one lightbox group behind its icon': () => card(render(STACKED), 1),
	'known issues: Linked issues row, fixes that did not hold, regressions and dupes': () => {
		const html = kiHtml();
		return [1, 2, 3].map(n => card(html, n)).concat(between(html, 'id="findings"', '<article'), coverageOf(html)).join('\n--\n');
	},

	// The header, tiles and footer.
	'a report with no title gets the kicker alone': () => between(render(rep({ header: { title: undefined } })), '<h1', '</h1>'),
	'with no Run details, the Run tile is not a link': () => tiles(render(rep({ findings: FULL.findings }), { ledger: FULL_LEDGER })),
	'a report with only its cost still gets a Run details fold': () => tiles(render(rep({ cost: { passes: [{ label: 'explore', model: null, costUsd: 1, turns: 5, maxTurns: 200, durationMs: 120000 }] } }))),
	'the Run tile sizes stages by time when a pass has no cost': () => tiles(render(rep({ cost: { passes: [{ label: 'explore', model: 'opus', costUsd: null, turns: 69, durationMs: 660000 }, { label: 'verify', model: 'sonnet', costUsd: 0.19, turns: 9, durationMs: 20000 }] } }))),
	'the copyright is dated by the run, and the version shows with a v when known': () => [footer(fullHtml(FULL, { startedAt: new Date(2031, 0, 5) })), footer(fullHtml(FULL, { skillVersion: '1.2' }))].join('\n'),
	'chat apps get a preview: the title alone, no description without a branch, an image only when written': () => [
		render(rep({ header: { title: 'Exploratory test: a "quoted" title', branch: undefined, sha: undefined } })),
		fullHtml(FULL, { ogImage: 'https://cdn.example/run/og.png' }),
		render(rep(), { ogImage: 'https://cdn.example/og.png' }),
		render(rep({ findings: [fnd(1)] }), { ogImage: 'https://cdn.example/og.png' }),
	].map(html => (html.match(/<meta (?:property|name)="(?:og:|description)[^>]*>/g) ?? []).join('\n')).join('\n--\n'),

	// Findings.
	'no findings and no issues: an empty state and no column header': () => findingsOf(render(rep(), { ledger: ledgerOf([['S01', 'pandas frame', 'pass', 'everything loads']]) })),
	'a "defaults" precondition is dropped, and a qualified one kept': () => [preconditions('Shipped defaults.'), preconditions('Shipped defaults. Slowness is manufactured with a slow hash.')].join('\n--\n'),
	'each precondition by its text, with a pasted file kept as a block': () => card(render(rep({
		findings: [fnd(1, {
			preconditions: [
				{ name: 'notebook on', text: '`positron.notebook.enabled: true` in `.vscode/settings.json`' },
				{ name: '`nb.ipynb`', text: '`nb.ipynb` in the workspace\n```python\nimport cv2\n```' },
				{ name: 'venv', text: 'A Python 3.10.15 venv with ipykernel' },
			],
			steps: [{ kind: 'action', text: 'Add a markdown cell with this source:', code: '```\n<div class="alert">\n\n**Tip:** text\n\n</div>\n```' }, act('Open `nb.ipynb`.')],
		})],
	})), 1),
	'a prompt leaves empty sections out, and Context names only what the header carries': () => promptText(render(rep({ findings: [fnd(1, { observed: 'it broke.' })] })), 1),
	'with agent prompts off: no prompt button or block, and issue and link buttons stay': () => `${card(fullHtml(FULL, { agentPrompts: false }), 1)}\nscripts: ${scripts(fullHtml(FULL, { agentPrompts: false }))}`,
	'the verifier\'s verdict wins on card, row and prompt; a disputed finding hides its test gap': () => {
		const html = richHtml(richWith(1, { verified: 'disputed' }));
		return [card(html, 1), findingRow(html, 1), promptText(html, 1)].join('\n--\n');
	},
	'an unresolved finding caveats its test gap': () => {
		const html = richHtml(richWith(1, { verified: 'unresolved' }));
		return [between(card(html, 1), '<details class="lc regtest">', '</summary>'), promptText(html, 1)].join('\n--\n');
	},
	'a finding the verifier matched to an issue says Dupe? on its card, row and prompt': () => [card(fullHtml(KNOWN), 1), findingRow(fullHtml(KNOWN), 1), promptText(fullHtml(KNOWN), 1)].join('\n--\n'),
	'a finding matched to a not-planned issue says Won\'t fix? on its card and row': () => {
		const html = fullHtml(fullWith(2, { intended: [14210] }));
		return [card(html, 2), findingRow(html, 2), promptText(html, 2)].join('\n--\n');
	},
	'a cause the verifier revised says so on the card, prompt and issue, and a revised observed does not': () => {
		const html = render(rep({ findings: [fnd(1, { verified: 'confirmed', observed: 'The tab shows `Pytho...`.', cause: 'A width gate skips the dot.', corrected: ['cause', 'observed'], explorer: { cause: 'The CSS squeezes the dot.', observed: 'The tab shows its full name.' } })] }));
		return [card(html, 1), promptText(html, 1), issueCopied(html, 1)].join('\n--\n');
	},
	'a missing case with no file keeps its level and says new file': () => {
		const html = render(rep({ findings: [fnd(1, { observed: 'it broke.', tests: { cases: [{ text: 'A checked box reads as checked.', level: 'unit', path: '', isNew: true }], related: [] } })] }));
		return [card(html, 1), promptText(html, 1)].join('\n--\n');
	},
	'a regression case naming a folder shows the folder': () => between(card(richHtml(richWith(1, { tests: { ...RICH.findings[0].tests, cases: [RICH.findings[0].tests.cases[0], { ...RICH.findings[0].tests.cases[1], path: 'test/e2e/tests/data-explorer/' }] } })), 1), '<ol class="rt-cases">', '</ol>'),
	'a card with nothing to collapse has no collapsed rows': () => card(render(rep({ findings: [fnd(1, { observed: 'it broke.' })] })), 1),
	'a Python traceback shows as frames, linking only the repo\'s files': () => card(render(rep({
		findings: [fnd(1, {
			errors: [{
				source: 'logs/python-kernel.log:23', process: 'Python kernel', count: 4, message: '[positron.data_explorer] ERROR | invalid series dtype',
				frames: [
					{ fn: '_polars_summarize_string', path: 'extensions/positron-python/python_files/posit/positron/data_explorer.py', line: 2139 },
					{ fn: 'wrapper', path: '.venv/lib/python3.14/site-packages/polars/series/utils.py', line: 104 },
				],
			}],
		})],
	})), 1),
	'an error fence in the prompt is longer than any ``` inside it': () => promptText(render(rep({ findings: [fnd(1, { observed: 'x', errors: [{ source: 'logs/a.log', process: 'Renderer', message: 'Error: bad template\n```\ntail' }] })] })), 1),
	'Evidence rows: a log header over the line, a bare log, several lines, a line not logged; notes and the agent\'s files stay out': () => [
		[{ kind: 'log', path: 'logs/36561-python-language-pack.log:1489', process: 'Extension host', when: '00:18:39', quote: '2026-10-06 00:18:39.958 [debug] env change ==/tmp/w/.venv/bin/python== remove' }],
		[{ kind: 'log', path: 'logs/44987-exthost.log', quote: '2026-10-06 00:18:39.958 [info] started' }],
		[{ kind: 'log', path: 'logs/1-renderer.log:10', when: '00:00:01', quote: 'first line\n  second "line"' }],
		[{ kind: 'log', path: 'logs/1-exthost.log:5', process: 'Extension host', when: '00:18:39', quote: 'env change /x remove' }, { kind: 'missing', path: 'logs/1-exthost.log', window: '00:18:39-00:19:24', quote: 'env change /x add' }],
		[{ kind: 'note', caption: 'so nothing resolved the new path' }, { kind: 'log', path: 'actions.log:12', quote: '2026-10-06T00:18:39Z click failed' }, { kind: 'log', path: 'logs/S03-later.txt', quote: 'saved' }],
	].map(evidenceRow).join('\n--\n'),
	'Observed stays off the steps when the card says it once': () => card(typedHtml(typedStep(2, 5, act('Look at the visible columns.'))), 2),
	'a step with two shots shows the icon with a count': () => card(render(rep({
		findings: [fnd(1, {
			steps: [act('Open it.'), fail('it loads.', 1)],
			evidence: [{ kind: 'shot', path: 'https://cdn.example/shots/a.png', step: 2, caption: 'first' }, { kind: 'shot', path: 'https://cdn.example/shots/b.png', step: 2, caption: 'second' }],
		})],
	})), 1),
	'a step shot previews its crop at its own size, and the whole window, fitted, when it has none': () => {
		const png = (w, h) => { const b = Buffer.alloc(24); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
		const files = { 'shots/S01-01.png': png(1530, 1080), 'shots/S01-01.crop.png': png(640, 320), 'shots/S01-03.png': png(1530, 1080) };
		const html = render(rep({
			findings: [fnd(1, { steps: [pass('the panel opens', { shots: ['shots/S01-01.png'] }), act('Click Retry.'), fail('it loads', 1, { observed: 'empty', shots: ['shots/S01-03.png'] })] })],
		}), { readFile: p => files[p] ?? null });
		return [...card(html, 1).matchAll(/<span class="ev-pop"[\s\S]*?<\/span><\/span>/g)].map(m => m[0]).join('\n--\n');
	},
	'a shot a step cites reaches its step with no Evidence item, and a check with no result gets none':() => card(render(rep({
		findings: [fnd(1, {
			steps: [pass('the panel opens', { shots: ['shots/S01-01.png'] }), act('Click Retry.'), fail('it loads', 1, { observed: 'empty', shots: ['shots/S01-03.png'] }), { kind: 'verify', text: 'confirm the dialog closes' }],
			evidence: [{ kind: 'shot', path: 'shots/S01-03.png', step: 3, caption: 'empty panel' }],
		})],
	})), 1),
	'a fenced step block gets its own copy button, with prompts on or off': () => `${card(typedHtml(FENCED), 1)}\nscripts: ${scripts(typedHtml(FENCED))}; prompts off: ${scripts(typedHtml(FENCED, { agentPrompts: false }))}; no block, prompts off: ${scripts(typedHtml(TYPED, { agentPrompts: false }))}`,
	'inline code in Reproduce copies on click; Observed and code blocks do not': () => {
		const html = render(rep({
			findings: [fnd(1, {
				preconditions: [{ name: 'console', text: 'a Python console.' }, SLOW_PY],
				steps: [{ kind: 'action', text: 'Run `%view df`.', code: '```python\ndf.head()\n```' }, fail('the grid shows `df`.', 1)],
				observed: 'the grid showed `None`.',
			})],
		}));
		return `${card(html, 1)}\nscripts: ${scripts(html)}; with no inline code: ${scripts(render(rep()))}`;
	},
	'a lone ~ means about, and only ~~ strikes through, on the card and in the issue': () => {
		const html = fullHtml(fullWith(1, { cause: '`run()` (~L12-40) calls `wait()` (~L80), and `y ~ x` is ~~not~~ fine.' }));
		return [between(card(html, 1), '<details class="lc hyp">', '</details>'), issueCopied(html, 1)].join('\n--\n');
	},
	'an issue or PR named in a card, the lead or the verifier notes gets a preview link; with no preview it stays text': () => {
		const json = { ...fullWith(1, { expected: 'it should have stopped, as #2330 says, since #8126.' }), verification: { failed: false, text: 'A second agent.\n\nSearches returned only #3698 (open).' } };
		return [between(card(fullHtml(json, { issueRefs: ISSUE_REFS }), 1), '<div class="f-cmp', '</div></div>'), between(fullHtml(json, { issueRefs: ISSUE_REFS }), 'Searches returned', '</p>'), between(card(fullHtml(json), 1), '<div class="f-cmp', '</div></div>')].join('\n--\n');
	},
	'the Origin column on a run with a usable base: a word per judged finding, a dash for one left out or not confirmed, Flaky on a partial repro, the last tooltip opening upward': () => findingsOf(fullHtml(ORIGINS, { changeBase: USABLE })),
	'no Origin column without a usable base, or with no base recorded': () => [
		between(findingsOf(fullHtml(ORIGINS, { changeBase: { usable: false, name: 'main' } })), '<div class="row row-head', '</div>'),
		findingRow(fullHtml(ORIGINS, { changeBase: { usable: false, name: 'main' } }), 1),
		findingRow(fullHtml(ORIGINS), 3),
	].join('\n--\n'),
	'a card shows its Origin word after the severity pill, focusable with its tooltip; a card with none shows nothing': () => {
		const identity = (html, n) => between(card(html, n), '<span class="group identity">', '<span class="rule"');
		const html = fullHtml(ORIGINS, { changeBase: USABLE });
		return [identity(html, 1), identity(html, 3), identity(html, 4), identity(fullHtml(ORIGINS), 1)].join('\n--\n');
	},
	'a PR run\'s Origin says PR, and a base with no name says the base branch': () => {
		const html = fullHtml({ ...ORIGINS, header: { ...ORIGINS.header, pr: { repo: 'posit-dev/positron', number: 1234 } } }, { changeBase: { usable: true, name: null } });
		return [between(findingsOf(html), '<div class="row row-head', '</div>'), findingRow(html, 1)].join('\n--\n');
	},
	'a fix that did not hold gets a dash, even with an origin': () => findingRow(render({ ...kiWith(1, { verified: 'confirmed' }), verification: { failed: false, text: 'x', origin: { 1: 'introduced' } } }, { ledger: KI_LEDGER, knownIssues: KI_ISSUES, changeBase: USABLE }), 1),

	// Coverage.
	'issues, then passes, then not run; passes past the first 4 collapse behind Show all': () => coverageOf(render(rep(), { ledger: LONG_LEDGER })),
	'one passing scenario: no empty filter tabs, and a line saying everything was exercised': () => `${coverageOf(render(rep(), { ledger: ledgerOf([['S01', 'pandas frame', 'pass', 'fine']]) }))}\n${tiles(render(rep(), { ledger: ledgerOf([['S01', 'pandas frame', 'pass', 'fine']]) }))}`,
	'Show all keeps working over rows that expand': () => coverageOf(render(rep(), { ledger: Array.from({ length: 10 }, (_, i) => `## S${String(i + 1).padStart(2, '0')} - pass ${i}\nStatus: pass\nResult: fine\n\nSteps:\n1. Step for ${i}.\n`).join('\n') })),
	'a finding row links every finding its steps failed on': () => findingRow(coverageOf(typedHtml(TYPED, { ledger: LEDGER.replace('5. VERIFY The summary loads after Retry. -> FAIL - Finding 1', '5. VERIFY The summary loads after Retry. -> FAIL - Finding 2') })), 1) || between(coverageOf(typedHtml(TYPED, { ledger: LEDGER.replace('5. VERIFY The summary loads after Retry. -> FAIL - Finding 1', '5. VERIFY The summary loads after Retry. -> FAIL - Finding 2') })), 'id="cv-row-1"', '</div>'),
	'nothing not run: no Not run tab, and a line saying so': () => {
		const cov = coverageOf(typedHtml(TYPED, { ledger: LEDGER.slice(0, LEDGER.indexOf('## Not run')) }));
		return `${between(cov, '<div class="cf-tabs">', '<div class="panel cf-card">')}${cov.slice(cov.lastIndexOf('<label for="cov-all"'))}`;
	},
	'a scenario name reaches the photo caption as plain text': () => coverageOf(render(rep(), { ledger: '## S01 - **Bold** `code` [link](https://x.example) & more\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY it shows -> PASS\n   Evidence: https://cdn.example/shots/a.png\n' })),
	'a fenced block under a ledger step gets the copy button in Coverage': () => coverageOf(render(TYPED, { ledger: ['# Test ledger', '', '## Environment', '- desktop', '', '---', '', '## S01 - Paced loading', 'Status: pass', 'Result: loads', '', 'Steps:', '1. Load the slow source:', '', '   ```python', '   %run -i slow.py', '   slow = make_slow()', '   ```', '2. VERIFY it loads -> PASS', ''].join('\n') })),

	// Run details.
	'a listed file that is missing is shown unlinked, and a folder never links': () => between(render(LOGS_REPORT, { ledger: LOGS_LEDGER.replace('## Logs\n', '## Logs\n- logs/all/44987/ | Every log | artifact only\n'), fileExists: p => p !== 'logs/exthost.log' }), '<ul class="log-list">', '</ul>'),
	'Run details leaves the explorer\'s format checks to stats.json': () => foldLabels(render(LOGS_REPORT, { ledger: LOGS_LEDGER, readFile: p => (p === 'format-checks.jsonl' ? Buffer.from(JSON.stringify({ problems: 1, rules: { 'report: x': 1 } })) : null), fileExists: p => p === 'stats.json' })),

	// Filing an issue.
	'issue titles: the Feature leads, and the claim starts lowercase unless its first word is a name used elsewhere': () => [
		['Typing while busy aborts'], ['R aborts while busy'], ['PyPI lookups are skipped'], ['A preview goes blank'],
		['Quarto previews go blank'], ['Quarto previews go blank', 'Opening the Quarto preview shows nothing.'],
	].map(args => issueTitle(...args)).join('\n'),
	'issue: System details list each kernel the ledger records': () => issueCopied(logsHtml(LOGS_REPORT, { ledger: LOGS_LEDGER.replace(/^(- Positron [^\n]*\n)/m, '$1- Kernels: Ark 0.1.252+355.f1af004, Kallichore 0.1.71.\n') }), 1),
	'issue: an error longer than six lines is clipped, and a finding with none says so': () => {
		const [f] = LOGS_REPORT.findings;
		const step = f.steps[2];
		const frame = step.log.body.split('\n').at(-1);
		const long = logsWith(1, { steps: f.steps.map((s, i) => (i === 2 ? { ...s, log: { ...s.log, body: [step.log.body, frame, frame, frame, frame].join('\n') } } : s)) });
		return [between(issueCopied(logsHtml(long), 1), '## Error messages', '## Evidence'), between(issueCopied(render(rep({ findings: [fnd(1, { observed: 'nothing.' })] })), 1), '## Error messages', '## Evidence')].join('\n--\n');
	},
	'issue: under the report line is a box a person ticks once they reproduce it, and Describe the issue is its impact': () => issueCopied(logsHtml(logsWith(1, { summary: 'Retry leaves the summary panel empty.', impact: 'Anyone with a slow data source sees no summaries and has no way to load them.' })), 1).split('## Steps to reproduce')[0],
	'issue: a local run links no report, and the likely cause folds as a hypothesis': () => issueCopied(fullHtml(FULL, { base: '/runs/r1' }), 1),
	'issue: an opening describes the issue but stays off the card': () => {
		const html = logsHtml(logsWith(1, { summary: 'When you open a slow column, its summary never loads.', where: 'polars only; R was not checked.' }));
		return [issueCopied(html, 1), between(card(html, 1), '</header>', '<div class="f-sec repro">')].join('\n--\n');
	},

	// Known issues.
	'Linked issues leaves out a zero count': () => findingsOf(kiHtml(KI_REPORT, { ledger: KI_LEDGER.replace('Issue: #10 fix held\n', '') })).split('<div class="ki-list"')[0].slice(-700),
	'Linked issues with nothing observed': () => between(findingsOf(kiHtml(KI_REPORT, { ledger: KI_LEDGER.replace(/^Issue: #2[236] observed\n/gm, '') })), '<div class="ki-grp">', '<div class="ki-list"'),
	'no Linked issues row when a failed fix is a finding and an unexercised one is in Coverage': () => between(findingsOf(kiHtml(KI_REPORT, { knownIssues: { pr: 100, issues: KI_ISSUES.issues.filter(i => [11, 12].includes(i.number)) } })), '<div class="ki-grp">', '</div></div>') || '(none)',
	'an issue no scenario reached is listed as not observed': () => between(kiHtml(KI_REPORT, { ledger: KI_LEDGER.replace(/^Issue: #22 observed\n/m, '') }), 'id="ki-list-no"', '</div></div>'),
	'a confirmed regression says Regressed with a red x': () => findingRow(render(kiWith(2, { verified: 'confirmed' }), { ledger: KI_LEDGER, knownIssues: KI_ISSUES }), 2),
	'with no issue list, a finding row shows its matches as Dupe? without previews': () => findingRow(kiHtml(KI_REPORT, { knownIssues: { ...KI_ISSUES, issues: [] } }), 1),
	'one dupe shows no count': () => findingRow(kiHtml(kiWith(3, { known: [25] })), 3),
	'matches split by kind: issues say Dupe?, an open PR Fix in PR?, a merged PR Fixed in #N?, and a closed PR is left out': () => {
		const refs = [...ISSUE_REFS,
			{ number: 8200, kind: 'pr', state: 'open', title: 'Keep zoom', createdAt: '2026-08-20T00:00:00Z', summary: 'Keeps the zoom level.' },
			{ number: 8300, kind: 'pr', state: 'closed', title: 'Abandoned zoom', createdAt: '2026-08-20T00:00:00Z', summary: '' }];
		const html = fullHtml(fullWith(1, { known: [8200, 2330, 8126, 8300, 3698] }), { issueRefs: refs });
		return [between(card(html, 1), '<div class="meta">', '</div>'), findingRow(html, 1)].join('\n--\n');
	},
	'a finding\'s own issue keeps its line, and a dupe goes below it': () => {
		const html = render({ ...kiWith(1, { known: [11, 25] }), verification: KI_VERIFICATION }, { ledger: KI_LEDGER, knownIssues: KI_ISSUES });
		return [findingRow(html, 1), between(card(html, 1), '<div class="meta">', '</div>')].join('\n--\n');
	},
	'with no findings, linked counts join the empty state': () => findingsOf(render(NO_FINDINGS, { ledger: passing(KI_LEDGER), knownIssues: KI_ISSUES })),
	'with no findings and nothing observed, the counts left join the empty state': () => findingsOf(render(NO_FINDINGS, { ledger: passing(KI_LEDGER).replace(/^Issue: #\d+ observed.*\n/gm, ''), knownIssues: KI_ISSUES })),
	'with no findings and no linked issues, only the empty state shows': () => `${findingsOf(render(NO_FINDINGS, { ledger: passing(KI_LEDGER).replace(/^Issue: .*\n/gm, '') }))}\nscripts: ${scripts(render(NO_FINDINGS))}`,
};

// Icons, feedback links and issue links are pinned elsewhere: by the saved
// pages, and by the tests that read the links' answers and bodies.
const trimScene = out => out.replace(/<svg[\s\S]*?<\/svg>/g, '<svg>').replace(/<div class="fb" .*?<\/div>/g, '<div class="fb">').replace(/href="https:\/\/github\.com\/posit-dev\/positron\/issues\/new\?[^"]*"/g, 'href="(new issue)"');
test('every scene renders as saved', () => checkScenes('scenes.expected.txt', SCENES, { trim: trimScene }));
