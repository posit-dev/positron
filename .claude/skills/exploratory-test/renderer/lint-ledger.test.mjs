/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ledgerLint from './lint-ledger.mjs';
import { formatProblems, lintReportJson as lintReportJsonRaw, schemaProblems } from './lint-json.mjs';
import { LINT_RULES, problem, splitProblems } from './lint-rules.mjs';

const texts = ps => ps.map(p => p.text);
const split = ps => { const { errors, warnings } = splitProblems(ps); return { errors: texts(errors), warnings: texts(warnings) }; };
const lintActionsLog = (...a) => texts(ledgerLint.lintActionsLog(...a));
const lintLedgerOnly = (...a) => texts(ledgerLint.lintLedgerOnly(...a));
const lintShotNames = (...a) => texts(ledgerLint.lintShotNames(...a));
const lintShotTiming = (...a) => texts(ledgerLint.lintShotTiming(...a));
const lintReportJson = (...a) => texts(lintReportJsonRaw(...a));
import { applyVerification, parseVerifyReply } from './finish.mjs';

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


test('a report written to the format is clean', () => {
	assert.deepEqual(lint(), []);
	assert.deepEqual(lintReportJson(report(), LEDGER), []);
	assert.deepEqual(schemaProblems(report()), []);
});

test('flags a finding with no Feature, and a Feature named in code rather than as a user sees the area', () => {
	assert.deepEqual(schemaProblems(report(f => { delete f.feature; })), ['report.findings[0].feature is missing']);
	const problem = feature => `report: Finding 1 feature "${feature}" is a code or file name; name the area as a user sees it, such as "data explorer" or "new folder flow"`;
	for (const feature of ['PositronDynamicModalDialog', 'columnProfileInteger.tsx', '`dataExplorer`']) {
		assert.deepEqual(lint(report(f => { f.feature = feature; })), [problem(feature)]);
	}
	assert.deepEqual(lint(report(f => { f.feature = 'new folder flow'; })), []);
});

test('skips the opening the edit pass writes', () => {
	assert.deepEqual(lint(report(f => { f.summary = 'When you click Retry, nothing happens.'; f.where = 'Web only, as in S05.'; })), []);
});

test('flags an Observed or Expected that runs past its sentences', () => {
	const pair = (observed, expected) => lint(report(f => { f.observed = observed; f.expected = expected; }));
	// Observed gets one more, for a fact the run saw such as a workaround.
	assert.deepEqual(pair('The panel is empty. Retry shows the same. After a reload it loads.', 'The panel loads. Retry reloads it.'), []);
	assert.deepEqual(pair('One. Two. Three. Four.', 'One. Two. Three.'), [
		'report: Finding 1 observed is 4 sentences; keep it to 1-2, plus one for a fact such as no error shown or a workaround you saw work, and move the rest to the steps or evidence',
		'report: Finding 1 expected is 3 sentences; keep it to 1-2, and move the rest to the steps or evidence',
	]);
});

test('flags a question-shaped Result, and the schema a missing one', () => {
	assert.ok(lint(report((f, r) => { r.header.result = 'Yes, mostly.'; })).some(p => /header\.result answers a question/.test(p)));
	assert.deepEqual(schemaProblems(report((f, r) => { delete r.header.notExercised; })), ['report.header.notExercised is missing']);
});

test('flags a severity outside the allowed words and a missing rate', () => {
	const problems = lint(report(f => { f.severity = 'High'; delete f.reproduced; }));
	assert.equal(problems.filter(p => /Finding 1 (severity|reproduced) must/.test(p)).length, 2);
});

test('flags a failed step whose finding is not the one the scenario\'s Status names', () => {
	const ledger = [
		'# Test ledger', '',
		'## S01 - Values', 'Status: fail - Finding 1', 'Result: fails', '', 'Steps:',
		'1. VERIFY a reads right -> FAIL - Finding 1', '   Observed: x', '   Evidence: a.png', '   Log: none found',
		'2. VERIFY b reads right -> FAIL - Finding 2', '   Observed: y', '   Evidence: b.png', '   Log: none found', '',
	].join('\n');
	const mixed = lint(report(), ledger).filter(p => /Status names/.test(p));
	assert.deepEqual(mixed, ["ledger: S01 step 2 fails Finding 2 but the scenario's Status names Finding 1; give Finding 2's check a scenario of its own"]);
});

test('flags a title that starts lowercase or names code, but not a lowercase package name', () => {
	const titled = t => lint(report(f => { f.title = t; })).filter(p => /Finding 1 title/.test(p));
	assert.equal(titled('a package installed from the console is missing').length, 1);
	assert.equal(titled('R doubles are formatted by Rust f64::to_string').length, 1);
	assert.deepEqual(titled('polars integer Min/Max shows only the leading digits'), []);
	assert.deepEqual(titled('Attached state stays stale after `library()` until Refresh'), []);
	assert.deepEqual(titled('Help for `dplyr::filter` lands on the stats page'), []);
});

test('flags a precondition that is something done in the app, in the report and the ledger', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: 'app running', text: p }]; })).filter(x => /done in the app/.test(x));
	assert.deepEqual(pre('`app.R` started with its Run Shiny App button'), ['report: Finding 1 precondition "app running" is done in the app ("started with"); do it as a step, and keep the precondition to the state before step 1']);
	assert.deepEqual(pre('`flask_app.py` running, then opened in an editor tab'), ['report: Finding 1 precondition "app running" is done in the app ("then opened"); do it as a step, and keep the precondition to the state before step 1']);
	assert.deepEqual(pre('A Shiny console in which Run Shiny App started `shiny_app.R`'), ['report: Finding 1 precondition "app running" is done in the app ("Run Shiny App"); do it as a step, and keep the precondition to the state before step 1']);
	assert.deepEqual(pre('A Python 3.12 console, which Positron starts on launch'), []);
	// State stays a precondition; the command that loads a file is a step.
	assert.deepEqual(pre('a Python with polars is selected'), []);
	assert.deepEqual(pre('`slow.py` loaded'), []);
	const ledger = LEDGER.replace('Status: fail - Finding 1\n', 'Status: fail - Finding 1\n\nPreconditions:\n- app running | `app.R` started with Run Shiny App\n');
	assert.deepEqual(lintLedgerOnly(ledger).filter(x => /done in the app/.test(x)), ['ledger: S02 precondition "app running" is done in the app ("started with"); do it as a step, and keep the precondition to the state before step 1']);
});

test('flags a precondition that names a scratch path, and a step that only waits', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: 'Workspace', text: p }]; })).filter(x => /names the path/.test(x));
	assert.deepEqual(pre('the workspace `/private/tmp/et-viewer-mwIP` with `app.R`'), ['report: Finding 1 precondition "Workspace" names the path /private/tmp/et-viewer-mwIP; name the workspace by what it holds ("A workspace with `app.R`"), and keep scratch paths in Run details']);
	assert.deepEqual(pre('a workspace with `files/ws/app.R`'), []);
	const step = s => lint(report(f => { f.steps[0].text = s; })).filter(x => /only waits/.test(x));
	assert.deepEqual(step('Wait for the Python console to start.'), ['report: Finding 1 step 1 only waits; merge the wait into the action it waits on, or, when the app does it on its own, make it a precondition: "A Python console, which Positron starts on launch"']);
	assert.deepEqual(step('Run `x` and wait for the plot to appear.'), []);
});

