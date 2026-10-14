/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Lint's checks of the ledger and the report. What each rule says is pinned by
// scenes at the end, one line per case, named for what lint should do there;
// fixtures/lint-scenes.expected.txt holds what each gave. The tests above them
// check what a scene cannot: severities, and the command-line checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ledgerLint from './lint-ledger.mjs';
import { checkScenes } from '../shared/scene-check.mjs';
import { formatProblems, lintReportJson as lintReportJsonRaw, schemaProblems } from '../lint-json.mjs';
import { LINT_RULES, problem, splitProblems } from './lint-rules.mjs';

const texts = ps => ps.map(p => p.text);
const split = ps => { const { errors, warnings } = splitProblems(ps); return { errors: texts(errors), warnings: texts(warnings) }; };
const lintActionsLog = (...a) => texts(ledgerLint.lintActionsLog(...a));
const lintLedgerOnly = (...a) => texts(ledgerLint.lintLedgerOnly(...a));
const lintShotNames = (...a) => texts(ledgerLint.lintShotNames(...a));
const lintShotTiming = (...a) => texts(ledgerLint.lintShotTiming(...a));
const lintReportJson = (...a) => texts(lintReportJsonRaw(...a));
import { applyVerification, parseVerifyReply } from '../agents/finish.mjs';
import { withTmpDir } from '../shared/tmp-dirs.mjs';

/** One finding, as report.json writes it, with the run around it. */
const BASE = {
	header: {
		title: 'x',
		branch: 'main',
		sha: 'abc1234',
		result: 'The panel loads.',
		tested: 'the panel',
		notExercised: 'the web build',
		details: [{ title: 'Change under test', body: 'A retry button.' }],
	},
	findings: [{
		n: 1,
		severity: 'moderate',
		reproduced: { n: 2, m: 2 },
		feature: 'console',
		title: 'Retry does nothing',
		impact: 'Anyone who clicks Retry stays stuck on an empty panel, with no other way to load it.',
		steps: [
			{ kind: 'action', text: 'Click Retry.' },
			{ kind: 'verify', text: 'it loads', result: 'fail', finding: 1, observed: 'empty', shots: ['shots/a.png'], log: { source: 'none found in logs/r.log' } },
		],
		observed: 'The panel stays empty.',
		expected: 'The panel loads.',
		evidence: [{ kind: 'shot', path: 'shots/a.png', step: 2, caption: 'empty panel' }],
		tests: { cases: [], related: [] },
	}],
	scenarios: [
		{ id: 'S01', name: 'Panel loads', status: 'pass', result: 'loads' },
		{ id: 'S02', name: 'Retry', status: 'fail', result: 'Fails 2/2', findings: [1] },
		{ id: 'N01', name: 'web build', status: 'not-run', reason: 'no server' },
	],
	logs: [],
	files: [],
	environment: {},
};

/** BASE with `edit(finding, report)` applied to a copy. */
const report = (edit = () => { }) => {
	const json = structuredClone(BASE);
	edit(json.findings[0], json);
	return json;
};

const LEDGER = `# Test ledger

## Environment
- Positron 2026.10.0 build 12, dev build of ed2487a1a2 (Code - OSS 1.105.0), on Ubuntu 22.04 (Linux x64).

## S01 - Panel loads
Status: pass
Result: loads

Steps:
1. Open it.
2. VERIFY it loads -> PASS
   Evidence: p.png

## S02 - Retry
Status: fail - Finding 1
Result: Fails 2/2

Steps:
1. Click Retry.
2. VERIFY it loads -> FAIL - Finding 1
   Observed: empty
   Evidence: a.png
   Log: none found in logs/r.log

## Not run
- N01 - web build - no server
`;

const lintRaw = (json = report(), ledger = LEDGER, options = { fileExists: () => true }) => formatProblems(json, ledger, options);
const lint = (...a) => texts(lintRaw(...a));

const edited = edit => lint(report(edit));
const step = text => edited(f => { f.steps[0].text = text; });
const pre = (text, name = 'app running') => edited(f => { f.preconditions = [{ name, text }]; });
const title = text => edited(f => { f.title = text; });
const pair = (observed, expected) => edited(f => { f.observed = observed; f.expected = expected; });
const inLedger = (from, to) => lint(report(), LEDGER.replace(from, to));
const ledgerOnly = (from, to) => lintLedgerOnly(LEDGER.replace(from, to));
/** `fn` over each input, keyed by the input, for a scene that tries several. */
const each = (fn, inputs) => {
	const out = {};
	for (const input of inputs) {
		const key = Array.isArray(input) ? input.join(' | ') : input;
		// Two cases under one name would leave one of them unchecked.
		assert.ok(!(key in out), `two scene cases are named ${key}`);
		out[key] = Array.isArray(input) ? fn(...input) : fn(input);
	}
	return out;
};

// ---- Severities and the command line ----------------------------------------

