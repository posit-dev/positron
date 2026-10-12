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
import { applyVerification, buildVerifyPrompt, changeBase, findingNumbers, fromVerdictLine, hasFindings, isVerified, observedLinked, parseFeatures, parseIntended, parseKnown, parseTitles, parseVerdicts, verdictMismatch, verifyLogLines } from './finish.mjs';

/** report.json with two findings, as the explorer writes them. */
const REPORT = {
	header: { title: 'Exploratory test: something', result: 'It works.' },
	findings: [
		{ n: 1, title: 'first claim', feature: 'modal dialogs', severity: 'major', reproduced: { n: 3, m: 3 } },
		{ n: 2, title: 'second claim', feature: 'console', severity: 'minor', reproduced: { n: 2, m: 2 } },
	],
};

/** What the verifier wrote on each finding, by number. */
const marks = report => Object.fromEntries(report.findings.map(f => [f.n, Object.fromEntries(['title', 'feature', 'verified', 'known', 'intended'].filter(k => f[k] !== undefined).map(k => [k, f[k]]))]));

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

test('applyVerification marks each finding with its verdict, and only the ones it ruled on', () => {
	assert.deepEqual(marks(applyVerification(REPORT, 'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE')), {
		1: { title: 'first claim', feature: 'modal dialogs', verified: 'confirmed' },
		2: { title: 'second claim', feature: 'console', verified: 'disputed' },
	});
	assert.equal(applyVerification(REPORT, 'VERDICTS: 1=CONFIRMED').findings[1].verified, undefined);
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

test('applyVerification rewrites the Feature and title of a finding on the FEATURE and TITLE lines only', () => {
	const out = applyVerification(REPORT, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nFEATURE: 1=new folder flow\nTITLE: 1=a slow reply drops the project R\n\n- 1: holds.');
	assert.deepEqual(marks(out), {
		1: { title: 'a slow reply drops the project R', feature: 'new folder flow', verified: 'confirmed' },
		2: { title: 'second claim', feature: 'console', verified: 'confirmed' },
	});
	assert.deepEqual([...parseTitles('TITLE: 1=x; 2=a | b')], [[1, 'x']]);
});

test('applyVerification leaves the Feature and title alone on a failed pass', () => {
	const reply = 'VERDICTS: 1=CONFIRMED\nFEATURE: 1=new folder flow\nTITLE: 1=other';
	const out = applyVerification(REPORT, `_Verification did not complete._\n\n${reply}`, { failed: true });
	assert.deepEqual([out.findings[0].feature, out.findings[0].title], ['modal dialogs', 'first claim']);
});

test('fromVerdictLine keeps a FEATURE line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nFEATURE: 1=console\nVERDICTS: 1=CONFIRMED'), 'FEATURE: 1=console\nVERDICTS: 1=CONFIRMED');
});

test('fromVerdictLine keeps a KNOWN line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nKNOWN: 1=#5\nVERDICTS: 1=CONFIRMED'), 'KNOWN: 1=#5\nVERDICTS: 1=CONFIRMED');
});

test('applyVerification adds the known and intended issues the reply matched, and drops nothing', () => {
	const out = applyVerification(REPORT, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED\nKNOWN: 1=#15102,#14991\nINTENDED: 2=#14210');
	assert.deepEqual(marks(out), {
		1: { title: 'first claim', feature: 'modal dialogs', verified: 'confirmed', known: [15102, 14991] },
		2: { title: 'second claim', feature: 'console', verified: 'confirmed', intended: [14210] },
	});
});

test('fromVerdictLine keeps an INTENDED line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('notes\nINTENDED: 1=#5\nVERDICTS: 1=CONFIRMED'), 'INTENDED: 1=#5\nVERDICTS: 1=CONFIRMED');
});

test('hasFindings is true only for a report with a finding', () => {
	assert.equal(hasFindings(REPORT), true);
	assert.equal(hasFindings({ findings: [] }), false);
	assert.equal(hasFindings(null), false);
});

const VERIFIER = readFileSync(new URL('../../verifier.md', import.meta.url), 'utf8');
const RUN = { workDir: '/tmp/run', repoRoot: '/repo', baseSha: 'aaaa1111', headSha: 'bbbb2222' };