test('flags a precondition that is a running app, or says "the run\'s"', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: 'App', text: p }]; })).filter(x => /running app|the run's/.test(x));
	assert.deepEqual(pre('the app from `shiny_app.R` serving on port 56934 in an R Shiny console'), ['report: Finding 1 precondition "App" is a running app ("serving"); start it in the steps, with a check that it runs']);
	assert.deepEqual(pre('Python 3.12.11 in the run\'s venv with shiny 1.8.0 installed'), ['report: Finding 1 precondition "App" says "the run\'s", which the reader does not have; name the interpreter and package ("Python 3.12 with shiny 1.9.1")']);
	assert.deepEqual(pre('Python 3.12 with shiny 1.8.0'), []);
	assert.deepEqual(pre('`app.py` that calls `app.run(port=5057)`'), []);
});

test('flags a step that waits a fixed time, unless it says what it waits for or why the time matters', () => {
	const step = s => lint(report(f => { f.steps[0].text = s; })).filter(x => /fixed time/.test(x));
	assert.deepEqual(step('Run `Interpreter: Discover All Interpreters` and wait 30 seconds.'), ['report: Finding 1 step 1 waits a fixed time ("wait 30 seconds"); wait for what the app shows when it is done ("wait for the console prompt"), or say why the time matters ("wait 10 s, past the 5 s timeout")']);
	assert.deepEqual(step('Click Start Session and wait for it to be ready.'), []);
	// A time is kept when the step says why it matters: an absence, a timeout, a race.
	assert.deepEqual(step('Wait about 40 s, well past the 8 s the cell takes.'), []);
	assert.deepEqual(step('Wait 9 s without answering the toast.'), []);
	assert.deepEqual(step('Press Cmd+Shift+0 and wait 10 s for `R 4.5.1 restarted.`.'), []);
	const verify = lint(report(f => { f.steps[1].text = 'after waiting 5s the panel loads'; })).filter(x => /fixed time/.test(x));
	assert.deepEqual(verify, ['report: Finding 1 step 2 waits a fixed time ("waiting 5s"); wait for what the app shows when it is done ("wait for the console prompt"), or say why the time matters ("wait 10 s, past the 5 s timeout")']);
});

test('flags a step joined by "and" or a semicolon, or done to each of several targets', () => {
	const step = s => lint(report(f => { f.steps[0].text = s; })).filter(x => /two actions|repeats an action/.test(x));
	assert.deepEqual(step('Run `Interpreter: Start New Console Session` and pick R 4.5.1.'), ['report: Finding 1 step 1 is two actions ("and pick"); write each as its own step']);
	assert.deepEqual(step('Type `x`, and press Enter.'), ['report: Finding 1 step 1 is two actions (", and press"); write each as its own step']);
	assert.deepEqual(step('Open the file; close it.'), ['report: Finding 1 step 1 is two actions ("; close"); write each as its own step']);
	assert.deepEqual(step('Click the expand chevron on each of the four columns.'), ['report: Finding 1 step 1 repeats an action ("each of"); a step is one action, so write each one as its own step']);
	assert.deepEqual(step('Run `a; b` in the console, and wait for the prompt.'), []);
	assert.deepEqual(step('Click Rows and Columns.'), []);
});

test('flags a step that names a scratch path or, in the ledger, a scenario', () => {
	const step = s => lint(report(f => { f.steps[0].text = s; })).filter(x => /names the path/.test(x));
	assert.deepEqual(step('Open `/private/tmp/et-ws/app.R`.'), ['report: Finding 1 step 1 names the path /private/tmp/et-ws/app.R, which the reader does not have; name the file by its files/ path or what it holds']);
	assert.deepEqual(step('Open `files/ws/app.R`.'), []);
	const ledger = s => lintLedgerOnly(LEDGER.replace('1. Click Retry.', `1. ${s}`)).filter(x => /has no scenarios/.test(x));
	assert.deepEqual(ledger('Press Enter to close the quick pick S05 left open.'), ['ledger: S02 step 1 names S05; the step is copied into the finding, whose reader has no scenarios, so say what is open instead']);
	assert.deepEqual(ledger('Copy `files/settings.S08.json` to the user settings.'), []);
});

test('flags steps that start from what an earlier scenario left: only checks, or an Escape first', () => {
	const steps = s => lintLedgerOnly(LEDGER.replace('1. Click Retry.\n2. VERIFY it loads', s)).filter(x => /S02 (has only|step \d+ presses)/.test(x));
	assert.deepEqual(steps('1. VERIFY it loads'), ['ledger: S02 has only VERIFY steps; write the actions that get the app to what they check']);
	assert.deepEqual(steps('1. Press Escape.\n2. Click Retry.\n3. VERIFY it loads'), ['ledger: S02 step 1 presses Escape first, closing what an earlier scenario left open; start from the preconditions']);
	assert.deepEqual(steps('1. Click Retry.\n2. Press Escape.\n3. VERIFY it loads'), []);
});

test('flags a check repeated after the same actions, but not a recovery or a check after a new action', () => {
	const steps = s => lintLedgerOnly(LEDGER.replace('1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1', s)).filter(x => /repeats step/.test(x));
	assert.deepEqual(steps('1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Click Retry.\n4. VERIFY it loads -> FAIL - Finding 1'), ["ledger: S02 step 4 repeats step 2's check after the same actions; write the steps once and count the retry in the rate"]);
	// The fault removed and the trigger repeated is a recovery check: its result differs.
	assert.deepEqual(steps('1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Reconnect the network.\n4. Click Retry.\n5. VERIFY it loads -> PASS'), []);
	assert.deepEqual(steps('1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n3. Reload the window.\n4. VERIFY it loads -> FAIL - Finding 1'), []);
});

test('flags a Command Palette row picked with no step that opens the palette', () => {
	const steps = (...texts) => lint(report(f => { f.steps = [...texts.map(text => ({ kind: 'action', text })), f.steps[1]]; })).filter(x => /Command Palette row/.test(x));
	assert.deepEqual(steps('Click the `Workspaces: New Folder from Template...` row in the Command Palette.'), ['report: Finding 1 step 1 picks a Command Palette row, but no step before it opens the palette and types the command']);
	assert.deepEqual(steps('Open the Command Palette and type `New Folder`.', 'Click the `Workspaces: New Folder from Template...` row in the Command Palette.'), []);
});

