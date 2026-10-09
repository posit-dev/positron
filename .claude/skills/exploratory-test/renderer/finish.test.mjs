/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotateFindingsTable, applyVerification, buildVerifyPrompt, findingNumbers, fromVerdictLine, hasFindings, isVerified, observedLinked, parseFeatures, parseIntended, parseKnown, parseTitles, parseVerdicts, verdictMismatch, verifyLogLines } from './finish.mjs';

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

test('parseKnown reads the issue numbers per finding and skips what it cannot read', () => {
	const k = parseKnown('VERDICTS: 1=CONFIRMED\nKNOWN: 2=#15102; 3=#14991, #15153; 4=none; x=#1; 5=#7,#7\nprose');
	assert.deepEqual([...k], [[2, [15102]], [3, [14991, 15153]], [5, [7]]]);
	assert.equal(parseKnown('VERDICTS: 1=CONFIRMED').size, 0);
	assert.equal(parseKnown(null).size, 0);
});

test('parseIntended reads its own line, not KNOWN', () => {
	const reply = 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nKNOWN: 1=#15102\nINTENDED: 2=#14210; x=#1';
	assert.deepEqual([...parseIntended(reply)], [[2, [14210]]]);
	assert.deepEqual([...parseKnown(reply)], [[1, [15102]]]);
});

test('parseFeatures reads the feature per finding and skips what it cannot read', () => {
	const f = parseFeatures('VERDICTS: 1=CONFIRMED\nFEATURE: 1=new folder flow; 2="modal dialogs"; 3=; x=console; 4=a | b\nprose');
	assert.deepEqual([...f], [[1, 'new folder flow'], [2, 'modal dialogs']]);
	assert.equal(parseFeatures('VERDICTS: 1=CONFIRMED').size, 0);
	assert.equal(parseFeatures(null).size, 0);
});

const BLOCKS = [
	TABLE.replace('### 1. first claim', '### Finding 1: first claim'),
	'',
	'**Feature:** modal dialogs',
	'',
	'### Finding 2: second claim',
	'',
	'**Feature:** console',
].join('\n');

test('applyVerification rewrites the Feature of a finding on the FEATURE line only', () => {
	const out = applyVerification(BLOCKS, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nFEATURE: 1=new folder flow\n\n- 1: holds.');
	assert.match(out, /### Finding 1: first claim\n\n\*\*Feature:\*\* new folder flow\n/);
	assert.match(out, /### Finding 2: second claim\n\n\*\*Feature:\*\* console/);
	assert.doesNotMatch(out, /\*\*Feature:\*\* modal dialogs/);
});

test('applyVerification retitles a finding on the TITLE line in its heading and table row only', () => {
	const report = `${BLOCKS}\n\n## Coverage\n\n| 1 | not a finding | pass |`;
	const out = applyVerification(report, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nTITLE: 1=a slow reply drops the project R\n\n- 1: holds.');
	assert.match(out, /^\| 1 \| a slow reply drops the project R \| major \| blocks completion \| 3\/3 \| confirmed \|$/m);
	assert.match(out, /### Finding 1: a slow reply drops the project R\n/);
	assert.match(out, /### Finding 2: second claim/);
	assert.match(out, /\| 1 \| not a finding \| pass \|/, 'other tables are left alone');
	assert.deepEqual([...parseTitles('TITLE: 1=x; 2=a | b')], [[1, 'x']]);
});

test('applyVerification leaves Feature alone on a failed pass or a finding with no Feature line', () => {
	const reply = 'VERDICTS: 1=CONFIRMED\nFEATURE: 1=new folder flow; 2=data explorer';
	assert.match(applyVerification(BLOCKS, `_Verification did not complete._\n\n${reply}`, { failed: true }), /\*\*Feature:\*\* modal dialogs/);
	const noLine = BLOCKS.replace('**Feature:** console', 'no feature here');
	assert.doesNotMatch(applyVerification(noLine, reply), /\*\*Feature:\*\* data explorer/);
});

test('fromVerdictLine keeps a FEATURE line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nFEATURE: 1=console\nVERDICTS: 1=CONFIRMED'), 'FEATURE: 1=console\nVERDICTS: 1=CONFIRMED');
});

test('fromVerdictLine keeps a KNOWN line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nKNOWN: 1=#5\nVERDICTS: 1=CONFIRMED'), 'KNOWN: 1=#5\nVERDICTS: 1=CONFIRMED');
});