test('buildVerifyPrompt fills verifier.md with the run paths and diff range', () => {
	const prompt = buildVerifyPrompt(VERIFIER, RUN);
	assert.doesNotMatch(prompt, /\{\{/);
	assert.match(prompt, /^You are verifying an exploratory-test report/);
	assert.match(prompt, /Report: `\/tmp\/run\/report\.json`/);
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

test('applyVerification keeps the reply under the preamble, for the collapsed section', () => {
	const out = applyVerification(REPORT, 'VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n\n- 1: repro holds.');
	assert.deepEqual(out.verification, { failed: false, text: 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was changed or removed.\n\nVERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE\n\n- 1: repro holds.' });
	assert.ok(isVerified(out));
	assert.ok(!isVerified(REPORT));
});

test('applyVerification keeps a failed pass as it was said, marked failed', () => {
	const out = applyVerification(REPORT, '_Verification did not complete._', { failed: true });
	assert.deepEqual(out.verification, { failed: true, text: '_Verification did not complete._' });
	assert.ok(isVerified(out));
});

const SCRIPT = fileURLToPath(new URL('./finish.mjs', import.meta.url));

function runDir(report) {
	const dir = mkdtempSync(join(tmpdir(), 'finish-'));
	writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
	return dir;
}

const readJson = dir => JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));

test('prompt writes the filled verifier prompt beside the report', () => {
	const dir = runDir(REPORT);
	try {
		const out = execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', '/repo', '--base', 'aaaa1111', '--head', 'bbbb2222'], { encoding: 'utf8' }).trim();
		assert.equal(out, join(dir, 'verify-prompt.md'));
		const prompt = readFileSync(out, 'utf8');
		assert.match(prompt, new RegExp(`Report: \`${dir}/report\\.json\``));
		assert.match(prompt, /git -C \/repo diff aaaa1111\.\.\.bbbb2222/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('prompt skips a report with no findings', () => {
	const dir = runDir({ findings: [] });
	try {
		const out = execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', '/repo', '--base', 'a', '--head', 'b'], { encoding: 'utf8' });
		assert.match(out, /no findings: nothing to verify/);
		assert.ok(!existsSync(join(dir, 'verify-prompt.md')));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('apply adds the verdicts once, from the VERDICTS line on', () => {
	const dir = runDir(REPORT);
	try {
		writeFileSync(join(dir, 'reply.md'), 'Let me finalize.\n\nVERDICTS: 1=CONFIRMED; 2=UNRESOLVED\n\n- 2: no log.');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		const report = readJson(dir);
		assert.equal(report.findings[1].verified, 'unresolved');
		assert.doesNotMatch(report.verification.text, /Let me finalize/);
		// A second apply would add a second column.
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')], { stdio: 'pipe' }), e => e.status === 1 && /already verified/.test(e.stderr));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('apply marks the findings unreviewed when the reply has no verdicts', () => {
	for (const reply of ['', 'I could not read the report.']) {
		const dir = runDir(REPORT);
		try {
			writeFileSync(join(dir, 'reply.md'), reply);
			execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
			const report = readJson(dir);
			assert.equal(report.verification.failed, true);
			assert.match(report.verification.text, /^_Verification did not complete.*The findings above are unreviewed\._/);
			assert.ok(report.findings.every(f => f.verified === undefined));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

test('apply refuses a reply file that is not there, and leaves the report free for a retry', () => {
	const dir = runDir(REPORT);
	try {
		const before = readFileSync(join(dir, 'report.json'), 'utf8');
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'typo.md')], { stdio: 'pipe' }), e => e.status === 2 && /reply file not found/.test(e.stderr));
		assert.equal(readFileSync(join(dir, 'report.json'), 'utf8'), before);
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		assert.equal(readJson(dir).findings[0].verified, 'confirmed');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

const NO_FINDINGS = { findings: [] };
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
		assert.match(readJson(dir).verification.text, /LINKED: #20=moderate/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

// Findings listed worst first, as the explorer lists them: the first is Finding 4.
const SORTED = { findings: [{ n: 4, title: 'data lost' }, { n: 1, title: 'wrong label' }, { n: 2, title: 'slow reload' }] };

test('findingNumbers reads the findings in their order', () => {
	assert.deepEqual(findingNumbers(SORTED), [4, 1, 2]);
	assert.deepEqual(findingNumbers({}), []);
});

test('verdictMismatch names the numbers a reply keyed by row order gets wrong', () => {
	assert.equal(verdictMismatch(SORTED, 'VERDICTS: 4=CONFIRMED; 1=CONFIRMED; 2=FALSE POSITIVE'), '');
	const why = verdictMismatch(SORTED, 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED; 3=FALSE POSITIVE');
	assert.match(why, /gives findings 1, 2, 3, but the report's findings are 1, 2, 4; missing 4; not in the report: 3\./);
	assert.match(why, /by the finding's number, its `n`/);
});

test('apply refuses verdicts keyed to other numbers, writes nothing, and takes a corrected reply', () => {
	const dir = runDir(SORTED);
	try {
		const before = readFileSync(join(dir, 'report.json'), 'utf8');
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 1=CONFIRMED; 2=CONFIRMED; 3=FALSE POSITIVE\n\n- 3: no.');
		assert.throws(() => execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')], { stdio: 'pipe' }), e => e.status === 1 && /missing 4; not in the report: 3/.test(e.stderr));
		assert.equal(readFileSync(join(dir, 'report.json'), 'utf8'), before);
		writeFileSync(join(dir, 'reply.md'), 'VERDICTS: 4=FALSE POSITIVE; 1=CONFIRMED; 2=CONFIRMED\n\n- 4: no.');
		execFileSync('node', [SCRIPT, 'apply', dir, join(dir, 'reply.md')]);
		assert.equal(readJson(dir).findings[0].verified, 'disputed');
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test('the verify prompt says to key verdicts by finding number, not position', () => {
	assert.match(VERIFIER, /Key every entry, on this line and every line below, by the\nfinding's number as written, its `n`/);
	assert.match(VERIFIER, /Never by its position/);
});

/** A throwaway repo with two commits, for changeBase's rev-list. */
function twoCommitRepo() {
	const repo = mkdtempSync(join(tmpdir(), 'finish-git-'));
	const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();
	git('init', '-q');
	git('commit', '-q', '--allow-empty', '-m', 'base');
	const base = git('rev-parse', 'HEAD');
	git('commit', '-q', '--allow-empty', '-m', 'change');
	return { repo, base, head: git('rev-parse', 'HEAD') };
}

test('changeBase is usable only with commits between the base and the head', () => {
	const { repo, base, head } = twoCommitRepo();
	try {
		assert.deepEqual(changeBase(repo, base, head, 'main'), { usable: true, reason: '', name: 'main' });
		assert.deepEqual(changeBase(repo, base, head), { usable: true, reason: '', name: null });
		assert.equal(changeBase(repo, '', head, 'main').usable, false);
		assert.equal(changeBase(repo, head, head, 'main').usable, false);
		// A main run: the head is behind or at the base, so nothing is the change's.
		assert.deepEqual(changeBase(repo, head, base, 'main'), { usable: false, reason: 'no commits between the base and the head', name: 'main' });
		assert.equal(changeBase('/no/such/repo', base, head).usable, false);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});

test('buildVerifyPrompt asks for a CHANGE line only when the base is usable', () => {
	const usable = buildVerifyPrompt(VERIFIER, { ...RUN, changeBase: { usable: true } });
	assert.match(usable, /The change under test is the commits in `aaaa1111\.\.bbbb2222`\./);
	assert.match(usable, /\nCHANGE: 1=related; 3=related\n/);
	assert.match(usable, /git -C \/repo blame -w -M -C bbbb2222 -L <start>,<end> -- <file>/);
	assert.match(usable, /git -C \/repo rev-list aaaa1111\.\.bbbb2222/);
	const none = buildVerifyPrompt(VERIFIER, { ...RUN, changeBase: { usable: false, reason: 'the base is the head' } });
	assert.match(none, /This run has no usable base \(the base is the head\), so write no CHANGE line/);
	assert.match(buildVerifyPrompt(VERIFIER, RUN), /no usable base \(none was given\)/);
});

test('fromVerdictLine keeps a CHANGE line written before the VERDICTS line', () => {
	assert.equal(fromVerdictLine('thinking...\nCHANGE: 1=related\nVERDICTS: 1=CONFIRMED'), 'CHANGE: 1=related\nVERDICTS: 1=CONFIRMED');
});

test('prompt records the base for the renderer, named when given', () => {
	const { repo, base, head } = twoCommitRepo();
	const dir = runDir(REPORT);
	try {
		execFileSync('node', [SCRIPT, 'prompt', dir, '--repo', repo, '--base', base, '--head', head, '--base-name', 'release/1']);
		assert.deepEqual(JSON.parse(readFileSync(join(dir, 'change-base.json'), 'utf8')), { usable: true, name: 'release/1' });
		assert.match(readFileSync(join(dir, 'verify-prompt.md'), 'utf8'), /The change under test is the commits in/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
		rmSync(repo, { recursive: true, force: true });
	}
});