test('flags a precondition that is state made in the app: a session value, a shown page, a console a scenario started', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: 'State', text: p }]; })).filter(x => /done in the app|running app/.test(x));
	assert.deepEqual(pre('any URL shown in the Viewer, here the R Shiny app'), ['report: Finding 1 precondition "State" is done in the app ("shown in the"); do it as a step, and keep the precondition to the state before step 1']);
	assert.deepEqual(pre('the R Shiny app running in its Shiny console'), ['report: Finding 1 precondition "State" is a running app ("running in its Shiny console"); start it in the steps, with a check that it runs']);
	assert.deepEqual(pre('A Python 3.12 console, which Positron starts on launch'), []);
	const ledger = p => lintLedgerOnly(LEDGER.replace('Status: fail - Finding 1\n', `Status: fail - Finding 1\n\nPreconditions:\n- ${p}\n`)).filter(x => /done in the app/.test(x));
	assert.deepEqual(ledger('`pd_ints` in the session | S01 | Defined in the Python console by S01 (files/ints.py)'), ['ledger: S02 precondition "`pd_ints` in the session" is done in the app ("in the session"); do it as a step, and keep the precondition to the state before step 1']);
	assert.deepEqual(ledger('R console | S03 | The R console started in S03'), ['ledger: S02 precondition "R console" is done in the app ("started in S03"); do it as a step, and keep the precondition to the state before step 1']);
	// A file a scenario left on disk is still a file.
	assert.deepEqual(ledger('expired cache | S02 | S02\'s profile after Positron quit, every firstSeen moved back 40 days by `files/backdate.py`'), []);
});

test('flags a precondition that runs a command, which is a step', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: '`slow.py` loaded', text: p }]; })).filter(x => /precondition "/.test(x));
	assert.deepEqual(pre('`slow.py` loaded with `%run -i slow.py`'), ['report: Finding 1 precondition "`slow.py` loaded" runs `%run -i slow.py`; run it as a step, and keep the precondition to the file or package']);
	assert.deepEqual(pre('`debug.R` sourced with `source("debug.R")`'), ['report: Finding 1 precondition "`slow.py` loaded" runs `source("debug.R")`; run it as a step, and keep the precondition to the file or package']);
	// What a file holds is described, not run.
	assert.deepEqual(pre('`debug_demo.R`, which defines `outer_fn()`'), []);
	assert.deepEqual(pre('`py.qmd` whose cell prints `tick 0` to `tick 4`'), []);
	assert.deepEqual(pre('`app.py` that calls `app.run(port=5057)`'), []);
});

test('a saved output under logs/ or files/ sits beside a check\'s screenshot, never in place of it', () => {
	const ledger = '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY port 8000 is closed -> PASS\n   Evidence: logs/listeners-after.txt\n2. VERIFY the notebook saves its outputs -> PASS\n   Evidence: files/saved.ipynb\n3. VERIFY the file says 1 -> PASS\n   Evidence: S01-01.png, logs/missing.txt\n4. VERIFY the notebook saves its outputs -> PASS\n   Evidence: S01-02.png, files/saved.ipynb\n';
	const has = p => p !== 'logs/missing.txt';
	const problems = lint(report(), ledger, { fileExists: has }).filter(p => /S01.* cites /.test(p));
	assert.deepEqual(problems, [
		'ledger: S01 cites Evidence: logs/missing.txt, which is not in the run directory',
		'ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it',
		'ledger: S01 step 2 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it',
	]);
});