test('annotateFindingsTable adds a Known column after Verified when an issue matched', () => {
	const out = annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED; 2=CONFIRMED'), parseKnown('KNOWN: 2=#15102,#14991'));
	assert.match(out, /\| Reproduction \| Verified \| Known \|\n\|[-|]+---\|---\|\n/);
	assert.match(out, /\| 1 \| first claim .* \| confirmed \| - \|/);
	assert.match(out, /\| 2 \| second claim .* \| confirmed \| #15102, #14991 \|/);
	// No match, no column.
	assert.doesNotMatch(annotateFindingsTable(TABLE, parseVerdicts('VERDICTS: 1=CONFIRMED')), /Known/);
});

test('fromVerdictLine keeps an INTENDED line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nINTENDED: 1=#5\nVERDICTS: 1=CONFIRMED'), 'INTENDED: 1=#5\nVERDICTS: 1=CONFIRMED');
});

test('applyVerification adds an Intended column after Known, and drops nothing', () => {
	const out = applyVerification(TABLE, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nKNOWN: 1=#15102\nINTENDED: 2=#14210');
	assert.match(out, /\| Reproduction \| Verified \| Known \| Intended \|\n/);
	assert.match(out, /\| 1 \| first claim .* \| confirmed \| #15102 \| - \|/);
	assert.match(out, /\| 2 \| second claim .* \| confirmed \| - \| #14210 \|/);
});

test('applyVerification adds the Known column from the reply', () => {
	const out = applyVerification(TABLE, 'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\nKNOWN: 1=#15102\n\n- 1: same as #15102.');
	assert.match(out, /\| 1 \| first claim .* \| confirmed \| #15102 \|/);
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
	assert.match(prompt, /`node \/\S+\/renderer\/known-issues\.mjs --search "<key terms>"`/);
	// parseVerdicts reads this line from the reply, so the example has to survive.
	assert.match(prompt, /\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n/);
	assert.match(prompt, /\nKNOWN: 2=#15102; 3=#14991,#15153\n/);
});

test('buildVerifyPrompt gives the verifier lint\'s check of actions.log', () => {
	const check = actionsLog => buildVerifyPrompt(VERIFIER, { ...RUN, actionsLog }).split('\n').filter(l => /lint's check of it|^- actions\.log:/.test(l));
	assert.deepEqual(check('2026-10-05T03:59:24Z shot.sh -s=p: screenshot S01-01.png\n'), [
		'The reporting agent\'s own action log, with timestamps: `/tmp/run/actions.log`. Only the helpers write it, and only by appending; lint\'s check of it: clean: every line is stamped as the helpers stamp it, in time order.',
	]);
	const backdated = check('2026-10-05T03:59:24Z shot.sh -s=p: screenshot S01-01.png\n2026-10-05T03:58:25Z raw press Escape\n');
	assert.equal(backdated.length, 2);
	assert.match(backdated[1], /^- actions\.log: line 2 \(2026-10-05T03:58:25Z\) is earlier than line 1 above it/);
	// No log at the run's path: said so, not passed off as clean.
	assert.match(buildVerifyPrompt(VERIFIER, RUN), /lint's check of it: no actions\.log in the run directory\./);
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
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED');
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

const NO_FINDINGS = '# Exploratory test: x\n\n## Findings\n\nNo findings.\n';
const KNOWN_JSON = { issues: [{ number: 20, relation: 'linked' }, { number: 21, relation: 'linked' }, { number: 10, relation: 'fixes' }] };
const SEEN_LEDGER = '## S01 - a\nStatus: pass\nIssue: #20 observed\nIssue: #10 fix held\n\n## S02 - b\nStatus: pass\nIssue: #21 observed\n';

test('observedLinked lists the linked issues the ledger saw, never fixes', () => {
	assert.deepEqual(observedLinked(KNOWN_JSON, SEEN_LEDGER).sort(), [20, 21]);
	assert.deepEqual(observedLinked(null, SEEN_LEDGER), []);
	assert.deepEqual(observedLinked(KNOWN_JSON, ''), []);
});

test('verifyLogLines names each observed issue the reply gave no severity', () => {
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, 'VERDICTS: none\nLINKED: #20=minor; #21=awful'), ['Couldn\'t rate #21: verifier line missing or malformed']);
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, ''), ['Couldn\'t rate #20: verifier line missing or malformed', 'Couldn\'t rate #21: verifier line missing or malformed']);
	assert.deepEqual(verifyLogLines(null, SEEN_LEDGER, ''), []);
});

test('verifyLogLines logs a KNOWN match on a fix, which the report does not show', () => {
	const reply = 'VERDICTS: 1=CONFIRMED\nKNOWN: 1=#10\nLINKED: #20=minor; #21=minor';
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, reply), ['Finding 1 matches #10, which this PR fixes; the explorer may have missed a fix that didn\'t hold.']);
});

test('fromVerdictLine keeps a LINKED line', () => {
	assert.equal(fromVerdictLine('notes\nVERDICTS: none\nLINKED: #5=minor'), 'VERDICTS: none\nLINKED: #5=minor');
});

function knownRunDir() {
	const dir = runDir(NO_FINDINGS);
	writeFileSync(join(dir, 'ledger.md'), SEEN_LEDGER);
	writeFileSync(join(dir, 'known-issues.json'), JSON.stringify(KNOWN_JSON));
	return dir;
}

test('prompt still runs with no findings when the run saw a linked issue, and names the issues file', () => {
	const dir = knownRunDir();
	try {
		const out = execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', '/repo', '--base', 'a', '--head', 'b'], { encoding: 'utf8' }).trim();
		assert.equal(out, join(dir, 'verify-prompt.md'));
		assert.ok(readFileSync(out, 'utf8').includes(`\`${join(dir, 'known-issues.json')}\``));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('apply takes a VERDICTS: none reply and logs the issues it left unrated', () => {
	const dir = knownRunDir();
	try {
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: none\nLINKED: #20=moderate\n\n- #20: the panel jumped.\n\nNo process issues.');
		const run = spawnSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')], { encoding: 'utf8' });
		assert.equal(run.status, 0, run.stderr);
		assert.match(run.stderr, /finish: Couldn't rate #21: verifier line missing or malformed/);
		assert.doesNotMatch(run.stderr, /#20/);
		const report = readFileSync(join(dir, 'report.md'), 'utf8');
		assert.match(report, /<summary>Verification details<\/summary>[\s\S]*LINKED: #20=moderate/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('applyVerification leaves a finding\'s lines alone when the reply has an old IMPACT line', () => {
	// Impact is gone, so an old verifier's IMPACT line rewrites nothing.
	const reply = 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nIMPACT 1: The work is lost.\n\n- 1: holds.';
	const out = applyVerification(BLOCKS, reply);
	assert.doesNotMatch(out.slice(0, out.indexOf('Verification details')), /\*\*Impact:\*\*/);
});

// A table sorted by severity, as reports write it: row 1 is Finding 4.
const SORTED = [
	'## Findings',
	'',
	'| # | Finding | Severity | Impact | Reproduction |',
	'|---|---------|----------|--------|--------------|',
	'| 4 | data lost | major | blocks completion | 3/3 |',
	'| 1 | wrong label | minor | cosmetic | 2/2 |',
	'| 2 | slow reload | minor | cosmetic | 2/2 |',
	'',
].join('\n');

test('findingNumbers reads the # column in table order', () => {
	assert.deepEqual(findingNumbers(SORTED), [4, 1, 2]);
	assert.deepEqual(findingNumbers('no table'), []);
});

test('verdictMismatch names the numbers a reply keyed by row order gets wrong', () => {
	assert.equal(verdictMismatch(SORTED, 'VERDICTS: 4=CONFIRMED; 1=CONFIRMED; 2=FALSE POSITIVE'), '');
	const why = verdictMismatch(SORTED, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED; 3=FALSE POSITIVE');
	assert.match(why, /gives findings 1, 2, 3, but the report's findings are 1, 2, 4; missing 4; not in the report: 3\./);
	assert.match(why, /by the Finding number as written/);
});

test('apply refuses verdicts keyed to other numbers, writes nothing, and takes a corrected reply', () => {
	const dir = runDir(`# Exploratory test: x\n\n${SORTED}\n`);
	try {
		const before = readFileSync(join(dir, 'report.md'), 'utf8');
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED; 3=FALSE POSITIVE\n\n- 3: no.');
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')], { stdio: 'pipe' }), e => e.status === 1 && /missing 4; not in the report: 3/.test(e.stderr));
		assert.equal(readFileSync(join(dir, 'report.md'), 'utf8'), before);
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 4=FALSE POSITIVE; 1=CONFIRMED; 2=CONFIRMED\n\n- 4: no.');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		assert.match(readFileSync(join(dir, 'report.md'), 'utf8'), /\| 4 \| data lost .* \| disputed \|/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the verify prompt says to key verdicts by Finding number, not row order', () => {
	assert.match(VERIFIER, /Key every entry, on this line and every line below, by\nthe Finding number as written/);
	assert.match(VERIFIER, /Never by the row's position/);
});
