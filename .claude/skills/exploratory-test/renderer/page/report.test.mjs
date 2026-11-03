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
import { renderReportHtml, withoutKnownDuplicates } from './html.mjs';
import { REPORT_CSS } from './report-css.mjs';
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
const findingRow = (html, n) => new RegExp(`<a href="#f${n}"[^>]*class="row findings-grid[^"]*"[^>]*>[\\s\\S]*?</a>(?=\\n)`).exec(html)?.[0] ?? '';
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
const KNOWN = fullWith(1, { known: [15102, 14991], dupes: [{ issue: 15102, why: 'the same duplicate entry' }] });
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
	'a finding the verifier matched to issues says Dupe? for the same bug and Related for the rest, on its card, row and prompt': () => [card(fullHtml(KNOWN), 1), findingRow(fullHtml(KNOWN), 1), promptText(fullHtml(KNOWN), 1)].join('\n--\n'),
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
	'grouped findings: tabs for each non-empty group, the info button, and a badge per group; a finding not confirmed has a plain number': () => findingsOf(grouped()),
	'no groups without a comparison: a run on main, or a report from before main replays': () => [
		between(findingsOf(fullHtml(ORIGINS, { changeBase: { usable: false, name: 'main' } })), '<div class="row row-head', '</div>'),
		findingRow(fullHtml(ORIGINS, { changeBase: { usable: false, name: 'main' } }), 1),
		findingRow(fullHtml(ORIGINS, { changeBase: USABLE }), 3),
	].join('\n--\n'),
	'a card shows its group after Reproduced x/y, focusable with its tooltip; a finding not confirmed shows none': () => {
		const context = (html, n) => between(card(html, n), '<span class="group context">', '<button');
		const html = grouped();
		return [context(html, 1), context(html, 2), context(html, 4), context(html, 8)].join('\n--\n');
	},
	'a PR run says Only in PR on its tab, its info button and its badges': () => {
		const html = grouped({ ...REPLAYED, header: { ...REPLAYED.header, pr: { repo: 'posit-dev/positron', number: 1234 } } });
		return [between(findingsOf(html), '<div class="cf-tabs"', '<div class="panel ff-card">'), findingRow(html, 1)].join('\n--\n');
	},
	'a fix that did not hold is Also in latest build, citing its issue': () => findingRow(render({ ...kiWith(1, { verified: 'confirmed' }), verification: { failed: false, text: 'x', originReason: { 1: { reason: 'not replayed', detail: '' } } } }, { ledger: KI_LEDGER, knownIssues: KI_ISSUES, changeBase: USABLE, mainBuild: MAIN_BUILD }), 1),

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
	'issue: Details list each kernel the ledger records': () => issueCopied(logsHtml(LOGS_REPORT, { ledger: LOGS_LEDGER.replace(/^(- Positron [^\n]*\n)/m, '$1- Kernels: Ark 0.1.252+355.f1af004, Kallichore 0.1.71.\n') }), 1),
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
	'every verdict tag, in a row or on a card, has a tooltip: Unproven and any other verdict too': () => {
		const html = kiHtml({ ...KI_REPORT, findings: [
			...KI_REPORT.findings,
			fnd(4, { severity: 'minor', reproduced: { n: 0, m: 3 }, title: 'Seen once', observed: 'it flickered.', expected: 'it stays.' }),
			fnd(5, { severity: 'minor', reproduced: { n: 1, m: 1 }, title: 'Odd verdict', verified: 'withdrawn', observed: 'x.', expected: 'y.' }),
		] });
		const tags = [...html.matchAll(/<span class="og vtag"[^>]*>([^<]*)(<span class="og-tip"[^>]*>(?:<b>[^<]*<\/b>)?<span>([^<]*)<\/span>)?/g)];
		assert.equal(tags.length, 8, `expected a tag per rejected row and card (4 findings), saw ${tags.length}`);
		const missing = tags.filter(t => !t[3]).map(t => t[1]);
		assert.deepEqual(missing, [], `tags with no tooltip: ${missing.join(', ')}`);
		return [...new Set(tags.map(t => `${t[1]}: ${t[3]}`))].join('\n');
	},
	'a disputed finding whose fix did not hold: a faded row with its tag and plain number, Fixes on its card and in Coverage, never Not fixed': () => {
		const html = kiHtml(kiWith(1, { verified: 'disputed' }));
		const context = between(card(html, 1), '<span class="group context">', '<a class="gh-btn"');
		const coverage = /<div class="row coverage-grid[^"]*" id="cv-row-1">[\s\S]*?<\/div>/.exec(coverageOf(html))?.[0] ?? '';
		return [findingRow(html, 1), context, coverage, html.includes('Not fixed') ? 'says Not fixed' : 'never says Not fixed'].join('\n--\n');
	},
	'no Linked issues row when a failed fix is a finding and an unexercised one is in Coverage': () => between(findingsOf(kiHtml(KI_REPORT, { knownIssues: { pr: 100, issues: KI_ISSUES.issues.filter(i => [11, 12].includes(i.number)) } })), '<div class="ki-grp">', '</div></div>') || '(none)',
	'an issue the verifier says the run did not meet is listed as not observed, with why': () => between(kiHtml({ ...KI_REPORT, verification: { ...KI_VERIFICATION, unmet: [{ issue: 22, why: 'saw the <b>panel</b>, not the jump' }] } }), 'id="ki-list-no"', '</div></div>'),
	'an issue no scenario reached is listed as not observed': () => between(kiHtml(KI_REPORT, { ledger: KI_LEDGER.replace(/^Issue: #22 observed\n/m, '') }), 'id="ki-list-no"', '</div></div>'),
	'a confirmed regression says Regressed with a red x': () => findingRow(render(kiWith(2, { verified: 'confirmed' }), { ledger: KI_LEDGER, knownIssues: KI_ISSUES }), 2),
	'with no issue list, a finding row shows its matches as Related without previews': () => findingRow(kiHtml(KI_REPORT, { knownIssues: { ...KI_ISSUES, issues: [] } }), 1),
	'one dupe shows no count': () => findingRow(kiHtml(kiWith(3, { known: [25] })), 3),
	'a match on a fix the run showed holding is left off the finding, so it does not read as not fixed': () => { const html = kiHtml(kiWith(3, { known: [10, 25] })); return [findingRow(html, 3), between(card(html, 3), '<div class="meta">', '</div>'), promptText(html, 3)].join('\n--\n'); },
	'matches split by kind: issues the verifier did not call the same bug say Related, an open PR Fix in PR?, a merged PR Fixed in #N?, and a closed PR is left out': () => {
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

// ---- Grouping by the replay on main's latest daily build ---------------------

const MAIN_BUILD = { version: '2026.11.0-236', commit: '57b03d33f537a868e49c48c7acd0c59d84f9b453', pubDate: '', platform: 'mac/arm64', binary: '/x' };
const twoSteps = (a, b) => ({ steps: [{ step: 9, n: b, m: 2, saw: 'y' }, { step: 5, n: a, m: 2, saw: 'x' }] });
const REPLAYED = rep({
	findings: [
		fnd(1, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, main: twoSteps(0, 0) }),
		fnd(2, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, main: twoSteps(0, 2) }),
		fnd(3, { verified: 'confirmed', main: { missing: ['positron.foo', 'bar.baz'] } }),
		fnd(4, { verified: 'confirmed', main: { couldNotRun: 'R did not start' } }),
		fnd(5, { verified: 'confirmed', reproduced: { n: 1, m: 4 }, main: twoSteps(0, 0) }),
		fnd(6, { verified: 'confirmed', main: { steps: [{ step: 3, n: 1, m: 1, saw: 'x' }] } }),
		fnd(7, { verified: 'confirmed' }),
		fnd(8, { verified: 'disputed' }),
		fnd(9, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, main: { steps: [{ step: 3, n: 0, m: 1, saw: 'x' }] } }),
		fnd(10, { verified: 'confirmed', main: twoSteps(0, 0) }),
		fnd(11, { verified: 'confirmed', main: twoSteps(0, 0) }),
	],
	verification: {
		failed: false, text: 'x',
		origin: { 1: 'introduced', 2: 'inherited', 3: 'introduced', 6: 'inherited' },
		originReason: {
			4: { reason: 'could not run', detail: 'R did not start' },
			5: { reason: 'too few tries', detail: 'not seen in 2 tries on main' },
			7: { reason: 'not replayed', detail: '' },
			9: { reason: 'too few tries', detail: 'not seen in 1 tries on main' },
			10: { reason: 'drift', detail: '' },
			11: { reason: 'drift unchecked', detail: '' },
		},
	},
});
const grouped = (json = REPLAYED, options = {}) => render(json, { changeBase: USABLE, mainBuild: MAIN_BUILD, ...options });
const groupOfRow = (html, n) => /data-og="([a-z]+)"/.exec(findingRow(html, n))?.[1];
const badge = (html, n) => /<span class="f-b ([^"]*)">/.exec(findingRow(html, n))?.[1];
const badgeTip = (html, n) => /<span class="f-b[^"]*">\d+<span class="og-tip"[^>]*><b>([^<]*)<\/b><span>([^<]*)<\/span>/.exec(findingRow(html, n))?.slice(1, 3);
const tabs = html => [...between(html, 'id="findings"', 'ff-card').matchAll(/<span class="cf-l">([^<]*) <span class="cf-cnt">(\d+)<\/span>/g)].map(m => `${m[1]} ${m[2]}`);
const cardGroup = (html, n) => /<span class="og og-meta" tabindex="0">([^<]*)<span class="og-tip"/.exec(card(html, n))?.[1];

