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
import { isWarning, lintActionsLog, lintLedgerOnly, lintReport, lintShotNames, lintShotTiming, splitProblems } from './lint.mjs';
import { applyVerification } from './finish.mjs';

const REPORT = `# Exploratory test: x

\`main\` | \`abc1234\`

**Result:** The panel loads.
**Tested:** the panel
**Not exercised:** the web build

## Findings

| # | Finding | Severity | Reproduction |
|---|---------|----------|--------------|
| 1 | Retry does nothing | moderate | 2/2 |

### Finding 1: Retry does nothing

**Feature:** console

1. Click Retry.
2. VERIFY the panel loads -> FAIL - Finding 1

- [shots/a.png](shots/a.png) -- Step 2: empty panel

<details>
<summary>Run details</summary>

### Change under test

</details>
`;

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

const lint = (report = REPORT, ledger = LEDGER) => lintReport(report, ledger, { fileExists: () => true });

test('a report written to the format is clean', () => {
	assert.deepEqual(lint(), []);
});

test('flags a finding with no Feature line', () => {
	assert.deepEqual(lint(REPORT.replace('**Feature:** console\n\n', '')), ['report: Finding 1 has no "**Feature:** <feature>" line']);
	assert.deepEqual(lint(REPORT.replace('**Feature:** console', '**Feature:**')), ['report: Finding 1 has no "**Feature:** <feature>" line']);
});

test('flags a finding that still has an Impact line', () => {
	assert.deepEqual(lint(REPORT.replace('**Feature:** console\n', '**Feature:** console\n\n**Impact:** The panel stays empty with no error shown.\n')),
		['report: Finding 1 has an Impact line; drop it, and put a fact the run saw, such as no error shown or only reopening restores it, at the end of Observed']);
});

test('flags an Impact column in the findings table', () => {
	const table = REPORT.replace('| # | Finding | Severity | Reproduction |\n|---|---------|----------|--------------|\n| 1 | Retry does nothing | moderate | 2/2 |',
		'| # | Finding | Severity | Impact | Reproduction |\n|---|---------|----------|--------|--------------|\n| 1 | Retry does nothing | moderate | stays empty | 2/2 |');
	assert.deepEqual(lint(table), ['report: drop the Impact column; the title says what is broken']);
});

test('flags an Observed or Expected that runs past its sentences', () => {
	const pair = (observed, expected) => lint(REPORT.replace('**Feature:** console\n', `**Feature:** console\n\n**Observed:** ${observed}\n\n**Expected:** ${expected}\n`));
	// Observed gets one more, for a fact the run saw such as a workaround.
	assert.deepEqual(pair('The panel is empty. Retry shows the same. After a reload it loads.', 'The panel loads. Retry reloads it.'), []);
	assert.deepEqual(pair('One. Two. Three. Four.', 'One. Two. Three.'), [
		'report: Finding 1 Observed: is 4 sentences; keep it to 1-2, plus one for a fact such as no error shown or a workaround you saw work, and move the rest to Reproduce or Evidence',
		'report: Finding 1 Expected: is 3 sentences; keep it to 1-2, and move the rest to Reproduce or Evidence',
	]);
});

test('fenced code does not count as a heading', () => {
	assert.deepEqual(lint(REPORT.replace('## Findings', '```\n# not a heading\n```\n\n## Findings')), []);
});

test('flags a missing summary label and a question-shaped Result', () => {
	const problems = lint(REPORT.replace('**Result:** The panel loads.', '**Result:** Yes, mostly.').replace(/\*\*Not exercised:\*\*.*\n/, ''));
	assert.ok(problems.some(p => /Result:\*\* answers a question/.test(p)));
	assert.ok(problems.some(p => /missing the \*\*Not exercised:\*\*/.test(p)));
});

test('flags table values outside the allowed words', () => {
	const problems = lint(REPORT.replace('| moderate | 2/2 |', '| High | often |'));
	assert.equal(problems.filter(p => /finding 1 (Severity|Reproduction)/.test(p)).length, 2);
});

test('flags a failed step whose finding is not the one the scenario\'s Status names', () => {
	const ledger = [
		'# Test ledger', '',
		'## S01 - Values', 'Status: fail - Finding 1', 'Result: fails', '', 'Steps:',
		'1. VERIFY a reads right -> FAIL - Finding 1', '   Observed: x', '   Evidence: a.png', '   Log: none found',
		'2. VERIFY b reads right -> FAIL - Finding 2', '   Observed: y', '   Evidence: b.png', '   Log: none found', '',
	].join('\n');
	const mixed = lintReport(REPORT, ledger, { fileExists: () => true }).filter(p => /Status names/.test(p));
	assert.deepEqual(mixed, ["ledger: S01 step 2 fails Finding 2 but the scenario's Status names Finding 1; give Finding 2's check a scenario of its own"]);
});

