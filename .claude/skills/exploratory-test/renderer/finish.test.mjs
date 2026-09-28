/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateFindingsTable, applyVerification, buildVerifyPrompt, fromVerdictLine, hasFindings, isVerified, parseVerdicts } from './finish.mjs';

const TABLE = [
	'# Exploratory test: something',
	'',
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Reproduction |',
	'|---|---------|----------|--------|--------------|',
	'| 1 | first claim | major | blocks completion | 3/3 |',
	'| 2 | second claim | minor | cosmetic | 2/2 |',
	'',
	'### 1. first claim',
].join('\n');

test('parseVerdicts reads the machine-readable line', () => {
	const v = parseVerdicts('preamble\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\nprose');
	assert.equal(v.get(1), 'confirmed');
	assert.equal(v.get(2), 'disputed');
});

test('fromVerdictLine drops the notes before the VERDICTS line', () => {
	const reply = 'No conflicting evidence. I have enough to finalize.\n\nVERDICTS: 1=CONFIRMED\n\n- **Finding 1**: CONFIRMED.';
	assert.equal(fromVerdictLine(reply), 'VERDICTS: 1=CONFIRMED\n\n- **Finding 1**: CONFIRMED.');
	assert.equal(fromVerdictLine('VERDICTS: 1=CONFIRMED\nwhy'), 'VERDICTS: 1=CONFIRMED\nwhy');
	// No verdict line: keep everything, since the prose is all the reviewer gets.
	assert.equal(fromVerdictLine('just prose'), 'just prose');
	assert.equal(fromVerdictLine(null), null);
});

test('parseVerdicts returns empty when the line is absent', () => {
	assert.equal(parseVerdicts('no verdict line here').size, 0);
	assert.equal(parseVerdicts(null).size, 0);
});

test('annotateFindingsTable adds a verdict per row', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE'));
	assert.match(out, /\| # \| Finding \| Severity \| Impact \| Reproduction \| Verified \|/);
	assert.match(out, /\| 1 \| first claim .* \| confirmed \|/);
	assert.match(out, /\| 2 \| second claim .* \| disputed \|/);
});

test('annotateFindingsTable marks rows the verifier did not rule on', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED'));
	assert.match(out, /\| 2 \| second claim .* \| - \|/);
});

test('annotateFindingsTable leaves a report it cannot parse untouched', () => {
	const noTable = '# Report\n\n## Findings\n\nNo findings.\n';
	assert.equal(annotateFindingsTable(noTable, parseVerdicts('VERDICTS: 1=CONFIRMED')), noTable);
	assert.equal(annotateFindingsTable(TABLE, new Map()), TABLE);
});

test('hasFindings distinguishes a populated table from an empty one', () => {
	assert.equal(hasFindings(TABLE), true);
	assert.equal(hasFindings('## Findings\n\nNo findings.\n'), false);
	assert.equal(hasFindings([
		'| # | Finding | Severity |',
		'|---|---------|----------|',
		'| - | none | - |',
	].join('\n')), false);
	assert.equal(hasFindings(null), false);
});

const VERIFIER = readFileSync(new URL('../verifier.md', import.meta.url), 'utf8');
const RUN = { workDir: '/tmp/run', repoRoot: '/repo', baseSha: 'aaaa1111', headSha: 'bbbb2222' };