test('a reading in actions.log sits beside a check\'s screenshot, never in place of it', () => {
	const ledger = '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY cell 4 fails with NameError -> PASS\n   Evidence: actions.log:5\n2. VERIFY cells 1 to 9 each show their output -> PASS\n   Evidence: S01-01.png, actions.log:41, actions.log:44\n3. VERIFY the file says 1 -> PASS\n   Evidence: none, read in the console\n';
	const problems = lint(report(), ledger).filter(p => /S01.* cites /.test(p));
	assert.deepEqual(problems, ['ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it', 'ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);
	// The ledger-only check run mid-run finds it too, while the instance is up.
	assert.deepEqual(lintLedgerOnly(ledger, { fileExists: () => true }).filter(p => /S01 step/.test(p)), ['ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it', 'ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);
});

test('Evidence holds Positron log lines only: no notes, no agent files', () => {
	const evidence = items => lint(report(f => { f.evidence = [...f.evidence, ...items]; }));
	assert.deepEqual(evidence([
		{ kind: 'log', path: 'logs/1-exthost.log:5', process: 'Extension host', when: '00:18:39', quote: 'env change ==/x== remove' },
		{ kind: 'missing', path: 'logs/1-exthost.log', window: '00:18:39-00:19:24', quote: 'env change /x add' },
	]), []);
	assert.deepEqual(evidence([
		{ kind: 'note', caption: 'so nothing resolved the new path' },
		{ kind: 'log', path: 'actions.log:12', quote: 'click failed' },
		{ kind: 'log', path: 'logs/S03-later.txt', quote: 'saved' },
	]).map(p => p.replace(/;.*/, '')), [
		'report: Finding 1 evidence has a note ("so nothing resolved the new path")',
		'report: Finding 1 evidence cites actions.log:12, which the run wrote, not Positron',
		'report: Finding 1 evidence cites logs/S03-later.txt, which the run wrote, not Positron',
	]);
});

test('a finding\'s prose names no scenario ID, but an Evidence caption may', () => {
	const pair = (observed, expected) => lint(report(f => { f.observed = observed; f.expected = expected; }));
	assert.deepEqual(pair('The panel stays empty.', 'The panel loads, as it did after Restart Kernel (S05, S06).'),
		['report: Finding 1 expected names S05, S06; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	assert.deepEqual(pair('The panel stays empty, unlike N01.', 'The panel loads.'),
		['report: Finding 1 observed names N01; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	assert.deepEqual(lint(report(f => { f.title = 'Retry does nothing in S03'; })),
		['report: Finding 1 title names S03; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	// A shot's name, or code, is not prose; a caption may name the scenario that took a shot.
	assert.deepEqual(pair('The panel stays empty in `S05`, see shots/S06-01.png.', 'The panel loads.'), []);
	assert.deepEqual(lint(report(f => { f.evidence.push({ kind: 'shot', path: 'shots/b.png', step: 2, caption: 'S06 left it empty again after a restart' }); })), []);
});

test('a file saved under a mirrored folder is found by its bare name, and a long extension is kept', () => {
	const json = report(f => { f.preconditions = [{ name: 'app', text: '`app.R` in the `rapp` folder of the workspace' }]; });
	const ledger = '# Test ledger\n\n## Files\n- files/rapp/app.R | app | S01; Finding 1\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY rows -> PASS\n   Evidence: logs/S01-products.parquet\n';
	const has = p => ['files/rapp/app.R', 'logs/S01-products.parquet', 'shots/a.png'].includes(p);
	const problems = lint(json, ledger, { fileExists: has, listFiles: () => ['files/rapp/app.R'] }).filter(p => /app\.R|parquet|parqu/.test(p));
	assert.deepEqual(problems, []);
});

test('one screenshot may serve failed checks of two different findings, and nothing else', () => {
	const ledger = n2 => ['# Test ledger', '',
		'## S01 - x', 'Status: fail - Finding 1', 'Result: Fails 1/1', '', 'Steps:',
		'1. VERIFY dates read right -> FAIL - Finding 1', '   Observed: x', '   Evidence: S01-01.png', '   Log: none found', '',
		'## S02 - y', `Status: fail - Finding ${n2}`, 'Result: Fails 1/1', '', 'Steps:',
		`1. VERIFY structs read right -> FAIL - Finding ${n2}`, '   Observed: y', '   Evidence: S01-01.png', '   Log: none found', ''].join('\n');
	const shared = l => lint(report(), l).filter(p => /is Evidence for/.test(p));
	assert.deepEqual(shared(ledger(2)), []);
	assert.equal(shared(ledger(1)).length, 1);
});

test('a precondition about a file that does not exist does not ask for it to be saved', () => {
	const pre = p => lint(report(f => { f.preconditions = [{ name: 'db', text: p }]; })).filter(x => /missing\.sqlite/.test(x));
	assert.deepEqual(pre('`missing.sqlite` does not exist in the workspace'), []);
	assert.equal(pre('`missing.sqlite` in the workspace').length, 1);
});

test('flags a cited screenshot that actions.log never took by that name', () => {
	const ledger = '## S01 - x\nStatus: pass\n\nSteps:\n1. VERIFY a -> PASS\n   Evidence: S01-02.png, S01-02b.png\n2. VERIFY b -> PASS\n   Evidence: shots/S01-04.png\n';
	const log = '20:00:01 screenshot S01-02\n20:00:02 playwright screenshot --filename=/r/shots/S01-02b.png\n20:00:03 screenshot S01-03.png\n';
	assert.deepEqual(lintShotNames(ledger, log), ['ledger: S01-04.png is cited as Evidence but actions.log never takes a shot by that name; keep the name a shot was taken with, or log the rename']);
	assert.deepEqual(lintShotNames(ledger, log + '20:00:04 renamed S01-03.png to S01-04.png\n'), []);
});

test('a moderate or major finding tried only once is a warning, never an error', () => {
	const rate = (severity, n, m) => lint(report(f => { f.severity = severity; f.reproduced = { n, m }; })).filter(p => /tried once/.test(p));
	assert.deepEqual(rate('moderate', 1, 1), ['report: Finding 1 is moderate and was tried once (1/1); keep the severity, and repeat its steps if the instance is still up']);
	assert.equal(rate('major', 1, 1).length, 1);
	assert.deepEqual(rate('minor', 1, 1), []);
	assert.deepEqual(rate('moderate', 1, 2), []);
	// Rating it lower must not be the way past an error.
	assert.deepEqual(split(lintRaw(report(f => { f.severity = 'major'; f.reproduced = { n: 1, m: 1 }; })).filter(p => p.rule === 'tried-once')).errors, []);
});

test('actions.log is append-only: every line stamped as the helpers stamp it, in time order', () => {
	const at = (s, text = 'shot.sh -s=p: screenshot S01-01.png') => `2026-10-05T03:59:${String(s).padStart(2, '0')}Z ${text}`;
	assert.deepEqual(lintActionsLog([at(1), at(2), '', at(2), at(30)].join('\n') + '\n'), []);
	// Two helpers at once may land a second out of order.
	assert.deepEqual(lintActionsLog([at(2), at(1)].join('\n')), []);
	// The #16331 run: a missed Escape backdated below later lines.
	assert.deepEqual(lintActionsLog([at(16), at(24), '2026-10-05T03:58:25Z raw press Escape [logged afterwards]', at(40)].join('\n')), [
		'actions.log: line 3 (2026-10-05T03:58:25Z) is earlier than line 2 above it (2026-10-05T03:59:24Z); the log is append-only, so log a missed action as a note when you notice it, and never backdate or move a line',
	]);
	assert.match(lintActionsLog([at(50), at(1), at(2), at(3), at(4)].join('\n'))[0], /^actions\.log: lines 2, 3, 4 and 1 more are earlier than a line above them, first line 2 \(2026-10-05T03:59:01Z\) is earlier than line 1 above it/);
	// A hand-written line: local time, no date, a space for the T or no Z.
	for (const line of ['22:39:56 rec.sh start', '2026-10-04 21:08:55 shell: made a venv', '2026-10-04T17:46:26 shell: copied files', '  at frame (x.js:1)']) {
		assert.deepEqual(lintActionsLog([at(1), line].join('\n')), [`actions.log: line 2 does not start with the UTC time the helpers write ("2026-01-02T03:04:05Z "), such as "${line.trim()}"; log what no helper logged with \`dp.ts log\`, and never write or rewrite a line yourself`], line);
	}
	// Both reports and the mid-run ledger check read it, as errors.
	const backdated = [at(24), at(16)].join('\n');
	assert.equal(split(lintRaw(report(), LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
	assert.equal(split(ledgerLint.lintLedgerOnly(LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
});

test('flags a pointer to another finding', () => {
	assert.ok(lint(report(f => { f.steps[0].text = 'Set up as Finding 2.'; })).some(p => /points at another finding/.test(p)));
});

test('flags an absolute citation and a compiled frame', () => {
	const problems = lint(report(f => {
		f.evidence.push({ kind: 'log', path: '/tmp/run/r.log', process: 'Renderer process', quote: 'x' });
		f.errors = [{ source: 'logs/r.log:1', message: 'Error: x', frames: [{ fn: 'f', path: 'out/vs/a.js', line: 1 }] }];
	}));
	assert.ok(problems.some(p => /not \/tmp\/run\/r\.log/.test(p)), problems.join('\n'));
	assert.ok(problems.some(p => /compiled frames/.test(p)));
});

test('a workspace path in Run details is not a citation', () => {
	assert.deepEqual(lint(report((f, r) => { r.header.details.push({ title: 'Workspace', body: 'Workspace `/tmp/exploratory-workspace`' }); })), []);
});

test('flags a cited shot that is not on disk', () => {
	assert.ok(lint(report(), LEDGER, { fileExists: () => false }).some(p => /Finding 1 cites shots\/a\.png, which is not in the run directory/.test(p)));
});

test('the schema takes a step\'s screenshot only under shots/', () => {
	for (const target of ['$U/a.png', 'https://cdn.example/run/shots/a.png']) {
		assert.ok(schemaProblems(report(f => { f.steps[1].shots = [target]; })).some(p => /steps\[1\]\.shots\[0\]/.test(p)), target);
	}
});

test('a repro is one scenario\'s steps, and that scenario failed for the finding', () => {
	const ledger = [
		'# Test ledger', '',
		'## S01 - Panel loads', 'Status: pass', 'Result: loads', '', 'Steps:', '1. VERIFY it loads -> PASS', '   Evidence: p.png', '',
		'## S02 - Retry', 'Status: fail - Finding 1', 'Result: Fails 2/2', '', 'Steps:',
		'1. VERIFY the button shows -> PASS', '   Evidence: r1.png',
		'2. VERIFY it loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: r2.png', '',
		'## S03 - Retry in Python', 'Status: fail - Finding 1', 'Result: Fails 2/2', '', 'Steps:',
		'1. VERIFY the Python panel loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: o1.png', '',
	].join('\n');
	const steps = (...checks) => report(f => {
		f.steps = checks.map(([text, result], k) => ({ kind: 'verify', text, result, ...(result === 'fail' ? { finding: 1 } : {}), shots: [`shots/s${k}.png`] }));
		f.evidence = [];
	});
	const repro = json => lintReportJson(json, ledger).filter(p => /Finding 1 step/.test(p));
	assert.deepEqual(repro(steps(['the button shows', 'pass'], ['it loads', 'fail'])), []);
	assert.deepEqual(repro(steps(['the button shows', 'pass'], ['the Python panel loads', 'fail'])), ['report.json: Finding 1 step 2 is not a step of S02: "Verify the Python panel loads"']);
	assert.deepEqual(repro(steps(['it loads', 'pass'])), ['report.json: Finding 1 step 1 is pass, but S02 recorded fail']);
});

test('the rate is the repro scenario\'s, plus retries the run logged as scenarios of their own', () => {
	const rate = (ledger, n = 2, m = 2) => lintReportJson(report(f => { f.reproduced = { n, m }; }), ledger).filter(p => /rate/.test(p));
	assert.deepEqual(rate(LEDGER), []);
	const once = LEDGER.replace('Result: Fails 2/2', 'Result: Fails 1/1');
	assert.deepEqual(rate(once), ['report.json: Finding 1\'s rate is 2/2, but S02, whose steps the repro shows, fails 1/1; give that rate']);
	// A second try logged as its own scenario counts, up to its tries.
	const retried = once.replace('## Not run', '## S03 - Retry, second try\nStatus: fail - Finding 1\nResult: Fails 1/1\n\nSteps:\n1. Click Retry.\n2. VERIFY it loads -> FAIL - Finding 1\n   Evidence: b.png\n\n## Not run');
	assert.deepEqual(rate(retried), []);
	assert.deepEqual(rate(retried, 3, 3), ['report.json: Finding 1\'s rate is 3/3, but S02, whose steps the repro shows, fails 1/1 and the scenarios that failed for it fail 2/2 in all; give a rate between the two, counting only tries of the same steps']);
});

test('flags a test file that is not in the repository, but not one marked new', () => {
	const json = report(f => {
		f.tests = {
			cases: [
				{ text: 'Retry loads the panel.', level: 'unit', path: 'src/a.test.ts', isNew: false },
				{ text: 'A new case.', level: 'e2e', path: 'test/e2e/tests/b.test.ts', isNew: true },
			],
			related: [{ path: 'src/c.test.ts', level: 'unit', note: 'request shape' }],
		};
	});
	const problems = lint(json, LEDGER, { fileExists: () => true, repoFileExists: p => p === 'src/a.test.ts' });
	assert.deepEqual(problems.filter(p => /not in the repository/.test(p)).map(p => /test file ([^,\s]+)/.exec(p)[1]), ['src/c.test.ts']);
	assert.deepEqual(lint(json), []);
});

test('flags a ledger Result longer than one short sentence', () => {
	const result = text => lint(report(), LEDGER.replace('Result: loads', `Result: ${text}`)).filter(p => /Result:/.test(p));
	assert.deepEqual(result('The panel loads with every row.'), []);
	assert.deepEqual(result('The panel loads. Restart went ahead without an answer.'),
		['ledger: S01 Result: is 2 sentences; keep it to one short sentence, and give anything you did not expect its own VERIFY step']);
	assert.deepEqual(result(`The panel loads ${'and keeps going '.repeat(10)}to the end`),
		['ledger: S01 Result: is 186 characters; keep it to one short sentence, and give anything you did not expect its own VERIFY step']);
});

test('flags a FAIL without Log:, a pass without a screenshot and a bad Status', () => {
	const ledger = LEDGER
		.replace('   Log: none found in logs/r.log\n', '')
		.replace('   Evidence: p.png\n', '')
		.replace('Status: fail - Finding 1', 'Status: failed');
	const problems = lint(report(), ledger);
	assert.ok(problems.some(p => /S02 step 2 FAIL is missing Log:/.test(p)));
	assert.ok(problems.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 Status: must be/.test(p)));
});

test('every VERIFY needs its own screenshot, not just one per scenario', () => {
	const ledger = LEDGER.replace('   Evidence: p.png\n', '   Evidence: p.png\n3. VERIFY the header shows -> PASS\n');
	assert.deepEqual(lint(report(), ledger), ['ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);

	const reused = LEDGER.replace('Evidence: p.png', 'Evidence: a.png');
	assert.deepEqual(lint(report(), reused), ['ledger: a.png is Evidence for S01 step 2 and S02 step 2; take a screenshot for each check']);
});

test('Evidence: counts only a file that is in shots/', () => {
	const prose = LEDGER.replace(/Evidence: [ap]\.png/g, 'Evidence: none; DOM read only');
	const problems = lint(report(), prose);
	assert.ok(problems.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 step 2 VERIFY cites no screenshot/.test(p)));

	const invented = lint(report(), LEDGER.replace('Evidence: p.png', 'Evidence: shots/made-up.png'), { fileExists: f => f === 'shots/a.png' });
	assert.ok(invented.some(p => /S01 cites Evidence: made-up\.png, which is not in shots\//.test(p)));
	assert.ok(invented.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
});

test('flags a Status naming a finding the report does not have', () => {
	assert.ok(lint(report(), LEDGER.replace('Status: fail - Finding 1', 'Status: fail - Finding 3')).some(p => /names Finding 3/.test(p)));
});

test('flags a Not exercised with no Not run', () => {
	const problems = lint(report(), LEDGER.replace(/## Not run\n.*\n/, ''));
	assert.ok(problems.some(p => /## Not run needs an N line/.test(p)));
});

test('without a ledger, the ledger checks are skipped', () => {
	assert.deepEqual(lint(report(), undefined), []);
});

test('a finding screenshot that names no step on the card is a format problem', () => {
	const flagged = step => lint(report(f => { f.steps[1].shots = []; f.evidence = [{ kind: 'shot', path: 'shots/a.png', caption: 'empty panel', ...(step === undefined ? {} : { step }) }]; }))
		.some(p => /Finding 1 screenshot a\.png names no step; caption it "Step N:" for the step it proves or "S06:" for the scenario that took it, and if neither fits, add the step/.test(p));
	// Every screenshot opens from the step it proves, so one with no step or a step past the last has nowhere to go.
	assert.ok(flagged(undefined));
	assert.ok(flagged(3));
	assert.ok(!flagged(2));
});

test('a step with more than two screenshots, or a second that repeats the first, is a format problem', () => {
	const shots = (cited, extra = []) => report(f => {
		f.steps[1].shots = cited.map(c => `shots/${c}`);
		f.evidence = extra.map(([file, caption]) => ({ kind: 'shot', path: `shots/${file}`, step: 2, caption }));
	});
	const problems = json => lint(json).filter(p => /screenshot/.test(p));
	assert.deepEqual(problems(shots(['a.png'])), []);
	// A second shot with its own caption is a different moment; with the check's caption it is a repeat.
	assert.deepEqual(problems(shots(['a.png', 'b.png'], [['b.png', 'still empty 15 s later']])), []);
	assert.deepEqual(problems(shots(['a.png', 'b.png'])), ["report: Finding 1 step 2's second screenshot b.png repeats the first one's caption; caption it under evidence with what it shows that the first does not"]);
	assert.deepEqual(problems(shots(['a.png', 'b.png', 'c.png'], [['b.png', 'later'], ['c.png', 'pandas loads']])),
		['report: Finding 1 step 2 has 3 screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out']);
	// A shot listed under Evidence for the step, and not cited by it, is another run's.
	assert.deepEqual(problems(shots(['a.png', 'b.png'], [['b.png', 'later'], ['c.png', 'a second restart left it empty again']])), []);
});

test('flags an Observed or Expected written as notes, with the reference in Observed, or with a number written two ways', () => {
	const pair = (observed, expected) => lint(report(f => { f.observed = observed; f.expected = expected; }));
	assert.deepEqual(pair('The `n` column, whose largest value is 1,500, shows Max 1.', '`n` shows Max 1,500, as pandas shows for the same data.'), []);
	assert.deepEqual(pair('Max 1 for 1,500; Min 1 for 1,234,567.', 'Max 1,500.'), ['report: Finding 1 observed joins notes with a semicolon; write it as sentences']);
	assert.deepEqual(pair('`n` shows Max 1. pandas shows Max 1,500.', 'Max 1,500.'),
		['report: Finding 1 observed names pandas, which the title does not; the reference that shows the right answer goes in expected ("as pandas shows for the same data")']);
	assert.deepEqual(pair('`pop` shows Min 1.', 'Min 1,234,567, as pandas shows 1234567.'),
		['report: Finding 1 writes 1234567 both with and without digit grouping; write each number one way (1,234,567), except a value quoted exactly as the UI shows it']);
	// A value the UI shows, quoted as it is, differs from the right one, so it is not the same number twice.
	assert.deepEqual(pair('`pop` shows Max 12300000.', 'Max 12,345,678.'), []);
	// A semicolon inside code is the reader's to type.
	assert.deepEqual(pair('Running `a; b` shows Max 1.', 'Max 1,500.'), []);
});

test('a finding step that carries a run note is a format problem', () => {
	assert.deepEqual(lint(report(f => { f.steps[0].text = 'Click Retry (S05 ran this together with two other values).'; })),
		['report: Finding 1 step "Click Retry (S05 ran this together with two other " names S05; steps are instructions for the reader, so leave run notes out']);
	// An ID inside code is the reader's to type, not a note.
	assert.deepEqual(lint(report(f => { f.steps[0].text = 'Run `S05 = 1`.'; })), []);
});

test('the verifier\'s reply is not the explorer\'s, so lint skips it', () => {
	const reply = '```json\n{ "findings": [{ "n": 1, "verdict": "confirmed" }] }\n```\n\n- 3. Same as Finding 1: a note from the verifier, citing S02.';
	assert.deepEqual(lint(applyVerification(report(), parseVerifyReply(reply))), []);
	// Inside a finding it is still a problem.
	assert.equal(lint(report(f => { f.steps[0].text = 'Same as Finding 1: click Retry.'; })).filter(p => /points at another finding/.test(p)).length, 1);
});

const KNOWN = { issues: [
	{ number: 10, relation: 'fixes' },
	{ number: 11, relation: 'fixes' },
	{ number: 20, relation: 'linked' },
	{ number: 21, relation: 'linked', state: 'closed' },
] };
const lintKnown = ledger => lint(report(), ledger, { fileExists: () => true, knownIssues: KNOWN }).filter(p => /#\d|Issue:/.test(p));
const withIssues = (s01, s02, notRun = '') => LEDGER
	.replace('Result: loads\n', `Result: loads\n${s01}`)
	.replace('Result: Fails 2/2\n', `Result: Fails 2/2\n${s02}`)
	.replace('- N01 - web build - no server\n', `- N01 - web build - no server\n${notRun}`);

test('a ledger that accounts for every linked issue is clean', () => {
	assert.deepEqual(lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 observed\n', 'Issue: #11 fix did not hold\nIssue: #21 came back\n')), []);
	assert.deepEqual(lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 observed\n', 'Issue: #11 fix didn\'t hold\nIssue: #21 came back\n')), []);
	assert.deepEqual(lintKnown(withIssues('Issue: #10 fix held\n', '', '- N02 - x - Fix for #11 not exercised: web only\n- N03 - y - Already filed as #20\n')), []);
});

test('flags Issue lines that do not match the list', () => {
	const problems = lintKnown(withIssues('Issue: #10 held\nIssue: #99 observed\nIssue: #20 fix held\n', 'Issue: #10 observed\nIssue: #11 fix did not hold\n'));
	assert.ok(problems.some(p => /S01 "Issue: #10 held" must read/.test(p)), problems.join('\n'));
	assert.ok(problems.some(p => /S01 names #99, which is not in known-issues\.json/.test(p)));
	assert.ok(problems.some(p => /S01 #20 is an open linked issue/.test(p)));
	assert.ok(problems.some(p => /S02 #10 is a fix the PR claims/.test(p)));
});

test('a linked issue gets no "fix held": a closed one only "came back", an open one only "observed", or no line', () => {
	assert.deepEqual(lintKnown(withIssues('Issue: #10 fix held\nIssue: #21 fix held\nIssue: #20 fix held\n', 'Issue: #11 fix held\n')), [
		'ledger: S01 #21 is a closed linked issue, not one the PR fixes; record "came back" only if it showed up again, otherwise leave the Issue: line out',
		'ledger: S01 #20 is an open linked issue, not one the PR fixes; record "observed" only if the scenario ran into it, otherwise leave the Issue: line out',
	]);
	// A linked issue nobody ran into needs no line at all.
	assert.deepEqual(lintKnown(withIssues('Issue: #10 fix held\n', 'Issue: #11 fix held\n')), []);
});

test('flags a fix that did not hold on a passing scenario, and a fix the ledger never mentions', () => {
	const problems = lintKnown(withIssues('Issue: #10 fix did not hold\n', ''));
	assert.ok(problems.some(p => /S01 says the fix for #10 did not hold, so it needs a finding/.test(p)), problems.join('\n'));
	assert.ok(problems.some(p => /the PR fixes #11; record/.test(p)));
});

test('flags a closed issue recorded as observed, an open one that came back, and a regression on a passing scenario', () => {
	const problems = lintKnown(withIssues('Issue: #10 fix held\nIssue: #20 came back\nIssue: #21 came back\n', 'Issue: #11 fix held\nIssue: #21 observed\nIssue: #10 came back\n'));
	assert.ok(problems.some(p => /S01 #20 is still open; record "observed", not "came back"/.test(p)), problems.join('\n'));
	assert.ok(problems.some(p => /S01 says #21 came back, so it needs a finding and Status: FAIL/.test(p)));
	assert.ok(problems.some(p => /S02 #21 is closed, so seeing it again is a finding; record "came back"/.test(p)));
	assert.ok(problems.some(p => /S02 #10 is a fix the PR claims; record "fix held" or "fix did not hold", not "came back"/.test(p)));
});

test('flags a Not run row that names the wrong kind of issue', () => {
	const problems = lintKnown(withIssues('Issue: #10 fix held\n', 'Issue: #11 fix held\n', '- N02 - x - Already filed as #10\n'));
	assert.ok(problems.some(p => /Not run N02 #10: use "Fix for #N not exercised"/.test(p)), problems.join('\n'));
});

test('Issue lines are not checked without a known-issues list', () => {
	assert.deepEqual(lint(report(), withIssues('Issue: #99 observed\n', '')), []);
});

test('a step is one action, with no repeat count, second action, assumed state or session ID', () => {
	const step = text => lint(report(), LEDGER.replace('1. Open it.', `1. ${text}`)).filter(p => /S01 step 1/.test(p));
	assert.deepEqual(step('Click Step Over in the debug toolbar.'), []);
	assert.deepEqual(step('Run `print("x"); print("y")` in the Python console and wait for it to finish.'), []);
	// A capitalized word after "then" is a menu item, and a count inside code is the reader's to type.
	assert.deepEqual(step('Click More cell actions on cell 2, then Insert Cell Above.'), []);
	assert.deepEqual(step('Run `for (i in 1:3) print("3 times")` in the R console.'), []);
	assert.deepEqual(step('Click Step Over three times.'), ['ledger: S01 step 1 repeats an action ("three times"); a step is one action, so write each one as its own step']);
	assert.deepEqual(step('Press Cmd+Enter twice.'), ['ledger: S01 step 1 repeats an action ("twice"); a step is one action, so write each one as its own step']);
	assert.deepEqual(step('Run `View: Close Editor`, then open `a.qmd` again.'), ['ledger: S01 step 1 is two actions ("then open"); write each as its own step']);
	assert.deepEqual(step('With the console open, run `x`.'), ['ledger: S01 step 1 starts "With ..."; make what it assumes a precondition, or do it as a step of its own']);
	assert.deepEqual(step('Click the python-4cddf9ca tab.'), ['ledger: S01 step 1 names python-4cddf9ca, which changes every launch; write a placeholder such as <Python session ID>']);
	// A finding's steps follow the same rules; a VERIFY is a check, not an action.
	assert.deepEqual(lint(report(f => { f.steps[0].text = 'Click Retry twice.'; })), ['report: Finding 1 step 1 repeats an action ("twice"); a step is one action, so write each one as its own step']);
	assert.deepEqual(lint(report(), LEDGER.replace('2. VERIFY it loads -> PASS', '2. VERIFY it loads, then shows twice -> PASS')), []);
});

test('a VERIFY is only the check, with the actions before it as steps of their own', () => {
	const check = text => lint(report(), LEDGER.replace('2. VERIFY it loads -> PASS', `2. VERIFY ${text} -> PASS`)).filter(p => /S01 step 2/.test(p));
	const did = verb => [`ledger: S01 step 2 VERIFY does something ("${verb}"); make it a step of its own before the check, and keep the VERIFY to what you expect to see`];
	// Real checks from past runs that name an action word without doing it.
	for (const text of [
		'the `n` profile shows Min 5; Max 1500',
		'Enter creates the folder (Create is enabled)',
		'focus moves to a footer button',
		'The dialog closes, focus is back in the editor',
		'the namespace holds only In, Out, exit, help, open and quit',
		'the plot still shows the status line (check mark, run time) from its last run',
		'Tables lists blobs, customers, select and wide',
		'`n` shows `n`, type int, with no chevron',
		'the console prints `small big`, then `45`, and returns to a `>>>` prompt',
		'the kernel is running',
	]) { assert.deepEqual(check(text), [], text); }
	assert.deepEqual(check('In the summary panel, type `n` in the column filter and expand the `n` profile; it shows Min 5'), did('type'));
	assert.deepEqual(check('Typing `n` in the summary column filter and expanding `n` shows Min 5'), did('Typing'));
	assert.deepEqual(check('after running `del df["num"]`, all 10 rows show'), did('running'));
	assert.deepEqual(check('clicking Console Information shows "Start Reason"'), did('clicking'));
	assert.deepEqual(check('the console prints `[1] 2`, and hovering the breakpoint shows "Unverified Breakpoint"'), did('hovering'));
	assert.deepEqual(check('the pane shows a plot after clicking Show Next Plot'), did('clicking'));
	assert.deepEqual(lint(report(f => { f.steps[1].text = 'clicking Retry loads the panel'; })).filter(p => /VERIFY does/.test(p)),
		['report: Finding 1 step 2 VERIFY does something ("clicking"); make it a step of its own before the check, and keep the VERIFY to what you expect to see']);
});

test('a failed scenario\'s Result is its rate only', () => {
	const result = text => lint(report(), LEDGER.replace('Result: Fails 2/2', `Result: ${text}`)).filter(p => /Result:/.test(p));
	assert.deepEqual(result('Fails 2/2'), []);
	assert.deepEqual(result('Retry leaves the panel empty'), ['ledger: S02 Result: of a failed scenario is its rate only, "Fails N/M"; the finding says what broke']);
});

test('flags a hedged title and an editorial Observed', () => {
	const titled = t => lint(report(f => { f.title = t; })).filter(p => /title hedges/.test(p));
	assert.deepEqual(titled('Retry seems to do nothing'), ['report: Finding 1 title hedges with "seems"; state what the run saw as a fact']);
	assert.deepEqual(titled('Retry may leave the panel empty'), ['report: Finding 1 title hedges with "may"; state what the run saw as a fact']);
	assert.deepEqual(titled('Retry does nothing'), []);
	const observed = lint(report(f => { f.observed = 'The panel incorrectly stays empty.'; }));
	assert.deepEqual(observed, ['report: Finding 1 observed says "incorrectly"; say what happened in plain words and let the difference speak']);
});

test('flags a possessive, a parenthetical and a code name in a title', () => {
	const titled = t => lint(report(f => { f.title = t; })).filter(p => /possessive|parenthetical|code name/.test(p));
	assert.deepEqual(titled('Paused columns\' tooltip is wrong'), ['report: Finding 1 title uses the possessive "columns\'"; say "the <thing> of <owner>" or name the thing on screen']);
	assert.deepEqual(titled('Retry does nothing (after a reload)'), ['report: Finding 1 title has a parenthetical; fold it into the sentence or move it to observed']);
	assert.deepEqual(titled('TableSummaryCache never clears'), ['report: Finding 1 title names TableSummaryCache, a code name a user never sees; say what is on screen, and leave code to cause']);
	assert.deepEqual(titled('The quartoNotebookUri is lost on reload'), ['report: Finding 1 title names quartoNotebookUri, a code name a user never sees; say what is on screen, and leave code to cause']);
	assert.deepEqual(titled('Plots on macOS lose `TableSummaryCache` on GitHub "Users\' (1)" reload'), []);
});

test('a cited shot is the one taken at its check: taken once, and in step order', () => {
	const ledger = ['## S01 - x', 'Status: pass', '', 'Steps:',
		'1. VERIFY a -> PASS', '   Evidence: S01-01.png',
		'2. Click B.',
		'3. VERIFY b -> PASS', '   Evidence: S01-02.png', '',
		'## S02 - y', 'Status: pass', '', 'Steps:',
		'1. VERIFY c -> PASS', '   Evidence: S02-01.png', ''].join('\n');
	const shot = (name, t) => `20:00:0${t}Z shot.sh -s=p: screenshot ${name}`;
	assert.deepEqual(lintShotTiming(ledger, [shot('S01-01.png', 1), shot('S01-02.png', 2), shot('S02-01.png', 3)].join('\n')), []);
	// A later scenario may cite a shot taken before an earlier one's.
	assert.deepEqual(lintShotTiming(ledger, [shot('S02-01.png', 1), shot('S01-01.png', 2), shot('S01-02.png', 3)].join('\n')), []);
	assert.deepEqual(lintShotTiming(ledger, [shot('S01-02.png', 1), shot('S01-01.png', 2), shot('S02-01.png', 3)].join('\n')),
		['ledger: S01 step 3 cites S01-02.png, which actions.log took before S01-01.png (step 1); cite the shot taken at each check']);
	assert.deepEqual(lintShotTiming(ledger, [shot('S01-01.png', 1), shot('S01-02.png', 2), shot('S01-01.png', 3), shot('S02-01.png', 4)].join('\n')), [
		'ledger: S01-01.png was taken 2 times in actions.log, so the file is only the last capture; give each capture its own name and cite the one taken at the check',
		'ledger: S01 step 3 cites S01-02.png, which actions.log took before S01-01.png (step 1); cite the shot taken at each check',
	]);
});

test('a shot taken twice is a warning when its last capture falls at the check citing it, an error when not', () => {
	const ledger = ['## S01 - x', 'Status: pass', '', 'Steps:',
		'1. VERIFY a -> PASS', '   Evidence: S01-01.png',
		'2. VERIFY b -> PASS', '   Evidence: S01-02.png',
		'3. VERIFY c -> PASS', '   Evidence: S01-03.png', ''].join('\n');
	const log = names => names.map((n, i) => `20:00:0${i}Z shot.sh -s=p: screenshot ${n}`).join('\n');
	// A retake of S01-02 before S01-03: the file is what step 2 judged.
	const retake = lintShotTiming(ledger, log(['S01-01.png', 'S01-02.png', 'S01-02.png', 'S01-03.png']));
	assert.deepEqual(retake, ['ledger: S01-02.png was taken 2 times in actions.log; the file is the last capture, taken before S01 step 2\'s check and after the one before it, so check that it shows step 2']);
	assert.deepEqual(split(ledgerLint.lintShotTiming(ledger, log(['S01-01.png', 'S01-02.png', 'S01-02.png', 'S01-03.png']))).errors, []);
	// Taken again after S01-03: the file shows a later moment than step 2's check.
	const late = lintShotTiming(ledger, log(['S01-01.png', 'S01-02.png', 'S01-03.png', 'S01-02.png']));
	assert.ok(late.some(p => /so the file is only the last capture/.test(p)));
	assert.ok(split(ledgerLint.lintShotTiming(ledger, log(['S01-01.png', 'S01-02.png', 'S01-03.png', 'S01-02.png']))).errors.length >= 1);
});

test('errors are what makes a repro or its evidence wrong; wording and length are warnings', () => {
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
});

test('each rule has a severity in lint-rules.mjs, and an unknown rule is refused', () => {
	assert.deepEqual(['fail-missing-fields', 'verify-no-shot', 'shot-cited-twice', 'shot-no-step', 'shot-retaken', 'shot-out-of-order', 'shot-missing', 'session-id', 'log-backdated', 'log-unstamped'].filter(r => LINT_RULES[r] !== 'error'), []);
	assert.deepEqual(['repeated-action', 'two-actions', 'verify-acts', 'step-starts-with', 'result-too-long', 'title-hedge', 'judgment-word', 'reference-in-observed', 'too-many-shots', 'tried-once'].filter(r => LINT_RULES[r] !== 'warning'), []);
	assert.throws(() => problem('no-such-rule', 'text'), /unknown lint rule: no-such-rule/);
});

test('a caption may name the scenario that took the shot instead of a step', () => {
	const captioned = (scenario, edit = () => { }) => lint(report(f => {
		f.steps[1].shots = [];
		f.evidence = [{ kind: 'shot', path: 'shots/a.png', scenario, caption: 'empty panel' }];
		edit(f);
	})).filter(p => /screenshot/.test(p));
	// S02 took a.png, so it opens from the step that fails.
	assert.deepEqual(captioned('S02'), []);
	assert.deepEqual(captioned('S01'), ['report: Finding 1 screenshot a.png is captioned S01, but S01 never cites it as Evidence; name the scenario that took it']);
	assert.deepEqual(captioned('S09'), ['report: Finding 1 screenshot a.png is captioned S09, which the ledger does not have; name the scenario that took it']);
	// With no failing step on the card, a scenario alone has nowhere to open from.
	assert.ok(captioned('S02', f => { f.steps[1].result = 'pass'; delete f.steps[1].finding; }).some(p => /a\.png names no step/.test(p)));
});

test('the ledger alone is checked mid-run, without the report', () => {
	assert.deepEqual(lintLedgerOnly(LEDGER, { fileExists: () => true }), []);
	assert.deepEqual(lintLedgerOnly(LEDGER.replace('   Log: none found in logs/r.log\n', ''), { fileExists: () => true }), ['ledger: S02 step 2 FAIL is missing Log:']);
});

test('render.mjs --check checks a ledger alone without counting it, and lint-json fails on errors only', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lint-check-'));
	const run = (script, file, ...args) => spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url)), join(dir, file), ...args], { encoding: 'utf8' });
	try {
		mkdirSync(join(dir, 'shots'));
		mkdirSync(join(dir, 'logs'));
		for (const f of ['shots/a.png', 'shots/p.png', 'logs/r.log']) { writeFileSync(join(dir, f), 'x'); }
		writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('Result: Fails 2/2', 'Result: Retry leaves the panel empty'));
		// No report yet: the ledger alone, with a warning only.
		const early = run('./render.mjs', 'ledger.md', '--check');
		assert.equal(early.status, 0, early.stderr);
		assert.match(early.stderr, /format warnings[^\n]*\n {2}ledger: S02 Result: of a failed scenario/);
		assert.ok(!existsSync(join(dir, 'format-checks.jsonl')), 'a mid-run ledger check is not the report\'s first check');
		writeFileSync(join(dir, 'ledger.md'), LEDGER);
		writeFileSync(join(dir, 'report.json'), JSON.stringify(report()));
		const clean = run('./lint-json.mjs', 'report.json');
		assert.equal(clean.status, 0, clean.stdout);
		writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('   Log: none found in logs/r.log\n', ''));
		const failed = run('./lint-json.mjs', 'report.json');
		assert.equal(failed.status, 1);
		assert.match(failed.stdout, /errors[^\n]*\n {2}ledger: S02 step 2 FAIL is missing Log:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('flags a long Result and a Cause whose first sentence runs on', () => {
	const words = n => Array.from({ length: n }, () => 'word').join(' ');
	const long = lint(report((f, r) => { r.header.result = `${words(61)}.`; })).filter(p => /header\.result is/.test(p));
	assert.deepEqual(long, ['report: header.result is 61 words; keep it to 60 or fewer: what works in a phrase, then in bold what is broken']);
	const caused = lead => lint(report(f => { f.cause = `${lead}. Then \`a.ts:1\` has the detail.`; })).filter(p => /cause opens/.test(p));
	assert.deepEqual(caused(`The \`Retry\` handler ${words(38)}`), ['report: Finding 1 cause opens with a 41-word sentence; name the suspect in 40 words or fewer, then give the detail']);
	assert.deepEqual(caused(`The \`Retry\` handler ${words(37)}`), []);
	assert.equal(LINT_RULES['result-length'], 'warning');
});