test('flags a title that starts lowercase or names code, but not a lowercase package name', () => {
	const titled = t => lint(REPORT.replace(/^### Finding 1: .*$/m, `### Finding 1: ${t}`)).filter(p => /Finding 1 title/.test(p));
	assert.equal(titled('a package installed from the console is missing').length, 1);
	assert.equal(titled('R doubles are formatted by Rust f64::to_string').length, 1);
	assert.deepEqual(titled('polars integer Min/Max shows only the leading digits'), []);
	assert.deepEqual(titled('Attached state stays stale after `library()` until Refresh'), []);
	assert.deepEqual(titled('Help for `dplyr::filter` lands on the stats page'), []);
});

test('flags a step that runs a precondition\'s command again', () => {
	const repro = (pre, step) => lint(REPORT.replace('**Feature:** console\n\n1. Click Retry.', `**Feature:** console\n\n**Repro**\n\n**Preconditions:**\n- \`slow.py\` loaded | ${pre}\n\n1. ${step}`)).filter(p => /precondition already/.test(p));
	assert.deepEqual(repro('`slow.py` loaded with `%run -i slow.py`', 'Run `%run -i slow.py` in the Python console.'), ['report: Finding 1 step 1 runs `%run -i slow.py`, which a precondition already sets up; start the steps after it']);
	assert.deepEqual(repro('`slow.py` loaded with `%run -i slow.py`', 'Click Retry.'), []);
	assert.deepEqual(repro('`debug_demo.R` defines `outer_fn()`', 'Run `outer_fn()` in the R console.'), []);
	// A check, or an action waiting on output, quotes the code's output or the code itself; it runs nothing.
	assert.deepEqual(repro('`py.qmd` whose cell prints `tick 0` to `tick 4`', 'VERIFY the console shows `tick 0` to `tick 2` -> PASS'), []);
	assert.deepEqual(repro('`r.qmd` with an R cell `print(paste("r says", z))`', 'VERIFY cell 2 (`print(paste("r says", z))`) shows its output -> FAIL - Finding 1'), []);
	assert.deepEqual(repro('`py.qmd` whose cell prints `tick 0` to `tick 4`', 'Click Run this cell and wait until the output shows `tick 0`.'), []);
});

test('a saved output under logs/ or files/ sits beside a check\'s screenshot, never in place of it', () => {
	const ledger = '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY port 8000 is closed -> PASS\n   Evidence: logs/listeners-after.txt\n2. VERIFY the notebook saves its outputs -> PASS\n   Evidence: files/saved.ipynb\n3. VERIFY the file says 1 -> PASS\n   Evidence: S01-01.png, logs/missing.txt\n4. VERIFY the notebook saves its outputs -> PASS\n   Evidence: S01-02.png, files/saved.ipynb\n';
	const has = p => p !== 'logs/missing.txt';
	const problems = lintReport(REPORT, ledger, { fileExists: has }).filter(p => /S01/.test(p));
	assert.deepEqual(problems, [
		'ledger: S01 cites Evidence: logs/missing.txt, which is not in the run directory',
		'ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it',
		'ledger: S01 step 2 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it',
	]);
});

test('a reading in actions.log sits beside a check\'s screenshot, never in place of it', () => {
	const ledger = '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY cell 4 fails with NameError -> PASS\n   Evidence: actions.log:5\n2. VERIFY cells 1 to 9 each show their output -> PASS\n   Evidence: S01-01.png, actions.log:41, actions.log:44\n3. VERIFY the file says 1 -> PASS\n   Evidence: none, read in the console\n';
	const problems = lintReport(REPORT, ledger, { fileExists: () => true }).filter(p => /S01/.test(p));
	assert.deepEqual(problems, ['ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it', 'ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);
	// The ledger-only check run mid-run finds it too, while the instance is up.
	assert.deepEqual(lintLedgerOnly(ledger, { fileExists: () => true }).filter(p => /S01 step/.test(p)), ['ledger: S01 step 1 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it', 'ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);
});

test('Evidence holds Positron log lines only: no notes, no agent files, nothing after the quote', () => {
	const evidence = lines => REPORT.replace('<details>', ['**Evidence**', '', ...lines, '', '<details>'].join('\n'));
	assert.deepEqual(lint(evidence([
		'- `logs/1-exthost.log:5` | Extension host | 00:18:39 -- "env change ==/x== remove"',
		'- **Not logged** -- `logs/1-exthost.log` | 00:18:39-00:19:24 -- "env change /x add"',
	])), []);
	assert.deepEqual(lint(evidence([
		'- so nothing resolved the new path',
		'- `actions.log:12` -- "click failed"',
		'- `logs/S03-later.txt` -- "saved"',
		'- `logs/1-exthost.log:5` -- "env change /x remove", with no add after it',
	])).map(p => p.replace(/;.*/, '')), [
		'report: Finding 1 Evidence has a note ("so nothing resolved the new path")',
		'report: Finding 1 Evidence cites actions.log:12, which the run wrote, not Positron',
		'report: Finding 1 Evidence cites logs/S03-later.txt, which the run wrote, not Positron',
		'report: Finding 1 Evidence follows logs/1-exthost.log:5\'s line with "with no add after it"',
	]);
});

test('a finding\'s prose names no scenario ID, but an Evidence caption may', () => {
	const pair = (observed, expected) => lint(REPORT.replace('**Feature:** console\n', `**Feature:** console\n\n**Observed:** ${observed}\n\n**Expected:** ${expected}\n`));
	assert.deepEqual(pair('The panel stays empty.', 'The panel loads, as it did after Restart Kernel (S05, S06).'),
		['report: Finding 1 Expected names S05, S06; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	assert.deepEqual(pair('The panel stays empty, unlike N01.', 'The panel loads.'),
		['report: Finding 1 Observed names N01; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	assert.deepEqual(lint(REPORT.replace('### Finding 1: Retry does nothing', '### Finding 1: Retry does nothing in S03')),
		['report: Finding 1 title names S03; say what it was in words (e.g. "after Restart Kernel"), since readers never see scenario IDs']);
	// A shot's name, or code, is not prose; a caption may name the scenario that took a shot.
	assert.deepEqual(pair('The panel stays empty in `S05`, see shots/S06-01.png.', 'The panel loads.'), []);
	assert.deepEqual(lint(REPORT.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel', '- [shots/a.png](shots/a.png) -- Step 2: empty panel\n- [shots/b.png](shots/b.png) -- S06: empty again after a restart')), []);
});

test('a file saved under a mirrored folder is found by its bare name, and a long extension is kept', () => {
	const report = REPORT.replace('**Feature:** console\n\n1. Click Retry.', '**Feature:** console\n\n**Repro**\n\n**Preconditions:**\n- app | `app.R` in the `rapp` folder of the workspace\n\n1. Click Retry.');
	const ledger = '# Test ledger\n\n## Files\n- files/rapp/app.R | app | S01; Finding 1\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY rows -> PASS\n   Evidence: logs/S01-products.parquet\n';
	const has = p => ['files/rapp/app.R', 'logs/S01-products.parquet'].includes(p);
	const problems = lintReport(report, ledger, { fileExists: has, listFiles: () => ['files/rapp/app.R'] }).filter(p => /app\.R|parquet|parqu/.test(p));
	assert.deepEqual(problems, []);
});

test('one screenshot may serve failed checks of two different findings, and nothing else', () => {
	const ledger = n2 => ['# Test ledger', '',
		'## S01 - x', 'Status: fail - Finding 1', 'Result: Fails 1/1', '', 'Steps:',
		'1. VERIFY dates read right -> FAIL - Finding 1', '   Observed: x', '   Evidence: S01-01.png', '   Log: none found', '',
		'## S02 - y', `Status: fail - Finding ${n2}`, 'Result: Fails 1/1', '', 'Steps:',
		`1. VERIFY structs read right -> FAIL - Finding ${n2}`, '   Observed: y', '   Evidence: S01-01.png', '   Log: none found', ''].join('\n');
	const shared = l => lintReport(REPORT, l, { fileExists: () => true }).filter(p => /is Evidence for/.test(p));
	assert.deepEqual(shared(ledger(2)), []);
	assert.equal(shared(ledger(1)).length, 1);
});

test('a precondition about a file that does not exist does not ask for it to be saved', () => {
	const pre = p => lint(REPORT.replace('**Feature:** console\n\n1. Click Retry.', `**Feature:** console\n\n**Repro**\n\n**Preconditions:**\n- db | ${p}\n\n1. Click Retry.`)).filter(x => /missing\.sqlite/.test(x));
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
	const rate = (sev, r) => lint(REPORT.replace('| moderate | 2/2 |', `| ${sev} | ${r} |`)).filter(p => /tried once/.test(p));
	assert.deepEqual(rate('moderate', '1/1'), ['report: finding 1 is moderate and was tried once (1/1); keep the severity, and repeat its steps if the instance is still up']);
	assert.equal(rate('major', '1/1').length, 1);
	assert.deepEqual(rate('minor', '1/1'), []);
	assert.deepEqual(rate('moderate', '1/2'), []);
	// Rating it lower must not be the way past an error.
	assert.deepEqual(splitProblems(rate('major', '1/1')).errors, []);
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
	assert.equal(splitProblems(lintReport(REPORT, LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
	assert.equal(splitProblems(lintLedgerOnly(LEDGER, { fileExists: () => true, actionsLog: backdated })).errors.filter(p => /^actions\.log:/.test(p)).length, 1);
});

test('flags an Introduced? or Origin column', () => {
	const table = REPORT
		.replace('| Severity | Reproduction |', '| Severity | Introduced? | Reproduction |')
		.replace('|----------|--------------|', '|----------|---|--------------|')
		.replace('| moderate | 2/2 |', '| moderate | yes | 2/2 |');
	assert.ok(lint(table).some(p => /drop the Introduced\?\/Origin column/.test(p)));
});

test('flags a table row and a block that do not pair up', () => {
	const problems = lint(REPORT.replace('### Finding 1:', '### Finding 2:'));
	assert.ok(problems.some(p => /row 1 has no/.test(p)));
	assert.ok(problems.some(p => /Finding 2 has a block but no table row/.test(p)));
});

test('flags a finding heading in the old shape', () => {
	assert.ok(lint(REPORT.replace('### Finding 1: Retry', '### 1. Retry')).some(p => /must read "### Finding N/.test(p)));
});

test('flags a defaults-only precondition and a pointer to another finding', () => {
	const body = REPORT
		.replace('1. Click Retry.', '**Preconditions:** default settings\n\n1. Set up as Finding 2.');
	const problems = lint(body);
	assert.ok(problems.some(p => /says only "defaults"/.test(p)));
	assert.ok(problems.some(p => /points at another finding/.test(p)));
});

test('flags a backticked shot, an absolute citation, a compiled frame and a cramped details block', () => {
	const body = REPORT
		.replace('- [shots/a.png](shots/a.png)', '- `shots/a.png`')
		.replace('### Change under test', '### Change under test\n\n- [log](/tmp/run/r.log)\n\n```\nError: x\n    at f (out/vs/a.js:1:2)\n```')
		.replace('<summary>Run details</summary>\n\n', '<summary>Run details</summary>\n');
	const problems = lint(body);
	assert.ok(problems.some(p => /not in backticks/.test(p)));
	assert.ok(problems.some(p => /not \/tmp\/run\/r\.log/.test(p)));
	assert.ok(problems.some(p => /blank line after <\/summary>/.test(p)));
	assert.ok(problems.some(p => /compiled frames/.test(p)));
});

test('a workspace path in Run details is not a citation', () => {
	assert.deepEqual(lint(REPORT.replace('### Change under test', '### Change under test\n\n- Workspace `/tmp/exploratory-workspace`')), []);
});

test('flags a linked shot that is not on disk', () => {
	assert.ok(lintReport(REPORT, LEDGER, { fileExists: () => false }).some(p => /links shots\/a\.png/.test(p)));
});

test('flags a screenshot linked through a variable or URL instead of shots/', () => {
	for (const target of ['$U/a.png', 'https://cdn.example/run/shots/a.png']) {
		const problems = lint(REPORT.replace('- [shots/a.png](shots/a.png)', `- [shots/a.png](${target})`));
		assert.ok(problems.some(p => p.includes(`not ${target}`)), target);
	}
});

test('a repro is one scenario\'s steps, and that scenario failed for the finding', () => {
	const ledger = [
		'# Test ledger', '',
		'## S01 - Panel loads', 'Status: pass', 'Result: loads', '', 'Steps:', '1. VERIFY it loads -> PASS', '   Evidence: p.png', '',
		'## S02 - Retry', 'Status: fail - Finding 1', 'Result: fails', '', 'Steps:',
		'1. VERIFY the button shows -> PASS', '   Evidence: r1.png',
		'2. VERIFY it loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: r2.png', '',
		'## S03 - Retry in Python', 'Status: fail - Finding 1', 'Result: fails', '', 'Steps:',
		'1. VERIFY it loads -> FAIL - Finding 1', '   Observed: empty', '   Evidence: o1.png', '',
	].join('\n');
	const withShots = (...shots) => REPORT.replace('1. Click Retry.\n2. VERIFY the panel loads -> FAIL - Finding 1\n',
		'**Repro** -- starting state: the panel open\n\n' + shots.map((shot, k) => `${k + 1}. VERIFY step ${k + 1} -> ${k === shots.length - 1 ? 'FAIL - Finding 1' : 'PASS'}\n   Evidence: ${shot}\n`).join(''));
	const repro = report => lintReport(report, ledger, { fileExists: () => true }).filter(p => /steps (mix|come from)/.test(p));
	assert.deepEqual(repro(withShots('r1.png', 'r2.png')), []);
	assert.deepEqual(repro(withShots('r2.png', 'o1.png')), ["report: Finding 1's steps mix S02 and S03; the repro is one scenario's steps, and another run's screenshots go under Evidence, captioned \"Step N:\" for the step they prove"]);
	assert.deepEqual(repro(withShots('p.png')), ["report: Finding 1's steps come from S01, whose Status does not name Finding 1"]);
	// A screenshot no scenario cites is another rule's problem.
	assert.deepEqual(repro(withShots('r2.png', 'stray.png')), []);
	// A Status that names two findings links the scenario to both.
	const two = ledger.replace('## S01 - Panel loads\nStatus: pass', '## S01 - Panel loads\nStatus: fail - Findings 2, 1');
	assert.deepEqual(lintReport(withShots('p.png'), two, { fileExists: () => true }).filter(p => /steps (mix|come from)/.test(p)), []);
});

test('flags a test file that is not in the repository, but not one marked new', () => {
	const tests = REPORT.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel\n', [
		'- [shots/a.png](shots/a.png) -- Step 2: empty panel', '',
		'**Test gap**', '',
		'- Retry loads the panel. -- Unit `src/a.test.ts` (exists)',
		'- A new case. -- E2E `test/e2e/tests/b.test.ts` (new file)', '',
		'**Other tests that touch this code**', '',
		'- `src/c.test.ts` -- Unit, request shape', '',
	].join('\n'));
	const problems = lintReport(tests, LEDGER, { fileExists: () => true, repoFileExists: p => p === 'src/a.test.ts' });
	assert.deepEqual(problems.filter(p => /not in the repository/.test(p)).map(p => /test file ([^,\s]+)/.exec(p)[1]), ['src/c.test.ts']);
	assert.deepEqual(lint(tests), []);
});

test('flags a ledger Result longer than one short sentence', () => {
	const result = text => lint(REPORT, LEDGER.replace('Result: loads', `Result: ${text}`)).filter(p => /Result:/.test(p));
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
	const problems = lint(REPORT, ledger);
	assert.ok(problems.some(p => /S02 step 2 FAIL is missing Log:/.test(p)));
	assert.ok(problems.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 Status: must be/.test(p)));
});

test('every VERIFY needs its own screenshot, not just one per scenario', () => {
	const ledger = LEDGER.replace('   Evidence: p.png\n', '   Evidence: p.png\n3. VERIFY the header shows -> PASS\n');
	assert.deepEqual(lint(REPORT, ledger), ['ledger: S01 step 3 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it']);

	const reused = LEDGER.replace('Evidence: p.png', 'Evidence: a.png');
	assert.deepEqual(lint(REPORT, reused), ['ledger: a.png is Evidence for S01 step 2 and S02 step 2; take a screenshot for each check']);
});

test('Evidence: counts only a file that is in shots/', () => {
	const prose = LEDGER.replace(/Evidence: [ap]\.png/g, 'Evidence: none; DOM read only');
	const problems = lint(REPORT, prose);
	assert.ok(problems.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 step 2 VERIFY cites no screenshot/.test(p)));

	const invented = lintReport(REPORT, LEDGER.replace('Evidence: p.png', 'Evidence: shots/made-up.png'), { fileExists: f => f === 'shots/a.png' });
	assert.ok(invented.some(p => /S01 cites Evidence: made-up\.png, which is not in shots\//.test(p)));
	assert.ok(invented.some(p => /S01 step 2 VERIFY cites no screenshot/.test(p)));
});

test('flags a Status naming a finding the report does not have', () => {
	assert.ok(lint(REPORT, LEDGER.replace('Status: fail - Finding 1', 'Status: fail - Finding 3')).some(p => /names Finding 3/.test(p)));
});

test('flags a Not exercised with no Not run', () => {
	const problems = lint(REPORT, LEDGER.replace(/## Not run\n.*\n/, ''));
	assert.ok(problems.some(p => /## Not run needs an N line/.test(p)));
});

test('without a ledger, the ledger checks are skipped', () => {
	assert.deepEqual(lintReport(REPORT, undefined, { fileExists: () => true }), []);
});

test('a finding screenshot that names no step on the card is a format problem', () => {
	const shot = caption => REPORT.replace('1. Click Retry.', '**Repro**\n\n1. Click Retry.')
		.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel', `**Evidence**\n\n- [shots/a.png](shots/a.png) -- ${caption}`);
	const flagged = caption => lint(shot(caption)).some(p => /Finding 1 screenshot a\.png names no step; caption it "Step N:" for the step it proves or "S06:" for the scenario that took it, and if neither fits, add the step/.test(p));
	// Every screenshot opens from the step it proves, so a bare Variant or a step past the last has nowhere to go.
	for (const caption of ['empty panel', 'Variant: empty panel', 'Step 3: empty panel']) {
		assert.ok(flagged(caption), caption);
	}
	assert.ok(!flagged('Step 2: empty panel'));
});

test('a step with more than two screenshots, or a second that repeats the first, is a format problem', () => {
	const shots = (cited, extra = []) => REPORT.replace('1. Click Retry.', '**Repro**\n\n1. Click Retry.')
		.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel', ['**Evidence**', '', ...extra].join('\n'))
		.replace('2. VERIFY the panel loads -> FAIL - Finding 1', `2. VERIFY the panel loads -> FAIL - Finding 1\n   Evidence: ${cited}`);
	const problems = report => lint(report).filter(p => /screenshot/.test(p));
	assert.deepEqual(problems(shots('a.png')), []);
	// A second shot with its own caption is a different moment; with the check's caption it is a repeat.
	assert.deepEqual(problems(shots('a.png, b.png', ['- [shots/b.png](shots/b.png) -- Step 2: still empty 15 s later'])), []);
	assert.deepEqual(problems(shots('a.png, b.png')), ["report: Finding 1 step 2's second screenshot b.png repeats the first one's caption; caption it under Evidence with what it shows that the first does not"]);
	assert.deepEqual(problems(shots('a.png, b.png, c.png', ['- [shots/b.png](shots/b.png) -- Step 2: later', '- [shots/c.png](shots/c.png) -- Step 2: pandas loads'])),
		['report: Finding 1 step 2 has 3 screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out']);
	// A shot listed under Evidence for the step, and not cited by it, is another run's.
	assert.deepEqual(problems(shots('a.png, b.png', ['- [shots/b.png](shots/b.png) -- Step 2: later', '- [shots/c.png](shots/c.png) -- Step 2: a second restart left it empty again'])), []);
});

test('flags an Observed or Expected written as notes, with the reference in Observed, or with a number written two ways', () => {
	const pair = (observed, expected) => lint(REPORT.replace('**Feature:** console\n', `**Feature:** console\n\n**Observed:** ${observed}\n\n**Expected:** ${expected}\n`));
	assert.deepEqual(pair('The `n` column, whose largest value is 1,500, shows Max 1.', '`n` shows Max 1,500, as pandas shows for the same data.'), []);
	assert.deepEqual(pair('Max 1 for 1,500; Min 1 for 1,234,567.', 'Max 1,500.'), ['report: Finding 1 Observed: joins notes with a semicolon; write it as sentences']);
	assert.deepEqual(pair('`n` shows Max 1. pandas shows Max 1,500.', 'Max 1,500.'),
		['report: Finding 1 Observed: names pandas, which the title does not; the reference that shows the right answer goes in Expected ("as pandas shows for the same data")']);
	assert.deepEqual(pair('`pop` shows Min 1.', 'Min 1,234,567, as pandas shows 1234567.'),
		['report: Finding 1 writes 1234567 both with and without digit grouping; write each number one way (1,234,567), except a value quoted exactly as the UI shows it']);
	// A value the UI shows, quoted as it is, differs from the right one, so it is not the same number twice.
	assert.deepEqual(pair('`pop` shows Max 12300000.', 'Max 12,345,678.'), []);
	// A semicolon inside code is the reader's to type.
	assert.deepEqual(pair('Running `a; b` shows Max 1.', 'Max 1,500.'), []);
});

test('a finding step that carries a run note is a format problem', () => {
	const noted = REPORT.replace('1. Click Retry.', '1. Click Retry (S05 ran this together with two other values).');
	assert.deepEqual(lint(noted), ['report: Finding 1 step "1. Click Retry (S05 ran this together with two oth" names S05; steps are instructions for the reader, so leave run notes out']);
	// An ID inside code is the reader's to type, not a note.
	assert.deepEqual(lint(REPORT.replace('1. Click Retry.', '1. Run `S05 = 1`.')), []);
});

test('a finding ends where Run details or the verification starts', () => {
	const verified = REPORT.replace('</details>\n', '</details>\n\n<details>\n<summary>Verification details</summary>\n\n3. Same as Finding 1: a note from the verifier.\n\n</details>\n');
	assert.match(verified, /Same as Finding 1: a note from the verifier/);
	assert.deepEqual(lintReport(verified, LEDGER).filter(p => /points at another finding/.test(p)), []);
	// Inside a finding it is still a problem.
	const pointing = REPORT.replace('1. Click Retry.', '1. Same as Finding 1: click Retry.');
	assert.match(pointing, /1\. Same as Finding 1: click Retry\./);
	assert.equal(lintReport(pointing, LEDGER).filter(p => /points at another finding/.test(p)).length, 1);
});

const KNOWN = { issues: [
	{ number: 10, relation: 'fixes' },
	{ number: 11, relation: 'fixes' },
	{ number: 20, relation: 'linked' },
	{ number: 21, relation: 'linked', state: 'closed' },
] };
const lintKnown = ledger => lintReport(REPORT, ledger, { fileExists: () => true, knownIssues: KNOWN }).filter(p => /#\d|Issue:/.test(p));
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
	assert.deepEqual(lint(REPORT, withIssues('Issue: #99 observed\n', '')), []);
});

test('a step is one action, with no repeat count, second action, assumed state or session ID', () => {
	const step = text => lint(REPORT, LEDGER.replace('1. Open it.', `1. ${text}`)).filter(p => /S01 step 1/.test(p));
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
	assert.deepEqual(lint(REPORT.replace('1. Click Retry.', '1. Click Retry twice.')), ['report: Finding 1 step 1 repeats an action ("twice"); a step is one action, so write each one as its own step']);
	assert.deepEqual(lint(REPORT, LEDGER.replace('2. VERIFY it loads -> PASS', '2. VERIFY it loads, then shows twice -> PASS')), []);
});

test('a VERIFY is only the check, with the actions before it as steps of their own', () => {
	const check = text => lint(REPORT, LEDGER.replace('2. VERIFY it loads -> PASS', `2. VERIFY ${text} -> PASS`)).filter(p => /S01 step 2/.test(p));
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
	assert.deepEqual(lint(REPORT.replace('2. VERIFY the panel loads', '2. VERIFY clicking Retry loads the panel')).filter(p => /VERIFY does/.test(p)),
		['report: Finding 1 step 2 VERIFY does something ("clicking"); make it a step of its own before the check, and keep the VERIFY to what you expect to see']);
});

test('a failed scenario\'s Result is its rate only', () => {
	const result = text => lint(REPORT, LEDGER.replace('Result: Fails 2/2', `Result: ${text}`)).filter(p => /Result:/.test(p));
	assert.deepEqual(result('Fails 2/2'), []);
	assert.deepEqual(result('Retry leaves the panel empty'), ['ledger: S02 Result: of a failed scenario is its rate only, "Fails N/M"; the finding says what broke']);
});

test('flags a hedged title and an editorial Observed', () => {
	const titled = t => lint(REPORT.replace(/^### Finding 1: .*$/m, `### Finding 1: ${t}`)).filter(p => /title hedges/.test(p));
	assert.deepEqual(titled('Retry seems to do nothing'), ['report: Finding 1 title hedges with "seems"; state what the run saw as a fact']);
	assert.deepEqual(titled('Retry may leave the panel empty'), ['report: Finding 1 title hedges with "may"; state what the run saw as a fact']);
	assert.deepEqual(titled('Retry does nothing'), []);
	const observed = lint(REPORT.replace('**Feature:** console\n', '**Feature:** console\n\n**Observed:** The panel incorrectly stays empty.\n\n**Expected:** The panel loads.\n'));
	assert.deepEqual(observed, ['report: Finding 1 Observed: says "incorrectly"; say what happened in plain words and let the difference speak']);
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
	assert.deepEqual(splitProblems(retake).errors, []);
	// Taken again after S01-03: the file shows a later moment than step 2's check.
	const late = lintShotTiming(ledger, log(['S01-01.png', 'S01-02.png', 'S01-03.png', 'S01-02.png']));
	assert.ok(late.some(p => /so the file is only the last capture/.test(p)));
	assert.ok(splitProblems(late).errors.length >= 1);
});

test('errors are what makes a repro or its evidence wrong; wording and length are warnings', () => {
	// A Log-less FAIL, a semicolon in Observed, a two-action step and a long failed Result.
	const report = REPORT
		.replace('1. Click Retry.\n2. VERIFY', '1. Click Retry, then click Reload.\n2. VERIFY')
		.replace('**Feature:** console\n', '**Feature:** console\n\n**Observed:** The panel is empty; nothing loads.\n\n**Expected:** The panel loads.\n');
	const ledger = LEDGER.replace('   Log: none found in logs/r.log\n', '').replace('Result: Fails 2/2', 'Result: Retry leaves the panel empty');
	const { errors, warnings } = splitProblems(lint(report, ledger));
	assert.deepEqual(errors, ['ledger: S02 step 2 FAIL is missing Log:']);
	assert.deepEqual(warnings, [
		'report: Finding 1 Observed: joins notes with a semicolon; write it as sentences',
		'report: Finding 1 step 1 is two actions ("then click"); write each as its own step',
		'ledger: S02 Result: of a failed scenario is its rate only, "Fails N/M"; the finding says what broke',
	]);
});

test('each rule is an error or a warning, as the table in lint.mjs says', () => {
	const errors = [
		'ledger: S02 step 2 FAIL is missing Log:',
		'ledger: S02 step 2 VERIFY cites no screenshot; take one at the check (shot.sh) and keep any log or file evidence beside it',
		'ledger: a.png is Evidence for S01 step 2 and S02 step 2; take a screenshot for each check',
		'report: Finding 1\'s steps mix S01 and S02; the repro is one scenario\'s steps, and another run\'s screenshots go under Evidence, captioned "Step N:" for the step they prove',
		'report: Finding 1 screenshot a.png names no step; caption it "Step N:" for the step it proves or "S06:" for the scenario that took it, and if neither fits, add the step',
		'ledger: S01-01.png was taken 2 times in actions.log, so the file is only the last capture; give each capture its own name and cite the one taken at the check',
		'ledger: S01 step 3 cites S01-02.png, which actions.log took before S01-01.png (step 1); cite the shot taken at each check',
		'ledger: S01 step 2 names python-1a2b3c4d, which changes every launch; write a placeholder such as <Python session ID>',
		'report: missing the **Tested:** line above ## Findings',
		'report: Finding 1 has no "**Feature:** <feature>" line',
		'actions.log: line 3 (2026-10-05T03:58:25Z) is earlier than line 2 above it (2026-10-05T03:59:24Z); the log is append-only, so log a missed action as a note when you notice it, and never backdate or move a line',
		'actions.log: line 2 does not start with the UTC time the helpers write ("2026-01-02T03:04:05Z "), such as "22:39:56 rec.sh start"; log what no helper logged with `dp.ts log`, and never write or rewrite a line yourself',
	];
	const warnings = [
		'ledger: S01 step 2 repeats an action ("twice"); a step is one action, so write each one as its own step',
		'ledger: S01 step 2 is two actions ("then open"); write each as its own step',
		'ledger: S01 step 2 VERIFY does something ("type"); make it a step of its own before the check, and keep the VERIFY to what you expect to see',
		'ledger: S01 step 1 starts "With ..."; make what it assumes a precondition, or do it as a step of its own',
		'ledger: S02 Result: is 170 characters; keep it to one short sentence, and give anything you did not expect its own VERIFY step',
		'report: Finding 1 title hedges with "may"; state what the run saw as a fact',
		'report: Finding 1 Expected: says "incorrectly"; say what happened in plain words and let the difference speak',
		'report: Finding 1 Observed: names R, which the title does not; the reference that shows the right answer goes in Expected ("as R shows for the same data")',
		'report: Finding 1 step 2 has 3 screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out',
		'report: Finding 1 step 2 runs `library(x)`, which a precondition already sets up; start the steps after it',
		'report: cite shots as [shots/<file>](shots/<file>), not in backticks: "x"',
		'report: finding 1 is moderate and was tried once (1/1); keep the severity, and repeat its steps if the instance is still up',
	];
	assert.deepEqual(errors.filter(isWarning), []);
	assert.deepEqual(warnings.filter(p => !isWarning(p)), []);
});

test('a caption may name a range or qualify its step', () => {
	const captioned = caption => lint(REPORT
		.replace('1. Click Retry.', '**Repro**\n\n1. Click Retry.')
		.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel', `**Evidence**\n\n- [shots/a.png](shots/a.png) -- ${caption}`)).filter(p => /names no step/.test(p));
	assert.deepEqual(captioned('Step 2: empty panel'), []);
	assert.deepEqual(captioned('Step 2, another trigger: empty panel'), []);
	assert.deepEqual(captioned('Steps 1-2: empty panel'), []);
	assert.deepEqual(captioned('Step 2 (cold replay): empty panel'), []);
	assert.equal(captioned('A control: empty panel').length, 1);
});

test('a caption may name the scenario that took the shot instead of a step', () => {
	const captioned = (caption, report = REPORT) => lint(report
		.replace('1. Click Retry.', '**Repro**\n\n1. Click Retry.')
		.replace('- [shots/a.png](shots/a.png) -- Step 2: empty panel', `**Evidence**\n\n- [shots/a.png](shots/a.png) -- ${caption}`)).filter(p => /screenshot/.test(p));
	// S02 took a.png, so each form opens from the step that fails.
	for (const caption of ['S02: empty panel', 'Another run (S02): empty panel', 'a second Retry, still empty (S02)', 'Step 2: a second Retry (S02)']) {
		assert.deepEqual(captioned(caption), [], caption);
	}
	assert.deepEqual(captioned('S01: empty panel'), ['report: Finding 1 screenshot a.png is captioned S01, but S01 never cites it as Evidence; name the scenario that took it']);
	assert.deepEqual(captioned('S09: empty panel'), ['report: Finding 1 screenshot a.png is captioned S09, which the ledger does not have; name the scenario that took it']);
	// With no failing step on the card, a scenario alone has nowhere to open from.
	const passing = REPORT.replace('-> FAIL - Finding 1', '-> PASS');
	assert.ok(captioned('S02: empty panel', passing).some(p => /a\.png names no step/.test(p)));
});

test('the Verification section finish.mjs apply adds is the verifier\'s, so lint skips it', () => {
	const notes = '**VERDICTS:** 1=Confirmed\n\n- Ledger, S02 step 2: the VERIFY cites `shots/a.png`; it shows the panel.';
	assert.deepEqual(lint(applyVerification(REPORT, notes)), []);
	const failed = `_Verification did not complete: the reply had no VERDICTS line. The findings above are unreviewed._\n\n${notes}`;
	assert.deepEqual(lint(applyVerification(REPORT, failed, { failed: true })).filter(p => /backticks/.test(p)), []);
	// The explorer's own text is still read.
	assert.equal(lint(REPORT.replace('### Change under test', '### Change under test\n\nSee `shots/a.png`.')).filter(p => /backticks/.test(p)).length, 1);
});

test('the ledger alone is checked mid-run, without the report', () => {
	assert.deepEqual(lintLedgerOnly(LEDGER, { fileExists: () => true }), []);
	assert.deepEqual(lintLedgerOnly(LEDGER.replace('   Log: none found in logs/r.log\n', ''), { fileExists: () => true }), ['ledger: S02 step 2 FAIL is missing Log:']);
});

test('render.mjs --check fails on errors only, and checks a ledger alone without counting it', () => {
	const dir = mkdtempSync(join(tmpdir(), 'lint-check-'));
	const render = file => spawnSync(process.execPath, [fileURLToPath(new URL('./render.mjs', import.meta.url)), join(dir, file), '--check'], { encoding: 'utf8' });
	try {
		mkdirSync(join(dir, 'shots'));
		mkdirSync(join(dir, 'logs'));
		for (const f of ['shots/a.png', 'shots/p.png', 'logs/r.log']) { writeFileSync(join(dir, f), 'x'); }
		writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('Result: Fails 2/2', 'Result: Retry leaves the panel empty'));
		// No report yet: the ledger alone, with a warning only.
		const early = render('ledger.md');
		assert.equal(early.status, 0, early.stderr);
		assert.match(early.stderr, /format warnings[^\n]*\n {2}ledger: S02 Result: of a failed scenario/);
		assert.ok(!existsSync(join(dir, 'format-checks.jsonl')), 'a mid-run ledger check is not the report\'s first check');
		writeFileSync(join(dir, 'report.md'), REPORT);
		assert.equal(render('report.md').status, 0);
		writeFileSync(join(dir, 'ledger.md'), LEDGER.replace('   Log: none found in logs/r.log\n', ''));
		const failed = render('report.md');
		assert.equal(failed.status, 1);
		assert.match(failed.stderr, /format errors[^\n]*\n {2}ledger: S02 step 2 FAIL is missing Log:/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