test('each rule has a severity in lint-rules.mjs, and an unknown rule is refused', () => {
	assert.deepEqual(['fail-missing-fields', 'verify-no-shot', 'shot-cited-twice', 'shot-no-step', 'shot-retaken', 'shot-out-of-order', 'shot-missing', 'session-id', 'log-backdated', 'log-unstamped'].filter(r => LINT_RULES[r] !== 'error'), []);
	assert.deepEqual(['repeated-action', 'two-actions', 'verify-acts', 'step-starts-with', 'result-too-long', 'title-hedge', 'judgment-word', 'reference-in-observed', 'too-many-shots', 'tried-once', 'result-length'].filter(r => LINT_RULES[r] !== 'warning'), []);
	assert.throws(() => problem('no-such-rule', 'text'), /unknown lint rule: no-such-rule/);
});

test('errors are what makes a repro or its evidence wrong; wording, length and a single try are warnings', () => {
	// A Log-less FAIL, a semicolon in Observed, a two-action step and a long failed Result.
	const json = report(f => {
		f.steps[0].text = 'Click Retry, then click Reload.';
		f.observed = 'The panel is empty; nothing loads.';
	});
	const ledger = LEDGER.replace('   Log: none found in logs/r.log\n', '').replace('Result: Fails 2/2', 'Result: Retry leaves the panel empty');
	const { errors, warnings } = split(lintRaw(json, ledger));
	assert.deepEqual(errors, ['ledger: S02 step 2 FAIL is missing Log:']);
	assert.deepEqual(warnings, [
		'report: Finding 1 observed joins notes with a semicolon; write it as sentences',
		'report: Finding 1 step 1 is two actions ("then click"); write each as its own step',
		'ledger: S02 Result: of a failed scenario is its rate only, "Fails N/M"; the finding says what broke',
	]);
	// Rating a finding lower must not be the way past an error.
	assert.deepEqual(split(lintRaw(report(f => { f.severity = 'major'; f.reproduced = { n: 1, m: 1 }; })).filter(p => p.rule === 'tried-once')).errors, []);
	// A backdated actions.log is an error in the report check and the mid-run check alike.
	const at = s => `2026-10-05T03:59:${s}Z shot.sh -s=p: screenshot S01-01.png`;
	const backdated = [at(24), at(16)].join('\n');
	assert.equal(split(lintRaw(report(), LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
	assert.equal(split(ledgerLint.lintLedgerOnly(LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
	// With the run's session, a line under another name is a warning, mid-run and at the end; its replay's name is its own.
	const driven = ['et-ab12', 'et-ab12-replay', 'positron'].map((name, i) => `2026-10-05T04:00:0${i}Z ui.sh -s=${name}: click Run`).join('\n');
	const sessions = run => split(run).warnings.filter(p => /Playwright session/.test(p));
	assert.deepEqual(sessions(ledgerLint.lintLedgerOnly(LEDGER, { fileExists: () => true, actionsLog: driven, session: 'et-ab12' })), ['actions.log: line 3 drove Playwright session "positron", not this run\'s "et-ab12" or a name starting "et-ab12-"; another run on this machine may own that window, so check what those lines read, and use your own session from here']);
	assert.equal(sessions(lintRaw(report(), LEDGER, { fileExists: () => true, actionsLog: driven, session: 'et-ab12' })).length, 1);
	assert.deepEqual(sessions(ledgerLint.lintLedgerOnly(LEDGER, { fileExists: () => true, actionsLog: driven })), [], 'no session given, as in CI: not checked');
	// A shot retaken before the next check is a warning; retaken after it, an error.
	const ledger3 = ['## S01 - x', 'Status: pass', '', 'Steps:', '1. VERIFY a -> PASS', '   Evidence: S01-01.png', '2. VERIFY b -> PASS', '   Evidence: S01-02.png', '3. VERIFY c -> PASS', '   Evidence: S01-03.png', ''].join('\n');
	const shots = names => names.map((n, i) => `20:00:0${i}Z shot.sh -s=p: screenshot ${n}`).join('\n');
	assert.deepEqual(split(ledgerLint.lintShotTiming(ledger3, shots(['S01-01.png', 'S01-02.png', 'S01-02.png', 'S01-03.png']))).errors, []);
	assert.ok(split(ledgerLint.lintShotTiming(ledger3, shots(['S01-01.png', 'S01-02.png', 'S01-03.png', 'S01-02.png']))).errors.length >= 1);
});

test('render.mjs --check checks a ledger alone without counting it, and lint-json fails on errors only', () => withTmpDir('lint-check-', dir => {
	const run = (script, file, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), join(dir, file), ...args], { encoding: 'utf8' });
	mkdirSync(join(dir, 'shots'));
	mkdirSync(join(dir, 'logs'));
	for (const f of ['shots/a.png', 'shots/p.png', 'logs/r.log']) { writeFileSync(join(dir, f), 'x'); }
	writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('Result: Fails 2/2', 'Result: Retry leaves the panel empty'));
	// No report yet: the ledger alone, with a warning only.
	const early = run('../render.mjs', 'ledger.md', '--check');
	assert.equal(early.status, 0, early.stderr);
	assert.match(early.stderr, /format warnings[^\n]*\n {2}ledger: S02 Result: of a failed scenario/);
	assert.ok(!existsSync(join(dir, 'format-checks.jsonl')), 'a mid-run ledger check is not the report\'s first check');
	writeFileSync(join(dir, 'ledger.md'), LEDGER);
	writeFileSync(join(dir, 'report.json'), JSON.stringify(report()));
	const clean = run('../lint-json.mjs', 'report.json');
	assert.equal(clean.status, 0, clean.stdout);
	writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('   Log: none found in logs/r.log\n', ''));
	const failed = run('../lint-json.mjs', 'report.json');
	assert.equal(failed.status, 1);
	assert.match(failed.stdout, /errors[^\n]*\n {2}ledger: S02 step 2 FAIL is missing Log:/);
}));

// ---- Scenes ----------------------------------------------------------------

const KNOWN = { issues: [
	{ number: 10, relation: 'fixes' },
	{ number: 11, relation: 'fixes' },
	{ number: 20, relation: 'linked' },
	{ number: 21, relation: 'linked', state: 'closed' },
] };
const lintKnown = ledger => lint(report(), ledger, { fileExists: () => true, knownIssues: KNOWN });
const withIssues = (s01, s02, notRun = '') => LEDGER
	.replace('Result: loads\n', `Result: loads\n${s01}`)
	.replace('Result: Fails 2/2\n', `Result: Fails 2/2\n${s02}`)
	.replace('- N01 - web build - no server\n', `- N01 - web build - no server\n${notRun}`);
const SHOTS_LEDGER = ['## S01 - x', 'Status: pass', '', 'Steps:', '1. VERIFY a -> PASS', '   Evidence: S01-01.png', '2. Click B.', '3. VERIFY b -> PASS', '   Evidence: S01-02.png', '', '## S02 - y', 'Status: pass', '', 'Steps:', '1. VERIFY c -> PASS', '   Evidence: S02-01.png', ''].join('\n');
const shotLog = (...names) => names.map((n, i) => `20:00:0${i + 1}Z shot.sh -s=p: screenshot ${n}`).join('\n');
const REPRO_LEDGER = ['# Test ledger', '',
	'## S01 - Panel loads', 'Status: pass', 'Result: loads', '', 'Steps:', '1. VERIFY it loads -> PASS', '   Evidence: p.png', '',
	'## S02 - Retry', 'Status: fail - Finding 1', 'Result: Fails 2/2', '', 'Steps:', '1. VERIFY the button shows -> PASS', '   Evidence: r1.png', '2. VERIFY it loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: r2.png', '',
	'## S03 - Retry in Python', 'Status: fail - Finding 1', 'Result: Fails 2/2', '', 'Steps:', '1. VERIFY the Python panel loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: o1.png', ''].join('\n');
const reproSteps = (...checks) => report(f => {
	f.steps = checks.map(([text, result], k) => ({ kind: 'verify', text, result, ...(result === 'fail' ? { finding: 1 } : {}), shots: [`shots/s${k}.png`] }));
	f.evidence = [];
});
const twoFindings = n2 => ['# Test ledger', '',
	'## S01 - x', 'Status: fail - Finding 1', 'Result: Fails 1/1', '', 'Steps:', '1. VERIFY dates read right -> FAIL - Finding 1', '   Observed: x', '   Evidence: S01-01.png', '   Log: none found', '',
	'## S02 - y', `Status: fail - Finding ${n2}`, 'Result: Fails 1/1', '', 'Steps:', `1. VERIFY structs read right -> FAIL - Finding ${n2}`, '   Observed: y', '   Evidence: S01-01.png', '   Log: none found', ''].join('\n');
const stepShots = (cited, extra = []) => edited(f => {
	f.steps[1].shots = cited.map(c => `shots/${c}`);
	f.evidence = extra.map(([file, caption]) => ({ kind: 'shot', path: `shots/${file}`, step: 2, caption }));
});
const captioned = (scenario, edit = () => { }) => edited(f => {
	f.steps[1].shots = [];
	f.evidence = [{ kind: 'shot', path: 'shots/a.png', scenario, caption: 'empty panel' }];
	edit(f);
});
const stamp = (s, text = 'shot.sh -s=p: screenshot S01-01.png') => `2026-10-05T03:59:${String(s).padStart(2, '0')}Z ${text}`;
const words = n => Array.from({ length: n }, () => 'word').join(' ');

test('every lint scene gives what it gave before', () => checkScenes('lint-scenes.expected.txt', {
	// The report as a whole.
	'a report written to the format is clean': () => [...lint(), ...lintReportJson(report(), LEDGER), ...schemaProblems(report())],
	'without a ledger, the ledger checks are skipped': () => lint(report(), undefined),
	'a missing or overlong impact': () => [
		...edited(f => { delete f.impact; }),
		...edited(f => { f.impact = `${words(51)}.`; }),
		...edited(f => { f.impact = 'Few hit it. It needs a renamed file. Reopening fixes it.'; }),
	],
	'a two-sentence impact within the limit is clean': () => edited(f => { f.impact = `Anyone who clicks Retry stays stuck. ${words(40)}.`; }),
	'the schema names a missing Feature, notExercised or rate, and a step shot outside shots/': () => [
		...schemaProblems(report(f => { delete f.feature; })), ...schemaProblems(report((f, r) => { delete r.header.notExercised; })),
		...['$U/a.png', 'https://cdn.example/run/shots/a.png'].flatMap(t => schemaProblems(report(f => { f.steps[1].shots = [t]; }))),
	],
	'a severity outside the allowed words and a missing rate': () => edited(f => { f.severity = 'High'; delete f.reproduced; }),
	'a Feature in code, not as a user sees the area': () => each(feature => edited(f => { f.feature = feature; }), ['PositronDynamicModalDialog', 'columnProfileInteger.tsx', '`dataExplorer`', 'new folder flow']),
	'a question-shaped Result': () => edited((f, r) => { r.header.result = 'Yes, mostly.'; }),
	'a long Result, and a Cause whose first sentence runs on': () => [
		...edited((f, r) => { r.header.result = `${words(61)}.`; }),
		...edited(f => { f.cause = `The \`Retry\` handler ${words(38)}. Then \`a.ts:1\` has the detail.`; }),
		...edited(f => { f.cause = `The \`Retry\` handler ${words(37)}. Then \`a.ts:1\` has the detail.`; }),
	],
	'a pointer to another finding, an absolute citation and a compiled frame': () => [
		...step('Set up as Finding 2.'),
		...edited(f => {
			f.evidence.push({ kind: 'log', path: '/tmp/run/r.log', process: 'Renderer process', quote: 'x' });
			f.errors = [{ source: 'logs/r.log:1', message: 'Error: x', frames: [{ fn: 'f', path: 'out/vs/a.js', line: 1 }] }];
		}),
	],
	'a workspace path in Run details is not a citation': () => edited((f, r) => { r.header.details.push({ title: 'Workspace', body: 'Workspace `/tmp/exploratory-workspace`' }); }),
	'a cited shot not on disk': () => lint(report(), LEDGER, { fileExists: () => false }),
	'the verifier\'s reply is skipped, but a finding pointing at another is not': () => [
		...lint(applyVerification(report(), parseVerifyReply('```json\n{ "findings": [{ "n": 1, "verdict": "confirmed" }] }\n```\n\n- 3. Same as Finding 1: a note from the verifier, citing S02.'))),
		...step('Same as Finding 1: click Retry.'),
	],
	'a test file not in the repository, but not one marked new': () => {
		const json = report(f => {
			f.tests = {
				cases: [{ text: 'Retry loads the panel.', level: 'unit', path: 'src/a.test.ts', isNew: false }, { text: 'A new case.', level: 'e2e', path: 'test/e2e/tests/b.test.ts', isNew: true }],
				related: [{ path: 'src/c.test.ts', level: 'unit', note: 'request shape' }],
			};
		});
		return [...lint(json, LEDGER, { fileExists: () => true, repoFileExists: p => p === 'src/a.test.ts' }), ...lint(json)];
	},
	'a precondition about a file that does not exist does not ask for it to be saved': () => each(t => pre(t, 'db'), ['`missing.sqlite` does not exist in the workspace', '`missing.sqlite` in the workspace']),

	// Titles, Observed and Expected.
	'a title that starts lowercase or names code, but not a lowercase package name': () => each(title, ['a package installed from the console is missing', 'R doubles are formatted by Rust f64::to_string', 'polars integer Min/Max shows only the leading digits', 'Attached state stays stale after `library()` until Refresh', 'Help for `dplyr::filter` lands on the stats page']),
	'a hedged title': () => each(title, ['Retry seems to do nothing', 'Retry may leave the panel empty', 'Retry does nothing']),
	'a possessive, a parenthetical and a code name in a title': () => each(title, ['Paused columns\' tooltip is wrong', 'Retry does nothing (after a reload)', 'TableSummaryCache never clears', 'The quartoNotebookUri is lost on reload', 'Plots on macOS lose `TableSummaryCache` on GitHub "Users\' (1)" reload']),
	'an Observed or Expected that runs past its sentences': () => each(pair, [['The panel is empty. Retry shows the same. After a reload it loads.', 'The panel loads. Retry reloads it.'], ['One. Two. Three. Four.', 'One. Two. Three.']]),
	'an editorial Observed': () => edited(f => { f.observed = 'The panel incorrectly stays empty.'; }),
	'an Observed written as notes, with the reference in it, or a number written two ways': () => each(pair, [
		['The `n` column, whose largest value is 1,500, shows Max 1.', '`n` shows Max 1,500, as pandas shows for the same data.'],
		['Max 1 for 1,500; Min 1 for 1,234,567.', 'Max 1,500.'],
		['`n` shows Max 1. pandas shows Max 1,500.', 'Max 1,500.'],
		['`n` shows Max 1, where R also gives 1,500.', 'Max 1,500.'],
		['`pop` shows Min 1.', 'Min 1,234,567, as pandas shows 1234567.'],
		['`pop` shows Max 12300000.', 'Max 12,345,678.'],
		['Running `a; b` shows Max 1.', 'Max 1,500.'],
	]),
	'a backend named as what was tested is not a reference': () => each(pair, [
		['Typing `Frameworks` hides the R 4.5.1 session and leaves only `New Console Session...`.', 'The R 4.5.1 session stays listed.'],
		['The mouse wheel stops at the R row of the setup card.', 'The page scrolls to its end.'],
		['After the R language section expands, scrolling stops where the page used to end.', 'The page scrolls to its end.'],
	]),
	'prose names no scenario ID, but code and an Evidence caption may': () => [
		...pair('The panel stays empty.', 'The panel loads, as it did after Restart Kernel (S05, S06).'),
		...pair('The panel stays empty, unlike N01.', 'The panel loads.'),
		...title('Retry does nothing in S03'),
		...pair('The panel stays empty in `S05`, see shots/S06-01.png.', 'The panel loads.'),
		...edited(f => { f.evidence.push({ kind: 'shot', path: 'shots/b.png', step: 2, caption: 'S06 left it empty again after a restart' }); }),
	],
	'a moderate or major finding tried once': () => each((severity, n, m) => edited(f => { f.severity = severity; f.reproduced = { n: Number(n), m: Number(m) }; }), [['moderate', '1', '1'], ['major', '1', '1'], ['minor', '1', '1'], ['moderate', '1', '2']]),

	// Preconditions.
	'a precondition done in the app, in the report': () => each(pre, ['`app.R` started with its Run Shiny App button', '`flask_app.py` running, then opened in an editor tab', 'A Shiny console in which Run Shiny App started `shiny_app.R`', 'A Python 3.12 console, which Positron starts on launch', 'a Python with polars is selected', '`slow.py` loaded', '`p1_setup.py` run in the first Python session', 'A Python 3.12 venv to run in', '`notes` open in the Data Explorer, then dropped from the R console', '`orders` open in the Data Explorer, then a row inserted from the console', '`race.sh`, which clicks Run, then presses Enter at once']),
	'a precondition done in the app, in the ledger, where the third field may say how a scenario made it': () => each(row => ledgerOnly('Status: fail - Finding 1\n', `Status: fail - Finding 1\n\nPreconditions:\n- ${row}\n`), [
		'Variables loaded | S01 | `setup.py` run in the first Python session', 'app running | `app.R` started with Run Shiny App',
		'`pd_ints` in the session | S01 | Defined in the Python console by S01 (files/ints.py)', 'R console | S03 | The R console started in S03',
		'expired cache | S02 | S02\'s profile after Positron quit, every firstSeen moved back 40 days by `files/backdate.py`',
	]),
	'a precondition that is a scratch path, a running app, "the run\'s" or state shown in the app': () => each(t => pre(t, 'State'), [
		'the workspace `/private/tmp/et-viewer-mwIP` with `app.R`', 'a workspace with `files/ws/app.R`',
		'the app from `shiny_app.R` serving on port 56934 in an R Shiny console', 'Python 3.12.11 in the run\'s venv with shiny 1.8.0 installed', 'Python 3.12 with shiny 1.8.0',
		'`app.py` that calls `app.run(port=5057)`', 'any URL shown in the Viewer, here the R Shiny app', 'the R Shiny app running in its Shiny console',
	]),
	'a precondition that says how an earlier scenario made its state, in a user\'s words': () => each(t => pre(t, 'Made earlier'), [
		'An R 4.5.1 console, started with Start New Console Session', 'A `Shop` SQLite connection saved from the Add Data Connection dialog',
		'A `conn` in the Python console, made by Connect With Python', '`orders` open in the Data Explorer, opened in S02',
	]),
	'a precondition that points at a step': () => each(t => pre(t, 'polars'), ['Python 3.12 with the polars version installed in step 2', 'Python 3.12 with polars 1.9.0']),
	'a precondition that runs a command': () => each(t => pre(t, '`slow.py` loaded'), ['`slow.py` loaded with `%run -i slow.py`', '`debug.R` sourced with `source("debug.R")`', '`debug_demo.R`, which defines `outer_fn()`', '`py.qmd` whose cell prints `tick 0` to `tick 4`']),

	// Steps.
	'a step that only waits, or waits a fixed time without saying why': () => ({
		...each(step, ['Wait for the Python console to start.', 'Run `x` and wait for the plot to appear.', 'Run `Interpreter: Discover All Interpreters` and wait 30 seconds.', 'Click Start Session and wait for it to be ready.', 'Wait about 40 s, well past the 8 s the cell takes.', 'Wait 9 s without answering the toast.', 'Press Cmd+Shift+0 and wait 10 s for `R 4.5.1 restarted.`.']),
		'(a VERIFY) after waiting 5s the panel loads': edited(f => { f.steps[1].text = 'after waiting 5s the panel loads'; }),
	}),
	'a report step joined by "and" or a semicolon, done to several targets, naming a scratch path or carrying a run note': () => each(step, [
		'Run `Interpreter: Start New Console Session` and pick R 4.5.1.', 'Type `x`, and press Enter.', 'Open the file; close it.', 'Click the expand chevron on each of the four columns.',
		'Run `a; b` in the console, and wait for the prompt.', 'Click Rows and Columns.', 'Open `/private/tmp/et-ws/app.R`.', 'Open `files/ws/app.R`.',
		'Click Retry (S05 ran this together with two other values).', 'Run `S05 = 1`.', 'Click Retry twice.',
	]),
	'a ledger step is one action, with no repeat count, second action, assumed state, session ID or scenario name': () => ({
		...each(t => inLedger('1. Open it.', `1. ${t}`), ['Click Step Over in the debug toolbar.', 'Run `print("x"); print("y")` in the Python console and wait for it to finish.', 'Click More cell actions on cell 2, then Insert Cell Above.', 'Run `for (i in 1:3) print("3 times")` in the R console.', 'Click Step Over three times.', 'Press Cmd+Enter twice.', 'Run `View: Close Editor`, then open `a.qmd` again.', 'With the console open, run `x`.', 'Click the python-4cddf9ca tab.']),
		...each(t => ledgerOnly('1. Click Retry.', `1. ${t}`), ['Press Enter to close the quick pick S05 left open.', 'Copy `files/settings.S08.json` to the user settings.']),
		'(a VERIFY) it loads, then shows twice': inLedger('2. VERIFY it loads -> PASS', '2. VERIFY it loads, then shows twice -> PASS'),
	}),
	'a Command Palette row picked with no step that opens the palette': () => each((...texts) => edited(f => { f.steps = [...texts.map(text => ({ kind: 'action', text })), f.steps[1]]; }), [
		['Click the `Workspaces: New Folder from Template...` row in the Command Palette.'],
		['Open the Command Palette and type `New Folder`.', 'Click the `Workspaces: New Folder from Template...` row in the Command Palette.'],
	]),
	'steps that start from an earlier scenario\'s state: only checks, or an Escape first': () => each(s => ledgerOnly('1. Click Retry.\n2. VERIFY it loads', s), ['1. VERIFY it loads', '1. Press Escape.\n2. Click Retry.\n3. VERIFY it loads', '1. Click Retry.\n2. Press Escape.\n3. VERIFY it loads']),
	'a check repeated after the same actions, but not a recovery or a check after a new action': () => each(s => ledgerOnly('1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1', s), [
		'1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Click Retry.\n4. VERIFY it loads -> FAIL - Finding 1',
		'1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Reconnect the network.\n4. Click Retry.\n5. VERIFY it loads -> PASS',
		'1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Reload the window.\n4. VERIFY it loads -> FAIL - Finding 1',
	]),
	'a VERIFY is only the check, with the actions before it as steps of their own': () => ({
		...each(t => inLedger('2. VERIFY it loads -> PASS', `2. VERIFY ${t} -> PASS`), [
			'the `n` profile shows Min 5; Max 1500', 'Enter creates the folder (Create is enabled)', 'focus moves to a footer button', 'The dialog closes, focus is back in the editor',
			'the namespace holds only In, Out, exit, help, open and quit', 'the plot still shows the status line (check mark, run time) from its last run', 'Tables lists blobs, customers, select and wide',
			'`n` shows `n`, type int, with no chevron', 'the console prints `small big`, then `45`, and returns to a `>>>` prompt', 'the kernel is running',
			'In the summary panel, type `n` in the column filter and expand the `n` profile; it shows Min 5', 'Typing `n` in the summary column filter and expanding `n` shows Min 5',
			'after running `del df["num"]`, all 10 rows show', 'clicking Console Information shows "Start Reason"', 'the console prints `[1] 2`, and hovering the breakpoint shows "Unverified Breakpoint"',
			'the pane shows a plot after clicking Show Next Plot',
		]),
		'(the report) clicking Retry loads the panel': edited(f => { f.steps[1].text = 'clicking Retry loads the panel'; }),
	}),

	// The ledger's scenarios.
	'a failed step whose finding is not the one its Status names': () => lint(report(), ['# Test ledger', '', '## S01 - Values', 'Status: fail - Finding 1', 'Result: fails', '', 'Steps:', '1. VERIFY a reads right -> FAIL - Finding 1', '   Observed: x', '   Evidence: a.png', '   Log: none found', '2. VERIFY b reads right -> FAIL - Finding 2', '   Observed: y', '   Evidence: b.png', '   Log: none found', ''].join('\n')),
	'a ledger Result longer than one short sentence, and a failed scenario\'s Result that is not its rate': () => ({
		...each(t => inLedger('Result: loads', `Result: ${t}`), ['The panel loads with every row.', 'The panel loads. Restart went ahead without an answer.', `The panel loads ${'and keeps going '.repeat(10)}to the end`]),
		...each(t => inLedger('Result: Fails 2/2', `Result: ${t}`), ['Fails 2/2', 'Retry leaves the panel empty']),
	}),
	'a FAIL without Log:, a pass without a screenshot and a bad Status': () => lint(report(), LEDGER.replace('   Log: none found in logs/r.log\n', '').replace('   Evidence: p.png\n', '').replace('Status: fail - Finding 1', 'Status: failed')),
	'a Status naming a finding the report does not have, and a Not exercised with no Not run': () => [...inLedger('Status: fail - Finding 1', 'Status: fail - Finding 3'), ...lint(report(), LEDGER.replace(/## Not run\n.*\n/, ''))],
	'the ledger alone is checked mid-run': () => [...lintLedgerOnly(LEDGER, { fileExists: () => true }), ...lintLedgerOnly(LEDGER.replace('   Log: none found in logs/r.log\n', ''), { fileExists: () => true })],
	'a repro is one scenario\'s steps, and that scenario failed for the finding': () => [
		...lintReportJson(reproSteps(['the button shows', 'pass'], ['it loads', 'fail']), REPRO_LEDGER),
		...lintReportJson(reproSteps(['the button shows', 'pass'], ['the Python panel loads', 'fail']), REPRO_LEDGER),
		...lintReportJson(reproSteps(['it loads', 'pass']), REPRO_LEDGER),
	],
	'the rate is the repro scenario\'s, plus retries the run logged as scenarios of their own': () => {
		const rate = (ledger, n = 2, m = 2) => lintReportJson(report(f => { f.reproduced = { n, m }; }), ledger);
		const once = LEDGER.replace('Result: Fails 2/2', 'Result: Fails 1/1');
		const retried = once.replace('## Not run', '## S03 - Retry, second try\nStatus: fail - Finding 1\nResult: Fails 1/1\n\nSteps:\n1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n   Evidence: b.png\n\n## Not run');
		return [...rate(LEDGER), ...rate(once), ...rate(retried), ...rate(retried, 3, 3)];
	},

	// Screenshots and Evidence.
	'every VERIFY needs its own screenshot': () => [...inLedger('   Evidence: p.png\n', '   Evidence: p.png\n3. VERIFY the header shows -> PASS\n'), ...inLedger('Evidence: p.png', 'Evidence: a.png')],
	'Evidence: counts only a file in shots/': () => [...lint(report(), LEDGER.replace(/Evidence: [ap]\.png/g, 'Evidence: none; DOM read only')), ...lint(report(), LEDGER.replace('Evidence: p.png', 'Evidence: shots/made-up.png'), { fileExists: f => f === 'shots/a.png' })],
	'a saved output or an actions.log reading sits beside a check\'s screenshot, never in place of it': () => [
		...lint(report(), '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY port 8000 is closed -> PASS\n   Evidence: logs/listeners-after.txt\n2. VERIFY the notebook saves its outputs -> PASS\n   Evidence: files/saved.ipynb\n3. VERIFY the file says 1 -> PASS\n   Evidence: S01-01.png, logs/missing.txt\n4. VERIFY the notebook saves its outputs -> PASS\n   Evidence: S01-02.png, files/saved.ipynb\n', { fileExists: p => p !== 'logs/missing.txt' }),
		...lintLedgerOnly('# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY cell 4 fails with NameError -> PASS\n   Evidence: actions.log:5\n2. VERIFY cells 1 to 9 each show their output -> PASS\n   Evidence: S01-01.png, actions.log:41, actions.log:44\n3. VERIFY the file says 1 -> PASS\n   Evidence: none, read in the console\n', { fileExists: () => true }),
	],
	'a file under a mirrored folder is found by its bare name, and a long extension is kept': () => lint(report(f => { f.preconditions = [{ name: 'app', text: '`app.R` in the `rapp` folder of the workspace' }]; }), '# Test ledger\n\n## Files\n- files/rapp/app.R | app | S01; Finding 1\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY rows -> PASS\n   Evidence: logs/S01-products.parquet\n', { fileExists: p => ['files/rapp/app.R', 'logs/S01-products.parquet', 'shots/a.png'].includes(p), listFiles: () => ['files/rapp/app.R'] }),
	'one screenshot may serve failed checks of two different findings, and nothing else': () => each(n2 => lint(report(), twoFindings(Number(n2))), ['2', '1']),
	'a log line credited to another process than the one whose log file it is in': () => ({
		'ledger, supervisor log as the extension host': ledgerOnly('   Log: none found in logs/r.log', '   Log: logs/34353-supervisor.log:515 | Extension host | 1x (01:48:02)\n     Child process exited with status: signal: 9 (SIGKILL)'),
		'ledger, renderer log as the renderer': ledgerOnly('   Log: none found in logs/r.log', '   Log: logs/1-renderer.log:5 | Renderer | 1x\n     Error: x'),
		'report, exthost log as the main process': edited(f => { f.evidence.push({ kind: 'log', path: 'logs/1-exthost.log:5', process: 'Main process', quote: 'x' }); }),
		'report, a log whose name says nothing': edited(f => { f.evidence.push({ kind: 'log', path: 'logs/python-kernel.log:5', process: 'Extension host', quote: 'x' }); }),
	}),
	'Evidence holds Positron log lines only: no notes, no agent files': () => [
		...edited(f => { f.evidence.push({ kind: 'log', path: 'logs/1-exthost.log:5', process: 'Extension host', when: '00:18:39', quote: 'env change ==/x== remove' }, { kind: 'missing', path: 'logs/1-exthost.log', window: '00:18:39-00:19:24', quote: 'env change /x add' }); }),
		...edited(f => { f.evidence.push({ kind: 'note', caption: 'so nothing resolved the new path' }, { kind: 'log', path: 'actions.log:12', quote: 'click failed' }, { kind: 'log', path: 'logs/S03-later.txt', quote: 'saved' }); }),
	],
	'a finding screenshot that names no step on the card': () => each(s => edited(f => { f.steps[1].shots = []; f.evidence = [{ kind: 'shot', path: 'shots/a.png', caption: 'empty panel', ...(s === 'none' ? {} : { step: Number(s) }) }]; }), ['none', '3', '2']),
	'a step with more than two screenshots, or a second that repeats the first': () => [
		...stepShots(['a.png']), ...stepShots(['a.png', 'b.png'], [['b.png', 'still empty 15 s later']]), ...stepShots(['a.png', 'b.png']),
		...stepShots(['a.png', 'b.png', 'c.png'], [['b.png', 'later'], ['c.png', 'pandas loads']]),
		...stepShots(['a.png', 'b.png'], [['b.png', 'later'], ['c.png', 'a second restart left it empty again']]),
	],
	'a caption may name the scenario that took the shot instead of a step': () => ({
		...each(captioned, ['S02', 'S01', 'S09']),
		'S02, with no failing step on the card': captioned('S02', f => { f.steps[1].result = 'pass'; delete f.steps[1].finding; }),
	}),
	'a cited screenshot actions.log never took by that name': () => {
		const ledger = '## S01 - x\nStatus: pass\n\nSteps:\n1. VERIFY a -> PASS\n   Evidence: S01-02.png, S01-02b.png\n2. VERIFY b -> PASS\n   Evidence: shots/S01-04.png\n';
		const log = '20:00:01 screenshot S01-02\n20:00:02 playwright screenshot --filename=/r/shots/S01-02b.png\n20:00:03 screenshot S01-03.png\n';
		return [...lintShotNames(ledger, log), ...lintShotNames(ledger, `${log}20:00:04 renamed S01-03.png to S01-04.png\n`)];
	},
	'a cited shot is the one taken at its check: taken once, and in step order': () => each((...names) => lintShotTiming(SHOTS_LEDGER, shotLog(...names)), [
		['S01-01.png', 'S01-02.png', 'S02-01.png'], ['S02-01.png', 'S01-01.png', 'S01-02.png'],
		['S01-02.png', 'S01-01.png', 'S02-01.png'], ['S01-01.png', 'S01-02.png', 'S01-01.png', 'S02-01.png'],
	]),
	'a shot taken twice: a warning when its last capture falls at its check, an error when not': () => {
		const ledger = ['## S01 - x', 'Status: pass', '', 'Steps:', '1. VERIFY a -> PASS', '   Evidence: S01-01.png', '2. VERIFY b -> PASS', '   Evidence: S01-02.png', '3. VERIFY c -> PASS', '   Evidence: S01-03.png', ''].join('\n');
		return each((...names) => lintShotTiming(ledger, names.map((n, i) => `20:00:0${i}Z shot.sh -s=p: screenshot ${n}`).join('\n')), [['S01-01.png', 'S01-02.png', 'S01-02.png', 'S01-03.png'], ['S01-01.png', 'S01-02.png', 'S01-03.png', 'S01-02.png']]);
	},
	'a shot named for another scenario means the scenarios were renumbered': () => lintLedgerOnly('# Test ledger\n\n## S05 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. Click Run.\n2. VERIFY it runs -> PASS\n   Evidence: S06-01.png\n3. VERIFY it stays -> PASS\n   Evidence: S05-02.png\n', { fileExists: () => true }),

	// actions.log.
	'actions.log is append-only: every line stamped as the helpers stamp it, in time order': () => ({
		'in order, with a blank line': lintActionsLog([stamp(1), stamp(2), '', stamp(2), stamp(30)].join('\n') + '\n'),
		'two helpers a second apart': lintActionsLog([stamp(2), stamp(1)].join('\n')),
		'a missed Escape backdated below later lines': lintActionsLog([stamp(16), stamp(24), '2026-10-05T03:58:25Z raw press Escape [logged afterwards]', stamp(40)].join('\n')),
		'several lines out of order': lintActionsLog([stamp(50), stamp(1), stamp(2), stamp(3), stamp(4)].join('\n')),
		...each(line => lintActionsLog([stamp(1), line].join('\n')), ['22:39:56 rec.sh start', '2026-10-04 21:08:55 shell: made a venv', '2026-10-04T17:46:26 shell: copied files', '  at frame (x.js:1)']),
	}),

	// Issues linked to the PR.
	'a ledger that accounts for every linked issue is clean': () => [
		...lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 observed\n', 'Issue: #11 fix did not hold\nIssue: #21 came back\n')),
		...lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 observed\n', 'Issue: #11 fix didn\'t hold\nIssue: #21 came back\n')),
		...lintKnown(withIssues('Issue: #10 fix held\n', '', '- N02 - x - Fix for #11 not exercised: web only\n- N03 - y - Already filed as #20\n')),
		...lintKnown(withIssues('Issue: #10 fix held\n', 'Issue: #11 fix held\n')),
	],
	'Issue lines that do not match the list': () => lintKnown(withIssues('Issue: #10 held\nIssue: #99 observed\nIssue: #20 fix held\n', 'Issue: #10 observed\nIssue: #11 fix did not hold\n')),
	'a linked issue gets no "fix held"': () => lintKnown(withIssues('Issue: #10 fix held\nIssue: #21 fix held\nIssue: #20 fix held\n', 'Issue: #11 fix held\n')),
	'a fix that did not hold on a passing scenario, and a fix the ledger never mentions': () => lintKnown(withIssues('Issue: #10 fix did not hold\n', '')),
	'a closed issue recorded as observed, an open one that came back, and a regression on a passing scenario': () => lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 came back\nIssue: #21 came back\n', 'Issue: #11 fix held\nIssue: #21 observed\nIssue: #10 came back\n')),
	'a Not run row that names the wrong kind of issue': () => lintKnown(withIssues('Issue: #10 fix held\n', 'Issue: #11 fix held\n', '- N02 - x - Already filed as #10\n')),
	'Issue lines are not checked without a known-issues list': () => lint(report(), withIssues('Issue: #99 observed\n', '')),
}));