test('buildVerifyPrompt fills verifier.md with the run paths and diff range', () => {
	const prompt = buildVerifyPrompt(VERIFIER, RUN);
	assert.doesNotMatch(prompt, /\{\{/);
	assert.match(prompt, /^You are verifying an exploratory-test report/);
	assert.match(prompt, /Report: `\/tmp\/run\/report\.md`/);
	assert.match(prompt, /`\/tmp\/run\/files\/`/);
	assert.match(prompt, /git -C \/repo diff aaaa1111\.\.\.bbbb2222/);
	// parseVerdicts reads this line from the reply, so the example has to survive.
	assert.match(prompt, /\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n/);
});

test('buildVerifyPrompt throws when the template and its values drift apart', () => {
	assert.throws(() => buildVerifyPrompt(`${VERIFIER}\n{{NEW_THING}}`, RUN), /no value for \{\{NEW_THING\}\}/);
	assert.throws(() => buildVerifyPrompt(VERIFIER.replaceAll('{{FILES}}', ''), RUN), /\{\{FILES\}\} not in the template/);
});

test('applyVerification adds the column and a collapsed section', () => {
	const out = applyVerification(TABLE, 'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n\n- 1: repro holds.');
	assert.match(out, /\| 2 \| second claim .* \| disputed \|/);
	assert.match(out, /<details>\n<summary>Verification details<\/summary>\n\nA second agent re-read/);
	assert.match(out, /- 1: repro holds\.\n\n<\/details>\n$/);
	assert.ok(isVerified(out));
	assert.ok(!isVerified(TABLE));
});

test('applyVerification leaves a failed pass open, under its own heading', () => {
	const out = applyVerification(TABLE, '_Verification did not complete._', { failed: true });
	assert.match(out, /\n## Verification\n\n_Verification did not complete\._\n$/);
	assert.doesNotMatch(out, /<details>/);
	assert.ok(isVerified(out));
});

const SCRIPT = fileURLToPath(new URL('./finish.mjs', import.meta.url));

function runDir(report) {
	const dir = mkdtempSync(join(tmpdir(), 'finish-'));
	writeFileSync(join(dir, 'report.md'), report);
	return dir;
}

test('prompt writes the filled verifier prompt beside the report', () => {
	const dir = runDir(TABLE);
	try {
		const out = execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', '/repo', '--base', 'aaaa1111', '--head', 'bbbb2222'], { encoding: 'utf8' }).trim();
		assert.equal(out, join(dir, 'verify-prompt.md'));
		const prompt = readFileSync(out, 'utf8');
		assert.match(prompt, new RegExp(`Report: \`${dir}/report\\.md\``));
		assert.match(prompt, /git -C \/repo diff aaaa1111\.\.\.bbbb2222/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('prompt skips a report with no findings', () => {
	const dir = runDir('# Exploratory test: x\n\n## Findings\n\nNo findings.\n');
	try {
		const out = execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', '/repo', '--base', 'a', '--head', 'b'], { encoding: 'utf8' });
		assert.match(out, /no findings: nothing to verify/);
		assert.ok(!existsSync(join(dir, 'verify-prompt.md')));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('apply adds the verdicts once, from the VERDICTS line on', () => {
	const dir = runDir(`${TABLE}\n`);
	try {
		writeFileSync(join(dir, 'reply.md'), 'Let me finalize.\n\nVERDICTS: 1=CONFIRMED; 2=UNRESOLVED\n\n- 2: no log.');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		const report = readFileSync(join(dir, 'report.md'), 'utf8');
		assert.match(report, /\| 2 \| second claim .* \| unresolved \|/);
		assert.doesNotMatch(report, /Let me finalize/);
		// A second apply would add a second column.
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')], { stdio: 'pipe' }), e => e.status === 1 && /already verified/.test(e.stderr));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('apply marks the findings unreviewed when the reply has no verdicts', () => {
	for (const reply of ['', 'I could not read the report.']) {
		const dir = runDir(TABLE);
		try {
			writeFileSync(join(dir, 'reply.md'), reply);
			execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
			const report = readFileSync(join(dir, 'report.md'), 'utf8');
			assert.match(report, /\n## Verification\n\n_Verification did not complete.*The findings above are unreviewed\._/);
			assert.doesNotMatch(report, /Verified \|/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test('apply refuses a reply file that is not there, and leaves the report free for a retry', () => {
	const dir = runDir(`${TABLE}\n`);
	try {
		const before = readFileSync(join(dir, 'report.md'), 'utf8');
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'typo.md')], { stdio: 'pipe' }), e => e.status === 2 && /reply file not found/.test(e.stderr));
		assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), before);
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 1=CONFIRMED');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /\| 1 \| first claim .* \| confirmed \|/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('isVerified ignores a Verification heading the explorer wrote itself', () => {
	assert.ok(!isVerified(`${TABLE}\n\n## Verification\n\nChecked the build.\n`));
	assert.ok(isVerified(applyVerification(TABLE, '_Verification did not complete._', { failed: true })));
});
