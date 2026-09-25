/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintReport } from './lint.mjs';

const REPORT = `# Exploratory test: x

\`main\` | \`abc1234\`

**Result:** The panel loads.
**Tested:** the panel
**Not exercised:** the web build

## Findings

| # | Finding | Severity | Impact | Reproduction |
|---|---------|----------|--------|--------------|
| 1 | Retry does nothing | moderate | stays empty | 2/2 |

### Finding 1: Retry does nothing

1. Click Retry.
2. VERIFY the panel loads -> FAIL - Finding 1

- [shots/a.png](shots/a.png) -- Step 2: empty panel

<details>
<summary>Run details</summary>

### Change under test

</details>
`;

const LEDGER = `# Test ledger

## S01 - Panel loads
Status: pass
Result: loads

Steps:
1. Open it.
2. VERIFY it loads -> PASS
   Evidence: a.png

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

test('fenced code does not count as a heading', () => {
	assert.deepEqual(lint(REPORT.replace('## Findings', '```\n# not a heading\n```\n\n## Findings')), []);
});

test('flags a missing summary label and a question-shaped Result', () => {
	const problems = lint(REPORT.replace('**Result:** The panel loads.', '**Result:** Yes, mostly.').replace(/\*\*Not exercised:\*\*.*\n/, ''));
	assert.ok(problems.some(p => /Result:\*\* answers a question/.test(p)));
	assert.ok(problems.some(p => /missing the \*\*Not exercised:\*\*/.test(p)));
});

test('flags table values outside the allowed words', () => {
	const problems = lint(REPORT.replace('| moderate | stays empty | 2/2 |', '| High | stays empty | often |'));
	assert.equal(problems.filter(p => /finding 1 (Severity|Reproduction)/.test(p)).length, 2);
});

test('flags an Introduced? or Origin column', () => {
	const table = REPORT
		.replace('| Impact | Reproduction |', '| Impact | Introduced? | Reproduction |')
		.replace('|--------|--------------|', '|--------|---|--------------|')
		.replace('| stays empty | 2/2 |', '| stays empty | yes | 2/2 |');
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

test('flags a FAIL without Log:, a pass without a screenshot and a bad Status', () => {
	const ledger = LEDGER
		.replace('   Log: none found in logs/r.log\n', '')
		.replace('   Evidence: a.png\n\n## S02', '\n## S02')
		.replace('Status: fail - Finding 1', 'Status: failed');
	const problems = lint(REPORT, ledger);
	assert.ok(problems.some(p => /S02 FAIL check 1 is missing Log:/.test(p)));
	assert.ok(problems.some(p => /S01 passes with no Evidence/.test(p)));
	assert.ok(problems.some(p => /S02 Status: must be/.test(p)));
});

test('Evidence: counts only a file that is in shots/', () => {
	const prose = LEDGER.replace(/Evidence: a\.png/g, 'Evidence: none; DOM read only');
	const problems = lint(REPORT, prose);
	assert.ok(problems.some(p => /S01 passes with no Evidence: naming a screenshot/.test(p)));
	assert.ok(problems.some(p => /S02 FAIL check 1 is missing Evidence: \(a screenshot file\)/.test(p)));

	const invented = lintReport(REPORT, LEDGER.replace('Evidence: a.png\n\n## S02', 'Evidence: shots/made-up.png\n\n## S02'), { fileExists: f => f === 'shots/a.png' });
	assert.ok(invented.some(p => /S01 cites Evidence: made-up\.png, which is not in shots\//.test(p)));
	assert.ok(invented.some(p => /S01 passes with no Evidence/.test(p)));
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
