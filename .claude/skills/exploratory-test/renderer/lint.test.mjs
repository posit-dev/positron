/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintReport, lintShotNames } from './lint.mjs';

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
});

test('a check with nothing on screen may cite a saved output under logs/ or files/', () => {
	const ledger = '# Test ledger\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY port 8000 is closed -> PASS\n   Evidence: logs/listeners-after.txt\n2. VERIFY the file says 1 -> PASS\n   Evidence: logs/missing.txt\n';
	const has = p => p === 'logs/listeners-after.txt';
	const problems = lintReport(REPORT, ledger, { fileExists: has }).filter(p => /S01/.test(p));
	assert.deepEqual(problems, ['ledger: S01 cites Evidence: logs/missing.txt, which is not in the run directory', 'ledger: S01 step 2 VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own']);
});

test('a file saved under a mirrored folder is found by its bare name, and a long extension is kept', () => {
	const report = REPORT.replace('**Feature:** console\n\n1. Click Retry.', '**Feature:** console\n\n**Repro**\n\n**Preconditions:**\n- app | `app.R` in the `rapp` folder of the workspace\n\n1. Click Retry.');
	const ledger = '# Test ledger\n\n## Files\n- files/rapp/app.R | app | S01; Finding 1\n\n## S01 - x\nStatus: pass\nResult: ok\n\nSteps:\n1. VERIFY rows -> PASS\n   Evidence: logs/S01-products.parquet\n';
	const has = p => ['files/rapp/app.R', 'logs/S01-products.parquet'].includes(p);
	const problems = lintReport(report, ledger, { fileExists: has, listFiles: () => ['files/rapp/app.R'] }).filter(p => /app\.R|parquet|parqu/.test(p));
	assert.deepEqual(problems, []);
});

test('flags a cited screenshot that actions.log never took by that name', () => {
	const ledger = '## S01 - x\nStatus: pass\n\nSteps:\n1. VERIFY a -> PASS\n   Evidence: S01-02.png, S01-02b.png\n2. VERIFY b -> PASS\n   Evidence: shots/S01-04.png\n';
	const log = '20:00:01 screenshot S01-02\n20:00:02 playwright screenshot --filename=/r/shots/S01-02b.png\n20:00:03 screenshot S01-03.png\n';
	assert.deepEqual(lintShotNames(ledger, log), ['ledger: S01-04.png is cited as Evidence but actions.log never takes a shot by that name; keep the name a shot was taken with, or log the rename']);
	assert.deepEqual(lintShotNames(ledger, log + '20:00:04 renamed S01-03.png to S01-04.png\n'), []);
});

test('flags a moderate or major finding tried only once', () => {
	const rate = (sev, r) => lint(REPORT.replace('| moderate | 2/2 |', `| ${sev} | ${r} |`)).filter(p => /tried once/.test(p));
	assert.deepEqual(rate('moderate', '1/1'), ['report: finding 1 is moderate but was tried once (1/1); repeat its steps in the same instance and give the rate over at least 2 tries']);
	assert.equal(rate('major', '1/1').length, 1);
	assert.deepEqual(rate('minor', '1/1'), []);
	assert.deepEqual(rate('moderate', '1/2'), []);
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
	assert.ok(problems.some(p => /S01 step 2 VERIFY has no Evidence/.test(p)));
	assert.ok(problems.some(p => /S02 Status: must be/.test(p)));
});

test('every VERIFY needs its own screenshot, not just one per scenario', () => {
	const ledger = LEDGER.replace('   Evidence: p.png\n', '   Evidence: p.png\n3. VERIFY the header shows -> PASS\n');
	assert.deepEqual(lint(REPORT, ledger), ['ledger: S01 step 3 VERIFY has no Evidence: naming a screenshot in shots/; every check gets its own']);

	const reused = LEDGER.replace('Evidence: p.png', 'Evidence: a.png');
	assert.deepEqual(lint(REPORT, reused), ['ledger: a.png is Evidence for S01 step 2 and S02 step 2; take a screenshot for each check']);
});

test('Evidence: counts only a file that is in shots/', () => {
	const prose = LEDGER.replace(/Evidence: [ap]\.png/g, 'Evidence: none; DOM read only');
	const problems = lint(REPORT, prose);
	assert.ok(problems.some(p => /S01 step 2 VERIFY has no Evidence: naming a screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 step 2 VERIFY has no Evidence: naming a screenshot/.test(p)));

	const invented = lintReport(REPORT, LEDGER.replace('Evidence: p.png', 'Evidence: shots/made-up.png'), { fileExists: f => f === 'shots/a.png' });
	assert.ok(invented.some(p => /S01 cites Evidence: made-up\.png, which is not in shots\//.test(p)));
	assert.ok(invented.some(p => /S01 step 2 VERIFY has no Evidence/.test(p)));
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
	const flagged = caption => lint(shot(caption)).some(p => /Finding 1 screenshot a\.png names no step; caption it "Step N:" for the step it proves, and if no step matches, add the step/.test(p));
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
	assert.deepEqual(problems(shots('a.png, b.png', ['- [shots/b.png](shots/b.png) -- Step 2: later', '- [shots/c.png](shots/c.png) -- Step 2: pandas loads'])),
		['report: Finding 1 step 2 has 3 screenshots; keep the one that shows the check, add a second only for a different moment, and make a control its own step or leave it out']);
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
	assert.ok(problems.some(p => /S01 #20 is a linked issue/.test(p)));
	assert.ok(problems.some(p => /S02 #10 is a fix the PR claims/.test(p)));
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