test('findings are grouped by the replay on main, and a finding not confirmed has no group', () => {
	const html = grouped();
	assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(n => groupOfRow(html, n)), ['pr', 'ex', 'pr', 'un', 'un', 'ex', 'un', 'none', 'un', 'un', 'un']);
	assert.deepEqual([1, 2, 4, 8].map(n => badge(html, n)), ['f-b-pr', 'f-b-ex', 'f-b-un', 'f-n']);
	assert.equal(badgeTip(html, 8), undefined, 'a finding with no group has no tooltip');
});

test('the tabs show All and each non-empty group, in order, with no tooltips', () => {
	const html = grouped();
	assert.deepEqual(tabs(html), ['All 11', 'Only in branch 2', 'Also in latest build 2', 'Unknown 6']);
	assert.doesNotMatch(between(html, '<div class="cf-tabs"', '<span class="ffi">'), /og-tip/);
	const pr = grouped({ ...REPLAYED, header: { ...REPLAYED.header, pr: { repo: 'posit-dev/positron', number: 1234 } } });
	assert.deepEqual(tabs(pr).slice(0, 2), ['All 11', 'Only in PR 2']);
	const noUnknown = grouped({ ...REPLAYED, findings: REPLAYED.findings.slice(0, 3) });
	assert.deepEqual(tabs(noUnknown), ['All 3', 'Only in branch 2', 'Also in latest build 1']);
});

test('a finding number\'s tooltip gives the evidence for its group', () => {
	const html = grouped();
	assert.deepEqual(badgeTip(html, 1), ['Only in branch', 'Didn&rsquo;t reproduce in the latest build (0 of 2 tries).']);
	assert.deepEqual(badgeTip(html, 3), ['Only in branch', 'Main doesn&rsquo;t have positron.foo, bar.baz yet.']);
	assert.deepEqual(badgeTip(html, 2), ['Also in latest build', 'Also reproduced in the latest build: step 9 (2 of 2 tries).']);
	assert.deepEqual(badgeTip(html, 6), ['Also in latest build', 'Also reproduced in the latest build (1 of 1 tries).']);
	assert.deepEqual(badgeTip(html, 4), ['Unknown', 'It couldn&rsquo;t run on the latest build: R did not start.']);
	assert.deepEqual(badgeTip(html, 5), ['Unknown', 'It&rsquo;s intermittent: it happened in 1 of 4 tries on this branch. It didn&rsquo;t happen in 2 tries on the latest build, but that&rsquo;s too few to rule it out.']);
	const pr = grouped({ ...REPLAYED, header: { ...REPLAYED.header, pr: { repo: 'posit-dev/positron', number: 1234 } } });
	assert.match(badgeTip(pr, 5)[1], /^It&rsquo;s intermittent: it happened in 1 of 4 tries on this PR\. /);
	assert.deepEqual(badgeTip(html, 9), ['Unknown', 'It showed up every time here (2 of 2 tries), but the latest build was tried only 1 time, so we can&rsquo;t say yet.']);
	assert.deepEqual(badgeTip(html, 7), ['Unknown', 'This finding wasn&rsquo;t replayed on the latest build.']);
	assert.deepEqual(badgeTip(html, 10), ['Unknown', 'Main has changed the code where the fix likely goes, so the latest build can&rsquo;t show how this behaved before this branch.']);
	assert.deepEqual(badgeTip(html, 11), ['Unknown', 'It didn&rsquo;t reproduce on the latest build, but its cause wasn&rsquo;t traced, so main may have changed in this area since this branch started.']);
	const none = grouped({ ...REPLAYED, verification: { failed: false, text: 'x', originReason: { 1: { reason: 'no main build', detail: '' } } } }, { mainBuild: undefined });
	assert.deepEqual(badgeTip(none, 1), ['Unknown', 'No build of main was available for this run.']);
});

test('a card shows its group after Reproduced, Unknown with its reason, and nothing for a finding not confirmed', () => {
	const html = grouped();
	assert.equal(cardGroup(html, 1), 'Only in branch');
	assert.equal(cardGroup(html, 2), 'Also in latest build');
	assert.equal(cardGroup(html, 4), 'Unknown: couldn&rsquo;t run on the latest build');
	assert.equal(cardGroup(html, 5), 'Unknown: too few tries on the latest build');
	assert.equal(cardGroup(html, 9), 'Unknown: needs more tries on the latest build');
	assert.equal(cardGroup(html, 7), 'Unknown: not replayed on the latest build');
	assert.equal(cardGroup(html, 10), 'Unknown: main has changed in this area');
	assert.equal(cardGroup(html, 11), 'Unknown: cause not traced');
	assert.equal(cardGroup(html, 8), undefined);
	assert.ok(card(html, 2).includes('Also reproduced in the latest build: step 9 (2 of 2 tries).'), 'the card has the number\'s tooltip');
});

test('a Not fixed finding is Also in latest build, citing its issue, with no group label on its card', () => {
	const json = { ...kiWith(1, { verified: 'confirmed' }), verification: { failed: false, text: 'x', originReason: { 1: { reason: 'not replayed', detail: '' } } } };
	const html = render(json, { ledger: KI_LEDGER, knownIssues: KI_ISSUES, changeBase: USABLE, mainBuild: MAIN_BUILD });
	assert.equal(groupOfRow(html, 1), 'ex');
	assert.match(badgeTip(html, 1)?.[1] ?? '', /^Still happens\. #\d+ is open for it\.$/);
	assert.equal(cardGroup(html, 1), undefined);
});

test('the info button says only what the groups are compared with, and links the daily build', () => {
	const info = html => between(html, '<span class="ffi">', '</div>');
	const html = info(grouped());
	assert.match(html, /<button type="button" class="ffi-btn" aria-label="How findings are grouped" aria-describedby="ffi-pop">/);
	assert.match(html, /<span class="ffi-pop" id="ffi-pop" role="tooltip"><span class="ffi-h">Compared with the latest build<\/span><span class="ffi-p">Each finding was retried on main&rsquo;s latest daily build to see if it also happens there\.<\/span><a class="ffi-l" href="https:\/\/github\.com\/posit-dev\/positron\/commit\/57b03d33f537a868e49c48c7acd0c59d84f9b453" target="_blank" rel="noopener">daily 2026\.11\.0-236 \(57b03d3\) &#8599;<\/a><\/span>/);
	assert.doesNotMatch(html, /ffi-row|Only in branch|Also in latest build|Unknown/);
	assert.match(info(grouped(REPLAYED, { mainBuild: undefined })), /<span class="ffi-p">Each finding[^<]*<\/span><span class="ffi-p">No build of main was available for this run\.<\/span><\/span><\/span>$/);
	assert.match(REPORT_CSS, /\.ffi-pop\{[^}]*width:300px;/);
});

test('term tooltips wait 0.4s and the info panel 0.15s, and the tabs have none', () => {
	assert.match(REPORT_CSS, /\.og:hover \.og-tip,\.og:focus-visible \.og-tip,a\.row:focus-visible \.og-tip\{opacity:1;visibility:visible;transition:opacity \.15s ease \.4s,visibility 0s linear \.4s\}/);
	assert.match(REPORT_CSS, /\.f-b:hover \.og-tip\{opacity:1;visibility:visible;transition:opacity \.15s ease \.4s,visibility 0s linear \.4s\}/);
	assert.match(REPORT_CSS, /\.ffi:hover \.ffi-pop,\.ffi:focus-within \.ffi-pop\{opacity:1;visibility:visible;transition:opacity \.15s ease \.15s,visibility 0s linear \.15s\}/);
	const tips = REPORT_CSS.match(/[^}]*:hover[^{]*\.og-tip[^{]*\{[^}]*\}/g);
	assert.ok(tips.length >= 4);
	for (const rule of tips) {
		assert.match(rule, /transition:opacity \.15s ease \.4s,visibility 0s linear \.4s\}$/, rule);
	}
	assert.doesNotMatch(REPORT_CSS, /ff-tab[^{,]*\.og-tip/);
});

test('screen readers hear the group first, in the severity cell', () => {
	const html = grouped();
	assert.match(findingRow(html, 1), /<span><span class="og-sr">Only in branch, <\/span><span class="pill/);
	assert.doesNotMatch(findingRow(html, 8), /og-sr">[^<]*, </);
});

test('a run with no comparison shows no tabs, info, badges or group labels', () => {
	for (const html of [grouped(REPLAYED, { changeBase: { usable: false, name: 'main' } }), render(ORIGINS, { ledger: FULL_LEDGER, changeBase: USABLE })]) {
		const list = findingsOf(html);
		assert.doesNotMatch(list, /ff-tab|class="ffi"|f-b|data-og/);
		assert.doesNotMatch(list, /Introduced|Exposed|Inherited|Origin/);
	}
	assert.equal(cardGroup(render(ORIGINS, { ledger: FULL_LEDGER, changeBase: USABLE }), 1), undefined);
});

test('the findings table is Severity, Finding and Related, with no Origin column', () => {
	assert.match(REPORT_CSS, /\.findings-grid\{grid-template-columns:110px minmax\(0,1fr\) 156px\}/);
	const html = grouped();
	assert.doesNotMatch(html, /og-cell|og-grid|og-hc/);
	assert.match(html, /<span class="og og-h" tabindex="0">Related<span class="og-tip"[^>]*><b>Related<\/b><span>Existing GitHub issues or PRs related to this finding: one this PR meant to fix, a possible duplicate, or a PR that may fix it\. A dash means none were found\.<\/span>/);
	assert.match(html, /<span class="og-sr">Nothing related<\/span><span class="og-tip"[^>]*><span>No related issues or PRs found\.<\/span>/);
	assert.doesNotMatch(html, /Matches|No matching/);
});

test('a finding whose verification did not finish is Unknown, not verified', () => {
	const json = { ...REPLAYED, verification: { failed: true, text: 'x', originReason: { 1: { reason: 'not verified', detail: '' } } } };
	const html = grouped(json);
	assert.equal(groupOfRow(html, 1), 'un');
	assert.deepEqual(badgeTip(html, 1), ['Unknown', 'Verification didn&rsquo;t finish, so this finding&rsquo;s comparison with main wasn&rsquo;t checked.']);
	assert.equal(cardGroup(html, 1), 'Unknown: not verified');
});

test('at phone width a tooltip fits the screen: a card label opens it under the meta line, a number under the finding title, and Related rightward', () => {
	assert.match(REPORT_CSS, /@media \(max-width:820px\)\{\.og-tip\{max-width:calc\(100vw - 32px\)\}\.card \.meta,\.ff-card \.claim\{position:relative\}\.og-meta,\.ff-card \.f-b\{position:static\}\.og-meta \.og-tip,\.ff-card \.f-b \.og-tip\{left:0;right:0;width:auto;max-width:none;transform:none\}\.ff-card \.f-b \.og-tip\{top:calc\(100% \+ 6px\);bottom:auto\}\.ff-card \.row>:last-child \.og-tip\{left:0;right:auto;transform:none;max-width:calc\(100vw - 64px\)\}\}/);
});

test('at phone width the tabs scroll sideways, the info button hides, and the footer counts stack without breaking', () => {
	assert.match(REPORT_CSS, /@media \(max-width:820px\)\{\.ffi\{display:none\}\.ff \.cf-tabs\{overflow-x:auto;scrollbar-width:none\}\.ff \.cf-tabs::-webkit-scrollbar\{display:none\}\.ki-bar\{grid-template-columns:minmax\(0,1fr\) !important;gap:4px !important\}\.ki-sum \.ki-cnt\{white-space:nowrap\}/);
	assert.doesNotMatch(REPORT_CSS, /flex-wrap:wrap;row-gap:8px/);
});

const NOT_REPORTED = '<span class="ki-st"><span class="og ki-nry">Not reported yet<span class="og-tip" aria-hidden="true" role="tooltip"><b>Not reported yet</b><span>This bug also happens on main and no GitHub issue matches it.</span></span></span></span>';
const issueButton = (html, n) => /<a class="gh-btn[^"]*"[^>]*>[\s\S]*?<\/a>/.exec(card(html, n))?.[0] ?? '';
const issueBody = (html, n) => decodeURIComponent(/&amp;body=([^"&]*)/.exec(issueButton(html, n))?.[1] ?? '');

test('a confirmed bug that also happens on main with nothing related reads Not reported yet, and its card has a labelled File issue button', () => {
	const html = grouped();
	for (const n of [2, 6]) {
		assert.ok(findingRow(html, n).includes(NOT_REPORTED), `finding ${n}`);
		assert.doesNotMatch(findingRow(html, n), /Nothing related/);
		assert.match(issueButton(html, n), /^<a class="gh-btn is-file" href="[^"]+" target="_blank" rel="noopener" aria-label="File a GitHub issue for finding \d+ \(opens GitHub in a new tab\)"><svg[\s\S]*<\/svg><span>File issue<\/span><\/a>$/);
	}
	// Only in branch, Unknown and Disputed keep the dash and the plain icon.
	for (const n of [1, 5, 8]) {
		assert.doesNotMatch(findingRow(html, n), /ki-nry/);
		assert.match(issueButton(html, n), /^<a class="gh-btn" [^>]*data-tip="File a GitHub issue"/);
	}
	// A match on GitHub is related, so it is not this case.
	const known = grouped({ ...REPLAYED, findings: REPLAYED.findings.map(f => (f.n === 2 ? { ...f, known: [5741] } : f)) });
	assert.doesNotMatch(findingRow(known, 2), /ki-nry/);
	assert.match(issueButton(known, 2), /^<a class="gh-btn" /);
	assert.match(REPORT_CSS, /\.ki-nry\{position:relative;font-size:13px;color:var\(--faint\);text-decoration:underline dotted;text-underline-offset:3px\}/);
	assert.match(REPORT_CSS, /\.ff-card a\.row:hover\{position:relative;z-index:2\}/);
	// The icons' tight pairing would overlap the labelled button.
	assert.match(REPORT_CSS, /\.gh-btn\.is-file\+\.cp-btn,\.gh-btn\.is-file\+\.ln-btn\{margin-left:-12px\}/);
});

test('the File issue body opens with the checkbox, and Details lead with where the finding came from', () => {
	const branch = issueBody(grouped(), 2);
	assert.match(branch, /^- \[ \] Reproduced by a human[^\n]*\n\n## Details\n\n- \*\*Found by:\*\* exploratory test on `[^`\n]+`\n- \*\*Reproduces on main:\*\* 2026\.11\.0-236 \(`57b03d3`\)\n- \*\*Positron:\*\*/);
	const pr = issueBody(grouped({ ...REPLAYED, header: { ...REPLAYED.header, pr: { repo: 'posit-dev/positron', number: 1234 } } }), 2);
	assert.match(pr, /- \*\*Found by:\*\* exploratory test on `[^`\n]+`\n/);
	assert.doesNotMatch(issueBody(grouped(), 1), /Reproduces on main/);
});

test('the File issue body names a daily build with no commit by its version alone', () => {
	const body = issueBody(grouped(REPLAYED, { mainBuild: { version: '2026.11.0-12' } }), 2);
	assert.match(body, /- \*\*Reproduces on main:\*\* 2026\.11\.0-12\n/);
});


test('arriving at a Not reported yet card through its row flashes the File issue button once', () => {
	assert.match(REPORT_CSS, /@keyframes fileFlash\{from\{outline-color:var\(--focus\)\}to\{outline-color:transparent\}\}/);
	assert.match(REPORT_CSS, /\.gh-btn\.is-file\.flash\{outline:2px solid var\(--focus\);outline-offset:3px;animation:fileFlash 1\.2s ease-out forwards\}/);
	assert.match(REPORT_CSS, /@media \(prefers-reduced-motion:reduce\)\{\.gh-btn\.is-file\.flash\{animation:none\}\}/);
	const html = grouped();
	assert.match(html, /window\.addEventListener\('hashchange',function\(\)\{var c=document\.getElementById\(location\.hash\.slice\(1\)\);var b=c&&c\.querySelector\('\.gh-btn\.is-file'\);if\(!b\)\{return;\}clearTimeout\(b\._flash\);b\.classList\.remove\('flash'\);void b\.offsetWidth;b\.classList\.add\('flash'\);b\._flash=setTimeout\(function\(\)\{b\.classList\.remove\('flash'\);\},1200\);\}\);/);
});

test('a card shows the screenshots from the latest build, and fails differently is Unknown with what main showed', () => {
	const twoStep = [act('Open the file.'), fail('the chunks stay open', 2, { shots: ['shots/P2.png'] })];
	const json = { ...REPLAYED, findings: REPLAYED.findings.map(f => (f.n === 2 ? { ...f, steps: twoStep, main: { steps: [{ step: 2, n: 2, m: 2, saw: 'collapsed', same: true, shots: ['shots/M2.png'] }] } } : f.n === 6 ? { ...f, main: { steps: [{ step: 3, n: 1, m: 1, saw: 'a different error', same: false, shots: ['shots/M6.png'] }] } } : f)),
		verification: { ...REPLAYED.verification, origin: { 1: 'introduced', 2: 'inherited', 3: 'introduced' }, originReason: { ...REPLAYED.verification.originReason, 6: { reason: 'fails differently', detail: '' } } } };
	const html = grouped(json);
	// The main build's shot pairs with the change's on the step it checks.
	assert.match(card(html, 2), /<path d="M8 3v10"><\/path>/);
	assert.match(html, /data-pr="shots\/P2\.png" data-main="shots\/M2\.png"/);
	assert.equal(cardGroup(html, 6), 'Unknown: fails differently on the latest build');
	assert.deepEqual(badgeTip(html, 6), ['Unknown', 'It also failed on the latest build, but differently (a different error), so this run can&rsquo;t say whether it&rsquo;s the same issue.']);
});

// A fix that held in one scenario and failed in another: partly fixed, said the same way everywhere.
const PARTLY_LEDGER = KI_LEDGER.replace('Issue: #10 fix held', 'Issue: #10 fix held\nIssue: #11 fix held');

test('a fix that held in one scenario and failed in another is Partly fixed in the row, the card and the footer', () => {
	const json = { ...kiWith(1, { verified: 'confirmed' }), verification: { failed: false, text: 'x', originReason: { 1: { reason: 'not replayed', detail: '' } } } };
	const html = render(json, { ledger: PARTLY_LEDGER, knownIssues: KI_ISSUES, changeBase: USABLE, mainBuild: MAIN_BUILD });
	assert.match(findingRow(html, 1), /Partly fixed<\/span><span class="ki-state">.*#11/);
	assert.doesNotMatch(findingRow(html, 1), /Not fixed/);
	assert.match(card(html, 1), /Partly fixed .*#11/);
	assert.deepEqual(badgeTip(html, 1), ['Also in latest build', 'Fixed in &ldquo;fix one&rdquo;, but still happens in &ldquo;fix two&rdquo;. #11 is open for it.']);
	const sum = between(html, '<span class="ki-sum">', '</div>');
	assert.match(sum, /1 fix verified/);
	assert.match(sum, /1 partly fixed/);
	assert.doesNotMatch(between(html, 'id="ki-list-fix"', '</div></div>'), /#11/);
	assert.match(between(html, 'id="ki-list-part"', '</div></div>'), /#11.*passed in &ldquo;fix one&rdquo;, failed in &ldquo;fix two&rdquo;/s);
	assert.match(issueCopied(html, 1), /The fix for #11 in #100 held only in part\./);
});

// ---- Screenshots from this PR next to the latest build ----------------------

const CMP_STEPS = [act('Open the file.'), fail('the Min is right', 1, { shots: ['shots/P1.png'] }), pass('the table loads', { shots: ['shots/P3a.png', 'shots/P3b.png'] })];
const mainStep = (n, m, more = {}) => ({ steps: [{ step: 2, n, m, saw: 'x', shots: ['shots/M1.png'], ...(n > 0 ? { same: true } : {}), ...more }] });
const COMPARED = rep({
	findings: [
		fnd(1, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, main: mainStep(0, 2) }),
		fnd(2, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, main: mainStep(2, 2) }),
		fnd(3, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, main: mainStep(0, 1) }),
		fnd(4, { verified: 'disputed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, main: mainStep(2, 2) }),
		fnd(5, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, main: { steps: [{ step: 2, n: 0, m: 2, saw: 'x', shots: ['shots/M5a.png', 'shots/M5b.png'] }] } }),
	],
	verification: { failed: false, text: 'x', origin: { 1: 'introduced', 2: 'inherited', 5: 'introduced' }, originReason: { 3: { reason: 'too few tries', detail: '' } } },
});
const stepLi = (html, n, k) => new RegExp(`<li id="f${n}-s${k}"[\\s\\S]*?</li>`).exec(card(html, n))?.[0] ?? '';
const shotLinks = (html, n) => [...html.matchAll(new RegExp(`<a class="shot" id="shot-f${n}-[^"]+"[^>]*>`, 'g'))].map(m => m[0]);
const attr = (tag, name) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

test('a failing step with a screenshot from the latest build compares the two', () => {
	const html = grouped(COMPARED);
	const li = stepLi(html, 1, 2);
	assert.match(li, /aria-label="Compare screenshots from this branch and the latest build"/);
	// A split-frame icon the size of the normal one, with no text, so the step never wraps.
	assert.match(li, /<svg aria-hidden="true" width="1em" height="1em" viewBox="0 0 16 16"[^>]*><rect x="1\.5" y="3" width="13" height="10" rx="1\.5"><\/rect><path d="M8 3v10"><\/path>/);
	assert.doesNotMatch(li, /PR vs latest build|st-cmp/);
	assert.match(li, /<span class="ev-hd"><b>This branch<\/b><span>Click to compare with latest build<\/span><\/span>/);
	assert.doesNotMatch(li, /ev-cap/);
	const links = shotLinks(html, 1).filter(t => attr(t, 'data-step') === 'Step 2');
	assert.equal(links.length, 1, 'one pair, not a stack of both builds');
	assert.equal(attr(links[0], 'data-pr'), 'shots/P1.png');
	assert.equal(attr(links[0], 'data-main'), 'shots/M1.png');
	assert.equal(attr(links[0], 'data-pr-h'), 'This branch');
	assert.equal(attr(links[0], 'data-pr-r'), 'Fails');
	assert.equal(attr(links[0], 'data-main-r'), 'daily 2026.11.0-236 &middot; Passes');
});

test('the latest build\'s result follows the finding\'s counts', () => {
	const html = grouped(COMPARED);
	const mainResult = n => attr(shotLinks(html, n).find(t => attr(t, 'data-step') === 'Step 2'), 'data-main-r');
	assert.equal(mainResult(2), 'daily 2026.11.0-236 &middot; Also fails');
	assert.equal(mainResult(3), 'daily 2026.11.0-236 &middot; Didn&rsquo;t fail in 1 try');
});

test('screenshots pair by order, and a side with fewer says so', () => {
	const pairs = shotLinks(grouped(COMPARED), 5).filter(t => attr(t, 'data-step') === 'Step 2');
	assert.deepEqual(pairs.map(t => [attr(t, 'data-pr'), attr(t, 'data-main')]), [['shots/P1.png', 'shots/M5a.png'], ['', 'shots/M5b.png']]);
	assert.match(stepLi(grouped(COMPARED), 5, 2), /M8 3v10/);
});

test('passing steps and findings not confirmed show screenshots as before', () => {
	const html = grouped(COMPARED);
	assert.match(stepLi(html, 1, 3), /aria-label="2 screenshots for this step"/);
	assert.doesNotMatch(stepLi(html, 1, 3), /M8 3v10|ev-hd/);
	assert.doesNotMatch(stepLi(html, 4, 2), /M8 3v10|ev-hd/);
	assert.match(stepLi(html, 4, 2), /aria-label="Screenshot for this step"/);
	assert.ok(shotLinks(html, 4).every(t => !t.includes('M1.png')), 'the latest build\'s shots stay out of a disputed finding');
});

test('the viewer has two columns for a comparison, stacking under 900px, and every preview is clickable', () => {
	const html = grouped(COMPARED);
	assert.match(html, /<div class="lb-cmp" hidden><div><div class="lb-cmp-h"><b><\/b><span><\/span><\/div><img class="shot-full" alt=""><p class="lb-none" hidden><\/p><\/div><div><div class="lb-cmp-h"><b>Latest build<\/b><span><\/span><\/div><img class="shot-full" alt=""><p class="lb-none" hidden><\/p><\/div><\/div>/);
	assert.match(REPORT_CSS, /\.lb-cmp\{display:grid;grid-template-columns:1fr 1fr;/);
	assert.match(REPORT_CSS, /@media \(max-width:900px\)\{\.lb-cmp\{grid-template-columns:1fr\}\}/);
	assert.match(REPORT_CSS, /a\.st-ev:hover \.ev-pop,a\.st-ev:focus-visible \.ev-pop\{pointer-events:auto;cursor:pointer\}/);
});

// ---- Several matches of one kind ---------------------------------------------

const MORE_REFS = [3, 4, 5].map(i => ({ number: 5700 + i, kind: 'issue', state: 'open', title: `Bug ${i}`, createdAt: '2026-08-20T00:00:00Z', summary: '' }));

test('two matches show both numbers; three or more show +N more with a tooltip, and the card lists them all', () => {
	const two = fullHtml(fullWith(1, { known: [5703, 5704], dupes: [{ issue: 5703, why: 'x' }, { issue: 5704, why: 'x' }] }), { issueRefs: MORE_REFS });
	assert.match(findingRow(two, 1), /Dupe\? <span class="ki-num-t"[^>]*>#5703<\/span> <span class="ki-num-t"[^>]*>#5704<\/span>/);
	assert.doesNotMatch(findingRow(two, 1), /\+1|ki-more/);
	const three = fullHtml(fullWith(1, { known: [5703, 5704, 5705], dupes: [5703, 5704, 5705].map(issue => ({ issue, why: 'x' })) }), { issueRefs: MORE_REFS });
	assert.match(findingRow(three, 1), /#5703<\/span><span class="ki-more">\+2 more<span class="og-tip" aria-hidden="true" role="tooltip"><b>2 more possible duplicates<\/b><span>#5704 Bug 4<\/span><span>#5705 Bug 5<\/span><\/span><\/span>/);
	assert.match(card(three, 1), /#5703[\s\S]*#5704[\s\S]*#5705/);
	assert.match(REPORT_CSS, /\.ki-more:hover \.og-tip\{opacity:1;visibility:visible;transition:opacity \.15s ease \.4s,visibility 0s linear \.4s\}/);
});

test('a step\'s own screenshot pairs with the latest build\'s; another scenario\'s evidence pairs with nothing', () => {
	const other = { kind: 'shot', path: 'shots/S02-01.png', scenario: 'S02', caption: 'the same bug in another case' };
	const json = rep({
		findings: [fnd(1, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, evidence: [other], main: mainStep(0, 2) })],
		verification: { failed: false, text: 'x', origin: { 1: 'introduced' } },
	});
	const links = shotLinks(grouped(json), 1).filter(t => attr(t, 'data-step') === 'Step 2');
	assert.deepEqual(links.map(t => [attr(t, 'data-pr'), attr(t, 'data-main'), attr(t, 'data-pair'), attr(t, 'data-pairs')]), [
		['shots/P1.png', 'shots/M1.png', '1', '2'],
		['shots/S02-01.png', '', '2', '2'],
	]);
});

test('the arrows move between a finding\'s compared steps', () => {
	const steps = [act('Open.'), fail('first', 1, { shots: ['shots/P1.png'] }), fail('second', 1, { shots: ['shots/P2.png'] })];
	const json = rep({
		findings: [fnd(1, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps, main: { steps: [2, 3].map(step => ({ step, n: 0, m: 2, saw: 'x', shots: [`shots/M${step}.png`] })) } })],
		verification: { failed: false, text: 'x', origin: { 1: 'introduced' } },
	});
	const groups = shotLinks(grouped(json), 1).map(t => attr(t, 'data-lb'));
	assert.deepEqual(groups, ['f1-cmp', 'f1-cmp']);
});

test('a compared view keeps the arrows in the panel\'s margins, off the screenshots, and a missing side is a full-size placeholder', () => {
	assert.match(REPORT_CSS, /\.lb\.is-cmp \.lb-img\{padding:0 48px\}/);
	// A hidden screenshot leaves nothing behind, not an empty bordered box.
	assert.match(REPORT_CSS, /\.lb-cmp img\.shot-full\[hidden\]\{display:none\}/);
	assert.match(REPORT_CSS, /\.lb-none\{[^}]*display:flex;[^}]*aspect-ratio:16\/10;/);
});

test('a screenshot\'s caption in the viewer drops the code marks the viewer would show literally', () => {
	const other = { kind: 'shot', path: 'shots/S02-01.png', scenario: 'S02', caption: 'The `id` column shows Min `8`' };
	const json = rep({
		findings: [fnd(1, { verified: 'confirmed', reproduced: { n: 2, m: 2 }, steps: CMP_STEPS, evidence: [other], main: mainStep(0, 2) })],
		verification: { failed: false, text: 'x', origin: { 1: 'introduced' } },
	});
	const captions = shotLinks(grouped(json), 1).map(t => attr(t, 'data-caption'));
	assert.ok(captions.includes('The id column shows Min 8'), captions.join(' | '));
	assert.ok(captions.every(c => !c.includes('`')), captions.join(' | '));
});

test('a hover preview never grows taller than the window', () => {
	assert.match(REPORT_CSS, /\.ev-pop img\{[^}]*width:auto;[^}]*max-height:calc\(100vh - 72px\);[^}]*object-fit:contain/);
});

test('an Only in PR finding whose replay could not run says the code is new', () => {
	const json = rep({
		findings: [fnd(1, { verified: 'confirmed', main: { couldNotRun: 'the Export button is not in the toolbar' } })],
		verification: { failed: false, text: 'x', origin: { 1: 'introduced' } },
	});
	assert.deepEqual(badgeTip(grouped(json), 1), ['Only in branch', 'The code involved is new in this branch, so the latest build couldn&rsquo;t run it: the Export button is not in the toolbar.']);
});

// ---- Confirmed duplicates: a known issue, not a new finding ------------------

const DUPE_REFS = [
	{ number: 501, kind: 'issue', state: 'open', title: 'Grid goes blank after a filter', createdAt: '2026-01-02T00:00:00Z', summary: '' },
	{ number: 502, kind: 'issue', state: 'closed', stateReason: 'completed', title: 'Old fixed bug', createdAt: '2025-03-02T00:00:00Z', summary: '' },
	{ number: 503, kind: 'issue', state: 'closed', stateReason: 'not_planned', title: 'Judged intended', createdAt: '2025-04-02T00:00:00Z', summary: '' },
	{ number: 504, kind: 'pr', state: 'open', title: 'Fix the grid', createdAt: '2026-08-02T00:00:00Z', summary: '' },
];
const dupe = (issue, why = `same as ${issue}`) => ({ dupes: [{ issue, why }] });
const fails = main => ({ verified: 'confirmed', reproduced: { n: 2, m: 2 }, main });
const DUPES = rep({
	findings: [
		fnd(1, { ...fails(twoSteps(0, 2)), severity: 'moderate', known: [501], ...dupe(501, 'the same blank grid after the same filter'), steps: [act('Open the grid.'), fail('Verify the grid shows rows', 1)] }),
		fnd(2, { ...fails(twoSteps(0, 0)), known: [501], ...dupe(501) }),
		fnd(3, { verified: 'confirmed', known: [501], ...dupe(501) }),
		fnd(4, { ...fails(twoSteps(0, 2)), known: [502], ...dupe(502) }),
		fnd(5, { ...fails(twoSteps(0, 2)), severity: 'major', intended: [503], ...dupe(503, 'the same message, closed as by design') }),
		fnd(6, { ...fails(twoSteps(0, 2)), known: [504, 501] }),
	],
	verification: { failed: false, text: 'x', origin: { 1: 'inherited', 2: 'introduced', 4: 'inherited', 5: 'inherited', 6: 'inherited' }, originReason: { 3: { reason: 'not replayed', detail: '' } } },
});
const DUPE_LEDGER = ledgerOf([['S01', 'filter the grid', 'fail (finding 1)', 'blank'], ['S02', 'open the grid', 'fail (finding 2)', 'x'], ['S03', 'by design', 'fail (finding 5)', 'x']]);
const dupes = (json = DUPES, options = {}) => grouped(json, { ledger: DUPE_LEDGER, issueRefs: DUPE_REFS, ...options });
const knownList = html => between(html, 'id="ki-list-obs"', '</div></div>\n') || between(html, 'id="ki-list-obs"', '<section');

test('a confirmed duplicate of an open issue that also fails on the latest build leaves the findings', () => {
	const html = dupes();
	assert.deepEqual(tabs(html), ['All 4', 'Only in branch 1', 'Also in latest build 2', 'Unknown 1']);
	assert.equal(findingRow(html, 5), '');
	assert.doesNotMatch(html, /id="f5"/);
	assert.match(html, /<div class="ki-bar"><span class="ki-lbl"><b>Existing issues<\/b><\/span><span class="ki-sum">[^\n]*2 observed/);
});

test('a duplicate leaves every count: the tiles and the link card count only what is left', () => {
	const { report, demoted } = withoutKnownDuplicates(reportFromJson(DUPES, { ledger: DUPE_LEDGER }), { changeBase: USABLE, issueRefs: DUPE_REFS });
	assert.deepEqual(demoted.map(d => [d.issue.number, d.wontFix]), [[503, true], [501, false]]);
	assert.deepEqual(report.severityCounts, { major: 0, moderate: 0, minor: 4 });
	assert.equal(report.findingCount, 4);
});

test('Only in PR says Similar, Unknown keeps Dupe, an unconfirmed match says Related, and a closed fixed issue reads Regressed', () => {
	const html = dupes();
	const tip = '<span class="og-tip" aria-hidden="true" role="tooltip"><b>Similar?</b><span>Didn&rsquo;t reproduce on the latest build, so this is likely a different bug.</span></span>';
	assert.ok(findingRow(html, 2).includes(`<span class="og ki-sim">Similar?${tip}</span> <span class="ki-num-t"`), findingRow(html, 2));
	assert.doesNotMatch(findingRow(html, 2), /Dupe\?/);
	assert.match(card(html, 2), /<span class="og ki-sim ki-sim-c" tabindex="0">Similar\?<span class="og-tip" role="tooltip"><b>Similar\?<\/b><span>Didn&rsquo;t reproduce/);
	assert.match(findingRow(html, 3), /Dupe\? <span class="ki-num-t"[^>]*>#501/);
	assert.match(findingRow(html, 4), /Regressed<\/span><span class="ki-state"><span class="ki-num-t"[^>]*>#502/);
	assert.doesNotMatch(findingRow(html, 4), /Dupe\?/);
	assert.match(card(html, 4), /Regressed <a class="ki-num"[^>]*>#502/);
	// A PR match never demotes, and an issue match the verifier did not call the same bug is only Related.
	assert.match(findingRow(html, 6), /Related[\s\S]*Fix in PR\?/);
	assert.doesNotMatch(findingRow(html, 6), /Dupe\?/);
});

test('a demoted finding is listed under known issues, worst first, in two lines, its reason a tooltip on its source', () => {
	const list = knownList(dupes());
	assert.ok(list.indexOf('#503') < list.indexOf('#501'), 'the major one first');
	const source = why => `<span class="og ki-src" tabindex="0">matched a finding<span class="og-tip" role="tooltip"><b>Same bug as a finding</b><span>${why}</span></span></span>`;
	const entry = (state, severity, why) => `<span class="ki-lc-m"><span class="ki-sev ki-sev-${severity.toLowerCase()}" aria-hidden="true"></span>${severity} &middot; ${state} &middot; ${source(why)} &middot; <a class="ki-ev" href="#cv-row-`;
	assert.ok(list.includes(`#503</a><span>Judged intended${entry('Won&rsquo;t fix', 'Major', 'the same message, closed as by design')}`), list);
	assert.ok(list.includes(`#501</a><span>Grid goes blank after a filter${entry('Open', 'Moderate', 'the same blank grid after the same filter')}`), list);
	assert.doesNotMatch(list, /ki-copy|Copy comment|seen in/);
});

test('a linked issue the run saw has the same two lines, with its rated severity and linked to the change', () => {
	const list = knownList(render(KI_REPORT, { ledger: KI_LEDGER, knownIssues: KI_ISSUES }));
	assert.match(list, /#23<\/a><span>major one<span class="ki-lc-m"><span class="ki-sev ki-sev-major" aria-hidden="true"><\/span>Major &middot; Open &middot; linked to branch &middot; <a class="ki-ev" href="#cv-row-\d+">View evidence<\/a><\/span><\/span><\/div>/);
});

const STEPS_LEDGER = `## S01 - filter the grid
Status: fail (finding 1)
Result: Fails 2/2
Steps:
1. Open the grid.
2. VERIFY the grid shows rows -> FAIL - Finding 1
   Observed: The grid is blank

## S02 - open the grid
Status: fail (finding 2)
Result: x
Steps:
1. Open it.
2. VERIFY rows -> FAIL - Finding 2
`;

test('a failing coverage row with no finding left opens on its steps, as a passing row does, without the rate', () => {
	const html = dupes(DUPES, { ledger: STEPS_LEDGER });
	const row = /<details class="cv cf-r cf-i" id="(cv-row-\d+)"><summary class="row coverage-grid">([\s\S]*?)<\/summary><div class="cv-steps">([\s\S]*?)<\/div><\/details>/.exec(html);
	assert.ok(row, 'the known issue row is a details');
	assert.match(row[2], /<span>filter the grid<\/span>[\s\S]*<span class="cov-result">Known issue <a class="ki-num"[^>]*>#501<\/a><\/span>/);
	assert.doesNotMatch(row[2], /Fails 2\/2/);
	assert.match(row[3], /<ol class="steps">[\s\S]*Open the grid\.[\s\S]*Verify the grid shows rows<\/span><span class="st-rs st-fail">FAIL/);
	// Its evidence link in the known issues list is the row's id.
	assert.ok(knownList(html).includes(`<a class="ki-ev" href="#${row[1]}">View evidence</a>`));
	// A row that still links to a finding does not expand: its steps are on the card.
	assert.match(html, /<div class="row coverage-grid cf-r cf-i" id="cv-row-\d+"><span class="cov-scenario">[^\n]*<span>open the grid<\/span>[^\n]*<a href="#f2" class="cv-f">Finding 2<\/a>/);
	// Following a link to a closed row opens it.
	assert.match(html, /function openRow\(\)\{var d=location\.hash&&document\.getElementById\(location\.hash\.slice\(1\)\);if\(d&&d\.tagName==='DETAILS'&&d\.classList\.contains\('cv'\)\)\{d\.open=true;\}\}window\.addEventListener\('hashchange',openRow\);openRow\(\);/);
});

test('a known issues list taller than the window scrolls, and a shorter one keeps its tooltips unclipped', () => {
	assert.match(REPORT_CSS, /\.ki-lc\{[^}]*max-height:none;overflow:visible;/);
	assert.match(REPORT_CSS, /\.ki-lc\.ki-lc-scroll\{max-height:calc\(100vh - 24px\);overflow-y:auto\}/);
	const html = dupes();
	assert.match(html, /function place\(a\)\{pop\.classList\.remove\('ki-lc-scroll'\);var r=a\.getBoundingClientRect\(\),w=pop\.offsetWidth,h=pop\.offsetHeight,m=12;\nif\(h>window\.innerHeight-2\*m\)\{pop\.classList\.add\('ki-lc-scroll'\);h=pop\.offsetHeight;\}/);
});

test('an issue closed as a duplicate is still open under another number: never Regressed, and a confirmed match is a known issue', () => {
	const refs = [...DUPE_REFS, { number: 505, kind: 'issue', state: 'closed', stateReason: 'duplicate', title: 'Grid blank again', createdAt: '2026-02-02T00:00:00Z', summary: '' }];
	const json = rep({
		findings: [
			fnd(1, { ...fails(twoSteps(0, 2)), severity: 'moderate', known: [505], ...dupe(505, 'the same blank grid') }),
			fnd(2, { ...fails(twoSteps(0, 0)), known: [505], ...dupe(505) }),
		],
		verification: { failed: false, text: 'x', origin: { 1: 'inherited', 2: 'introduced' }, originReason: {} },
	});
	const { demoted } = withoutKnownDuplicates(reportFromJson(json, { ledger: DUPE_LEDGER }), { changeBase: USABLE, issueRefs: refs });
	assert.deepEqual(demoted.map(d => [d.f.n, d.issue.number]), [[1, 505]]);
	const html = grouped(json, { ledger: DUPE_LEDGER, issueRefs: refs });
	assert.match(knownList(html), /#505<\/a><span>Grid blank again<span class="ki-lc-m"><span class="ki-sev ki-sev-moderate" aria-hidden="true"><\/span>Moderate &middot; Duplicate &middot; /);
	// Only in branch: not Regressed, just a possible match.
	assert.doesNotMatch(findingRow(html, 2), /Regressed/);
	assert.match(findingRow(html, 2), /Similar\?/);
	assert.doesNotMatch(card(html, 2), /Regressed/);
});

test('a scenario that hit a known issue and a new bug links the finding and still opens on its steps', () => {
	const json = rep({
		findings: [
			fnd(1, { ...fails(twoSteps(0, 2)), severity: 'moderate', known: [501], ...dupe(501, 'the same blank grid'), steps: [act('Open the grid.'), fail('Verify the grid shows rows', 1)] }),
			fnd(2, { ...fails(twoSteps(0, 0)), steps: [act('Sort.'), fail('Verify the arrow', 2)] }),
		],
		verification: { failed: false, text: 'x', origin: { 1: 'inherited', 2: 'introduced' }, originReason: {} },
	});
	const ledger = `## S01 - filter then sort the grid
Status: fail (finding 1, finding 2)
Result: x
Steps:
1. Open the grid.
2. VERIFY the grid shows rows -> FAIL - Finding 1
3. Sort.
4. VERIFY the arrow -> FAIL - Finding 2
`;
	const html = grouped(json, { ledger, issueRefs: DUPE_REFS });
	const row = /<details class="cv cf-r cf-i" id="(cv-row-\d+)"><summary class="row coverage-grid">([\s\S]*?)<\/summary><div class="cv-steps">([\s\S]*?)<\/div><\/details>/.exec(html);
	assert.ok(row, 'the row opens');
	assert.match(row[2], /<a href="#f2" class="cv-f">Finding 2<\/a> &middot; Known issue <a class="ki-num"[^>]*>#501<\/a>/);
	assert.match(row[3], /Verify the grid shows rows[\s\S]*Verify the arrow/);
	assert.ok(knownList(html).includes(`<a class="ki-ev" href="#${row[1]}">View evidence</a>`));
});

// A run on main: no comparison, so no groups, but a confirmed duplicate is still a known issue.
const ON_MAIN = { usable: false, name: 'main' };
const MAIN_RUN = rep({
	header: { ...HEADER, branch: 'main' },
	findings: [
		fnd(1, { ...fails(twoSteps(2, 2)), severity: 'moderate', known: [501], ...dupe(501, 'the same blank grid') }),
		fnd(2, { ...fails(twoSteps(2, 2)), known: [502], ...dupe(502) }),
		fnd(3, { verified: 'disputed', known: [501], ...dupe(501) }),
		fnd(4, { ...fails(twoSteps(2, 2)), known: [501] }),
		fnd(5, { ...fails(twoSteps(2, 2)), known: [503], intended: [503], ...dupe(503, 'closed as by design') }),
	],
	verification: { failed: false, text: 'x', origin: {}, originReason: {} },
});
const onMain = (json = MAIN_RUN, base = ON_MAIN) => render(json, { ledger: DUPE_LEDGER, issueRefs: DUPE_REFS, changeBase: base, mainBuild: MAIN_BUILD });

test('on a run of main, a confirmed duplicate of an open or won\'t-fix issue is a known issue too, with no groups shown', () => {
	const { report, demoted } = withoutKnownDuplicates(reportFromJson(MAIN_RUN, { ledger: DUPE_LEDGER }), { changeBase: ON_MAIN, issueRefs: DUPE_REFS });
	assert.deepEqual(demoted.map(d => [d.f.n, d.issue.number]), [[1, 501], [5, 503]]);
	// A closed fixed issue came back, a disputed finding is not confirmed, and a loose match is not a duplicate.
	assert.equal(report.findingCount, 3);
	const html = onMain();
	assert.doesNotMatch(between(html, 'id="findings"', '</section>'), /data-og=|class="cf-tabs"/);
	assert.match(html, /<span class="ki-sum">[^\n]*2 observed/);
	assert.match(findingRow(html, 2), /Regressed/);
	// A branch run whose change base is unusable is not a run on main: nothing is demoted.
	const branch = rep({ ...MAIN_RUN, header: { ...HEADER, branch: 'feature/x' } });
	assert.equal(withoutKnownDuplicates(reportFromJson(branch, { ledger: DUPE_LEDGER }), { changeBase: ON_MAIN, issueRefs: DUPE_REFS }).demoted.length, 0);
	assert.equal(withoutKnownDuplicates(reportFromJson(MAIN_RUN, { ledger: DUPE_LEDGER }), { changeBase: undefined, issueRefs: DUPE_REFS }).demoted.length, 0);
});

// Three findings that are the same bug as one issue, one of them also linked.
const SAME_ISSUE = rep({
	findings: [
		fnd(1, { ...fails(twoSteps(0, 2)), severity: 'minor', known: [501], ...dupe(501, 'first reason'), steps: [act('Open the grid.'), fail('Verify the grid shows rows', 1)] }),
		fnd(2, { ...fails(twoSteps(0, 2)), severity: 'major', known: [501], ...dupe(501, 'second reason'), steps: [act('Open it.'), fail('Verify rows', 2)] }),
		fnd(3, { ...fails(twoSteps(0, 2)), severity: 'moderate', known: [501], ...dupe(501, 'third reason') }),
		fnd(4, { ...fails(twoSteps(0, 0)) }),
	],
	verification: { failed: false, text: 'x', origin: { 1: 'inherited', 2: 'inherited', 3: 'inherited', 4: 'introduced' }, originReason: {} },
});
const SAME_LEDGER = ledgerOf([['S01', 'filter the grid', 'fail (finding 1)', 'blank'], ['S02', 'open the grid', 'fail (finding 2)', 'x']]);

test('an issue several findings duplicate is listed and counted once, with every reason in its tooltip', () => {
	const html = grouped(SAME_ISSUE, { ledger: SAME_LEDGER, issueRefs: DUPE_REFS });
	assert.match(html, /<span class="ki-sum">[^\n]*1 observed/);
	const list = knownList(html);
	assert.equal(list.match(/#501<\/a>/g)?.length, 1, list);
	const source = '<span class="og ki-src" tabindex="0">matched 3 findings<span class="og-tip" role="tooltip"><b>Same bug as 3 findings</b><span>second reason</span><span>third reason</span><span>first reason</span></span></span>';
	// The worst severity, and the evidence of the worst finding.
	assert.ok(list.includes(`<span class="ki-sev ki-sev-major" aria-hidden="true"></span>Major &middot; Open &middot; ${source} &middot; <a class="ki-ev" href="#cv-row-`), list);
	assert.equal(between(html, '<span>open the grid</span>', '</div>').match(/#501/g)?.length, 1);
	// One coverage row citing two of them names the issue once.
	const twice = rep({ ...SAME_ISSUE, findings: SAME_ISSUE.findings.map(f => (f.n === 2 ? { ...f, steps: [act('Open it.'), fail('Verify rows', 1)] } : f)) });
	const one = withoutKnownDuplicates(reportFromJson(twice, { ledger: ledgerOf([['S01', 'filter the grid', 'fail (findings 1, 2)', 'blank']]) }), { changeBase: USABLE, issueRefs: DUPE_REFS });
	assert.deepEqual(one.report.coverage.exercised.flatMap(r => r.issues ?? []).map(i => i.n), [501]);
});

test('a linked issue a finding matched is listed once as observed, with both sources, and not as not observed', () => {
	const linked = { repo: 'posit-dev/positron', pr: 9, fetchedAt: '', issues: [{ number: 501, url: '', relation: 'linked', title: 'Grid goes blank after a filter', state: 'open', createdAt: '', summary: '' }] };
	const json = { ...SAME_ISSUE, findings: SAME_ISSUE.findings.filter(f => f.n !== 3 && f.n !== 2) };
	const html = grouped(json, { ledger: ledgerOf([['S01', 'filter the grid', 'fail (finding 1)', 'blank']]), issueRefs: DUPE_REFS, knownIssues: linked });
	assert.match(html, /<span class="ki-sum">[^\n]*1 observed/);
	const list = knownList(html);
	assert.equal(list.match(/#501<\/a>/g)?.length, 1, list);
	assert.match(list, /Minor &middot; Open &middot; linked to branch &middot; <span class="og ki-src" tabindex="0">matched a finding</);
	// The finding shows the run reached it, so it is not also listed as not observed.
	assert.doesNotMatch(html, /id="ki-list-no"|not observed/);
});

test('a coverage row whose finding was demoted names the known issue instead', () => {
	const html = dupes();
	const row = between(html, '<span>filter the grid</span>', '</div>');
	assert.match(row, /Known issue <a class="ki-num"[^>]*>#501<\/a>/);
	assert.doesNotMatch(row, /Finding \d/);
});

test('when every finding is demoted, the page says no new findings and counts the known issues', () => {
	const html = dupes({ ...DUPES, findings: DUPES.findings.slice(0, 1) });
	assert.match(findingsOf(html), /<b>No new findings<\/b><span class="ki-empty-sum">.*1 known issue observed/);
	assert.match(knownList(html), /#501/);
});

test('a duplicate stays a finding on a run with no replay on main', () => {
	const html = render(DUPES, { ledger: DUPE_LEDGER, issueRefs: DUPE_REFS });
	assert.ok(findingRow(html, 5));
	assert.match(findingRow(html, 1), /Dupe\?/);
});

test('the known issues popover is wider and lets the reason tooltip show in full', () => {
	assert.match(REPORT_CSS, /\.ki-lc\{[^}]*width:420px;[^}]*max-height:none;[^}]*overflow:visible;/);
	assert.match(REPORT_CSS, /\.ki-src \.og-tip\{left:0;right:auto;transform:none;width:280px;top:calc\(100% \+ 6px\);bottom:auto;white-space:normal\}/);
	assert.match(REPORT_CSS, /\.ki-sev-minor\{background:var\(--minor-dot\)\}/);
	assert.match(REPORT_CSS, /\.ki-src:focus-visible \.og-tip/);
});

test('with a demoted finding, every footer count still opens its list, and only the demoted card is gone', () => {
	const json = {
		...KI_REPORT,
		findings: [...KI_REPORT.findings, fnd(4, { ...fails(twoSteps(0, 2)), title: 'Grid blanks', known: [501], ...dupe(501) })],
		verification: { ...KI_VERIFICATION, origin: { 4: 'inherited' } },
	};
	const html = grouped(json, { ledger: `${KI_LEDGER.replace('## Not run', '## S06 - grid\nStatus: fail - Finding 4\nResult: blank\n\n## Not run')}`, knownIssues: KI_ISSUES, issueRefs: DUPE_REFS });
	const counts = [...html.matchAll(/<span class="ki-cnt"[^>]*aria-controls="([^"]+)">([^<]*)<\/span>/g)].map(m => [m[1], m[2]]);
	assert.deepEqual(counts.map(c => c[1]), ['1 fix verified', '4 observed', '1 not observed']);
	for (const [id] of counts) {
		assert.match(html, new RegExp(`<div class="ki-list" id="${id}" hidden>`), `${id} has its list`);
	}
	assert.match(knownList(html), /#501<\/a><span>Grid goes blank after a filter/);
	assert.deepEqual([...html.matchAll(/<article id="(f\d+)"/g)].map(m => m[1]), ['f1', 'f3', 'f2']);
	for (const title of ['Still jumps', 'Old bug back', 'Looks known']) {
		assert.ok(html.includes(title), title);
	}
	assert.ok(!html.includes('Grid blanks'), 'the demoted finding has no row or card');
});

// ---- The issue and PR preview card -------------------------------------------

/** The preview card's parts, by class, after `act` drives the page's card script against a stub DOM. */
function previewCard(act) {
	const html = render(KI_REPORT, { ledger: KI_LEDGER, knownIssues: KI_ISSUES });
	const src = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).find(s => s.includes("card.id='ki-card'"));
	assert.ok(src, 'the page has the preview card script');
	const el = () => {
		const node = { children: [], className: '', style: {}, classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {}, appendChild: c => { node.children.push(c); return c; } };
		Object.defineProperty(node, 'textContent', { get: () => node.text ?? node.children.map(c => c.textContent).join(''), set: v => { node.text = v || null; node.children = []; } });
		return node;
	};
	let card;
	const handlers = {};
	const document = {
		createElement: () => (card ??= el(), card.children.length || card.id ? el() : card),
		createTextNode: text => ({ textContent: text }),
		body: { appendChild() {} },
		addEventListener: (type, fn) => { handlers[type] = fn; },
	};
	const window = { innerWidth: 1280, addEventListener() {} };
	new Function('document', 'window', src)(document, window);
	const link = tag => ({ tagName: tag, textContent: '#5690', dataset: { state: 'open', title: 'A title', summary: 'From the body.', opened: 'Opened Aug 3' }, closest() { return this; }, matches: () => false, setAttribute() {}, removeAttribute() {}, getBoundingClientRect: () => ({ left: 0, top: 200, bottom: 216, width: 40 }) });
	act({ handlers, link });
	const parts = {};
	const walk = node => { for (const c of node.children ?? []) { if (c.className) { parts[c.className.split(' ')[0]] = c.textContent; } walk(c); } };
	walk(card);
	return parts;
}

test('the preview card has no footer for mouse users, an arrow on a linked number, and an upright summary', () => {
	const linked = previewCard(({ handlers, link }) => handlers.mouseover({ target: link('A') }));
	assert.equal(linked['ki-n'], '#5690 ↗');
	assert.equal(linked['ki-card-x'], 'From the body.');
	assert.equal(linked['ki-card-f'], undefined);
	const row = previewCard(({ handlers, link }) => handlers.mouseover({ target: link('SPAN') }));
	assert.equal(row['ki-n'], '#5690');
	assert.equal(row['ki-card-f'], undefined);
	assert.doesNotMatch(REPORT_CSS, /\.ki-card-x\{[^}]*font-style:italic/);
});

test('on touch, a linked number\'s card says to tap again to open it on GitHub', () => {
	const linked = previewCard(({ handlers, link }) => {
		handlers.pointerdown({ pointerType: 'touch' });
		handlers.click({ target: link('A'), preventDefault() {} });
	});
	assert.equal(linked['ki-card-f'], 'Tap again to open on GitHub');
});


test('a finding the change says it fixes is never a known issue, even when the explorer did not tag the fix as failed', () => {
	const fixes = { repo: 'posit-dev/positron', pr: 9, fetchedAt: '', issues: [{ number: 501, url: '', relation: 'fixes', title: 'Grid goes blank after a filter', state: 'open', createdAt: '', summary: '' }] };
	const { demoted } = withoutKnownDuplicates(reportFromJson(DUPES, { ledger: DUPE_LEDGER }), { changeBase: USABLE, issueRefs: DUPE_REFS, knownIssues: fixes });
	assert.deepEqual(demoted.map(d => d.issue.number), [503]);
	assert.notEqual(findingRow(dupes(DUPES, { knownIssues: fixes }), 1), '');
});

test('a demoted finding keeps report.json\'s numbers on the rest, so the notes and outcomes name the same findings', () => {
	const { report } = withoutKnownDuplicates(reportFromJson(DUPES, { ledger: DUPE_LEDGER }), { changeBase: USABLE, issueRefs: DUPE_REFS });
	assert.deepEqual(report.findings.map(f => f.n), [2, 3, 4, 6]);
	assert.deepEqual([...report.verification.origin], [[2, 'introduced'], [4, 'inherited'], [6, 'inherited']]);
	assert.deepEqual([...report.verification.originReason.keys()], [3]);
	const html = dupes();
	assert.deepEqual([2, 3, 4, 6].map(n => groupOfRow(html, n)), ['pr', 'un', 'ex', 'ex']);
	assert.doesNotMatch(html, /id="f1"|id="f5"/);
});

test('a report the known issue check cannot read keeps every finding rather than failing the page', () => {
	const parsed = reportFromJson(DUPES, { ledger: DUPE_LEDGER });
	const { report, demoted } = withoutKnownDuplicates({ ...parsed, coverage: undefined }, { changeBase: USABLE, issueRefs: DUPE_REFS });
	assert.equal(demoted.length, 0);
	assert.equal(report.findings.length, 6);
});

test('the page reuses known issues already worked out for it', () => {
	const parsed = reportFromJson(DUPES, { ledger: DUPE_LEDGER });
	const shown = withoutKnownDuplicates(parsed, { changeBase: USABLE, issueRefs: DUPE_REFS });
	// Without the issue previews it could not work them out itself.
	const html = renderReportHtml(parsed, { changeBase: USABLE, mainBuild: MAIN_BUILD, ledger: DUPE_LEDGER, shown });
	assert.doesNotMatch(html, /id="f1"|id="f5"/);
});

test('an issue closed for a reason the saved preview does not record is not called Regressed', () => {
	const refs = DUPE_REFS.map(r => (r.number === 502 ? { ...r, stateReason: undefined } : r));
	const html = dupes(DUPES, { issueRefs: refs });
	assert.doesNotMatch(findingRow(html, 4), /Regressed/);
	assert.match(findingRow(html, 4), /Dupe\?/);
});
