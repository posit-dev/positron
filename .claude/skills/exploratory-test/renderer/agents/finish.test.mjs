/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withTmpDir } from '../shared/tmp-dirs.mjs';
import { applyVerification, applyVerifyReply, buildVerifyPrompt, changeBase, findingNumbers, issueMatches, isVerified, checkGaps, checkMessage, observedLinked, parseVerifyReply, verdictMismatch, verifyLogLines, writeVerifyPrompt } from './finish.mjs';

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

/** A verifier reply: the json block, then notes. */
const reply = (data, notes = '') => `\`\`\`json\n${JSON.stringify(data, null, '\t')}\n\`\`\`${notes ? `\n\n${notes}` : ''}`;
const verdicts = (...pairs) => ({ findings: pairs.map(([n, verdict, more = {}]) => ({ n, verdict, ...more })) });
const apply = (report, data, notes) => applyVerification(report, parseVerifyReply(reply(data, notes)));

test('parseVerifyReply reads the json block and keeps the notes after it, not before', () => {
	const r = parseVerifyReply(`Let me finalize.\n\n${reply(verdicts([1, 'CONFIRMED'], [2, 'false positive']), '- 1: repro holds.')}`);
	assert.deepEqual([...r.findings].map(([n, f]) => [n, f.verified]), [[1, 'confirmed'], [2, 'disputed']]);
	assert.equal(r.notes, '- 1: repro holds.');
	assert.equal(r.problem, '');
});

test('parseVerifyReply says why it read nothing, and keeps the whole reply as notes', () => {
	assert.equal(parseVerifyReply('no block here').problem, 'the reply has no ```json block');
	assert.equal(parseVerifyReply('no block here').notes, 'no block here');
	assert.match(parseVerifyReply('```json\n{ nope\n```').problem, /^its json block does not parse/);
	assert.equal(parseVerifyReply(null).findings.size, 0);
});

test('parseVerifyReply skips each entry it cannot read, and keeps the rest', () => {
	const r = parseVerifyReply(reply({
		findings: [
			{ n: 1, verdict: 'confirmed', known: [15102, 15102, 'x'], feature: 'new folder flow', title: 'a | b', log: [12, 30], shots: ['shots/S01-02.png', 3] },
			{ n: '2', verdict: 'confirmed' },
			{ n: 3, verdict: 'maybe' },
			{ n: 4, verdict: 'unresolved', intended: [14210], related: 'yes', log: [30, 12] },
		],
		linked: [{ issue: 5678, severity: 'Moderate' }, { issue: 5301, severity: 'awful' }, { issue: '9', severity: 'minor' }],
	}));
	assert.deepEqual(Object.fromEntries(r.findings), {
		1: { verified: 'confirmed', known: [15102], intended: [], feature: 'new folder flow', title: null, related: false, log: [12, 30], shots: [{ file: 'S01-02.png', shows: '' }] },
		4: { verified: 'unresolved', known: [], intended: [14210], feature: null, title: null, related: false, log: null, shots: null },
	});
	assert.deepEqual([...r.linked], [[5678, 'moderate']]);
	assert.deepEqual([...issueMatches(r, 'known')], [[1, [15102]]]);
	assert.deepEqual([...issueMatches(r, 'intended')], [[4, [14210]]]);
});

test('applyVerification marks each finding with its verdict, and only the ones it ruled on', () => {
	assert.deepEqual(marks(apply(REPORT, verdicts([1, 'confirmed'], [2, 'false positive']))), {
		1: { title: 'first claim', feature: 'modal dialogs', verified: 'confirmed' },
		2: { title: 'second claim', feature: 'console', verified: 'disputed' },
	});
	assert.equal(apply(REPORT, verdicts([1, 'confirmed'])).findings[1].verified, undefined);
});

test('applyVerification keeps the related findings and linked severities beside the notes', () => {
	const out = apply(REPORT, { ...verdicts([1, 'confirmed', { related: true }], [2, 'confirmed']), linked: [{ issue: 20, severity: 'minor' }] }, '- 1: holds.');
	assert.deepEqual(out.verification, {
		failed: false,
		text: 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was changed or removed.\n\n- 1: holds.',
		related: [1],
		linked: [{ issue: 20, severity: 'minor' }],
	});
	assert.ok(isVerified(out));
	assert.ok(!isVerified(REPORT));
});

test('applyVerification changes no finding on a failed pass, and keeps what was said', () => {
	const out = applyVerification(REPORT, parseVerifyReply(reply(verdicts([1, 'confirmed', { feature: 'new folder flow', title: 'other' }]))), { failed: true, text: '_Verification did not complete._' });
	assert.deepEqual(out.findings, REPORT.findings);
	assert.deepEqual(out.verification, { failed: true, text: '_Verification did not complete._' });
	assert.ok(isVerified(out));
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
	// The example is what the verifier copies, so it has to read as a reply.
	const example = parseVerifyReply(prompt.slice(prompt.indexOf('```json')));
	assert.equal(example.problem, '');
	assert.deepEqual([...example.findings].map(([n, f]) => [n, f.verified, f.known]), [[1, 'confirmed', []], [3, 'disputed', [15102]]]);
	assert.deepEqual([...example.linked], [[5678, 'moderate']]);
});

test('buildVerifyPrompt gives the verifier lint\'s check of actions.log', () => {
	const check = actionsLog => buildVerifyPrompt(VERIFIER, { ...RUN, actionsLog }).split('\n').filter(l => /lint's check of it|^- actions\.log:/.test(l));
	assert.deepEqual(check('2026-10-05T03:59:24Z shot.sh -s=p: screenshot S01-01.png\n'), [
		'The reporting agent\'s own action log, with timestamps: `/tmp/run/actions.log`. Only the helpers write it, and only by appending; lint\'s check of it: clean: every line is stamped as the helpers stamp it, in time order.',
	]);
	const backdated = check('2026-10-05T03:59:24Z shot.sh -s=p: screenshot S01-01.png\n2026-10-05T03:58:25Z raw press Escape\n');
	assert.equal(backdated.length, 2);
	assert.match(backdated[1], /^- actions\.log: line 2 \(2026-10-05T03:58:25Z\) is earlier than line 1 above it/);
	// With the run's session, a line under another run's session is flagged, as in the explorer's own check.
	const other = '2026-10-05T03:59:24Z ui.sh -s=et-other: click Run\n';
	assert.match(buildVerifyPrompt(VERIFIER, { ...RUN, actionsLog: other, session: 'et-mine' }), /drove Playwright session "et-other", not this run's "et-mine"/);
	assert.doesNotMatch(buildVerifyPrompt(VERIFIER, { ...RUN, actionsLog: other }), /drove Playwright session/);
	// No log at the run's path: said so, not passed off as clean.
	assert.match(buildVerifyPrompt(VERIFIER, RUN), /lint's check of it: no actions\.log in the run directory\./);
});

test('buildVerifyPrompt throws when the template and its values drift apart', () => {
	assert.throws(() => buildVerifyPrompt(`${VERIFIER}\n{{NEW_THING}}`, RUN), /no value for \{\{NEW_THING\}\}/);
	assert.throws(() => buildVerifyPrompt(VERIFIER.replaceAll('{{FILES}}', ''), RUN), /\{\{FILES\}\} not in the template/);
});

/** Calls `fn` with a run directory holding `report` as report.json. */
function withRun(report, fn) {
	return withTmpDir('finish-', dir => {
		writeFileSync(join(dir, 'report.json'), JSON.stringify(report));
		return fn(dir);
	});
}

const readJson = dir => JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));

test('prompt skips a report with no findings', () => {
	withRun({ findings: [] }, dir => {
		assert.equal(writeVerifyPrompt(dir, { repo: '/repo', base: 'a', head: 'b' }), null);
		assert.ok(!existsSync(join(dir, 'verify-prompt.md')));
	});
});

test('apply adds the verdicts once, and drops the notes before the block', () => {
	withRun(REPORT, dir => {
		const text = `Let me finalize.\n\n${reply(verdicts([1, 'confirmed'], [2, 'unresolved']), '- 2: no log.')}`;
		applyVerifyReply(dir, text);
		const report = readJson(dir);
		assert.equal(report.findings[1].verified, 'unresolved');
		assert.doesNotMatch(report.verification.text, /Let me finalize/);
		// A second apply would add a second column.
		assert.deepEqual(applyVerifyReply(dir, text), { already: true });
	});
});

test('apply marks the findings unreviewed when the reply has no verdicts', () => {
	for (const text of ['', 'I could not read the report.', reply({ findings: [] })]) {
		withRun(REPORT, dir => {
			applyVerifyReply(dir, text);
			const report = readJson(dir);
			assert.equal(report.verification.failed, true);
			assert.match(report.verification.text, /^_Verification did not complete.*The findings above are unreviewed\._/);
			assert.ok(report.findings.every(f => f.verified === undefined));
		});
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
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, parseVerifyReply(reply({ findings: [], linked: [{ issue: 20, severity: 'minor' }, { issue: 21, severity: 'awful' }] }))), ['Couldn\'t rate #21: verifier line missing or malformed']);
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, parseVerifyReply('')), ['Couldn\'t rate #20: verifier line missing or malformed', 'Couldn\'t rate #21: verifier line missing or malformed']);
	assert.deepEqual(verifyLogLines(null, SEEN_LEDGER, parseVerifyReply('')), []);
});

test('verifyLogLines logs a known match on a fix, which the report does not show', () => {
	const r = parseVerifyReply(reply({ ...verdicts([1, 'confirmed', { known: [10] }]), linked: [{ issue: 20, severity: 'minor' }, { issue: 21, severity: 'minor' }] }));
	assert.deepEqual(verifyLogLines(KNOWN_JSON, SEEN_LEDGER, r), ['Finding 1 matches #10, which this PR fixes; the explorer may have missed a fix that didn\'t hold.']);
});

/** withRun with no findings, and a ledger that saw linked issues. */
function withKnownRun(fn) {
	return withRun(NO_FINDINGS, dir => {
		writeFileSync(join(dir, 'ledger.md'), SEEN_LEDGER);
		writeFileSync(join(dir, 'known-issues.json'), JSON.stringify(KNOWN_JSON));
		return fn(dir);
	});
}

test('prompt still runs with no findings when the run saw a linked issue, and names the issues file', () => {
	withKnownRun(dir => {
		const out = writeVerifyPrompt(dir, { repo: '/repo', base: 'a', head: 'b' });
		assert.equal(out, join(dir, 'verify-prompt.md'));
		assert.ok(readFileSync(out, 'utf8').includes(`\`${join(dir, 'known-issues.json')}\``));
	});
});

test('apply takes a reply with no findings and logs the issues it left unrated', () => {
	withKnownRun(dir => {
		const { logLines } = applyVerifyReply(dir, reply({ findings: [], linked: [{ issue: 20, severity: 'moderate' }] }, '- #20: the panel jumped.\n\nNo process issues.'));
		assert.deepEqual(logLines, ['Couldn\'t rate #21: verifier line missing or malformed']);
		assert.deepEqual(readJson(dir).verification.linked, [{ issue: 20, severity: 'moderate' }]);
	});
});

// Findings need not be in number order in report.json: the first is Finding 4.
const SORTED = { findings: [{ n: 4, title: 'data lost' }, { n: 1, title: 'wrong label' }, { n: 2, title: 'slow reload' }] };

test('findingNumbers reads the findings in their order', () => {
	assert.deepEqual(findingNumbers(SORTED), [4, 1, 2]);
	assert.deepEqual(findingNumbers({}), []);
});

test('verdictMismatch names the numbers a reply keyed by row order gets wrong', () => {
	assert.equal(verdictMismatch(SORTED, parseVerifyReply(reply(verdicts([4, 'confirmed'], [1, 'confirmed'], [2, 'false positive'])))), '');
	const why = verdictMismatch(SORTED, parseVerifyReply(reply(verdicts([1, 'confirmed'], [2, 'confirmed'], [3, 'false positive']))));
	assert.match(why, /verdicts give findings 1, 2, 3, but the report's findings are 1, 2, 4; missing 4; not in the report: 3\./);
	assert.match(why, /by the finding's number, its `n`/);
});

test('apply refuses verdicts keyed to other numbers, writes nothing, and takes a corrected reply', () => {
	withRun(SORTED, dir => {
		const before = readFileSync(join(dir, 'report.json'), 'utf8');
		assert.match(applyVerifyReply(dir, reply(verdicts([1, 'confirmed'], [2, 'confirmed'], [3, 'false positive']), '- 3: no.')).retry, /missing 4; not in the report: 3/);
		assert.equal(readFileSync(join(dir, 'report.json'), 'utf8'), before);
		applyVerifyReply(dir, reply(verdicts([4, 'false positive'], [1, 'confirmed'], [2, 'confirmed']), '- 4: no.'));
		assert.equal(readJson(dir).findings[0].verified, 'disputed');
	});
});

/** Calls `fn` with a throwaway repo with two commits, for changeBase's rev-list. */
function withTwoCommitRepo(fn) {
	return withTmpDir('finish-git-', repo => {
		const git = (...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8' }).trim();
		git('init', '-q');
		git('commit', '-q', '--allow-empty', '-m', 'base');
		const base = git('rev-parse', 'HEAD');
		git('commit', '-q', '--allow-empty', '-m', 'change');
		return fn({ repo, base, head: git('rev-parse', 'HEAD') });
	});
}

test('changeBase is usable only with commits between the base and the head', () => {
	withTwoCommitRepo(({ repo, base, head }) => {
		assert.deepEqual(changeBase(repo, base, head, 'main'), { usable: true, reason: '', name: 'main' });
		assert.deepEqual(changeBase(repo, base, head), { usable: true, reason: '', name: null });
		assert.equal(changeBase(repo, '', head, 'main').usable, false);
		assert.equal(changeBase(repo, head, head, 'main').usable, false);
		// A main run: the head is behind or at the base, so nothing is the change's.
		assert.deepEqual(changeBase(repo, head, base, 'main'), { usable: false, reason: 'no commits between the base and the head', name: 'main' });
		assert.equal(changeBase('/no/such/repo', base, head).usable, false);
	});
});

test('buildVerifyPrompt asks for related findings only when the base is usable', () => {
	const usable = buildVerifyPrompt(VERIFIER, { ...RUN, changeBase: { usable: true } });
	assert.match(usable, /The change under test is the commits in `aaaa1111\.\.bbbb2222`\./);
	assert.match(usable, /`related`: `true` for a finding whose fix likely belongs/);
	assert.match(usable, /git -C \/repo blame -w -M -C bbbb2222 -L <start>,<end> -- <file>/);
	assert.match(usable, /git -C \/repo rev-list aaaa1111\.\.bbbb2222/);
	const none = buildVerifyPrompt(VERIFIER, { ...RUN, changeBase: { usable: false, reason: 'the base is the head' } });
	assert.match(none, /This run has no usable base \(the base is the head\), so mark no finding related/);
	assert.match(buildVerifyPrompt(VERIFIER, RUN), /no usable base \(none was given\)/);
});

test('prompt writes the verifier prompt beside the report, and records the base for the renderer, named when given', () => {
	withTwoCommitRepo(({ repo, base, head }) => withRun(REPORT, dir => {
		assert.equal(writeVerifyPrompt(dir, { repo, base, head, baseName: 'release/1' }), join(dir, 'verify-prompt.md'));
		assert.deepEqual(JSON.parse(readFileSync(join(dir, 'change-base.json'), 'utf8')), { usable: true, name: 'release/1' });
		const prompt = readFileSync(join(dir, 'verify-prompt.md'), 'utf8');
		assert.ok(prompt.includes(`Report: \`${dir}/report.json\``));
		assert.ok(prompt.includes(`git -C ${repo} diff ${base}...${head}`));
		assert.match(prompt, /The change under test is the commits in/);
	}));
});

const LOG_LEDGER = [
	'## S01 - passes', 'Status: pass', 'Steps:', '1. VERIFY it opens -> PASS', '   Evidence: shots/S01-01.png, actions.log:3', '',
	'## S02 - first breaks', 'Status: fail - Finding 1', 'Steps:', '1. VERIFY it loads -> FAIL - Finding 1', '   Evidence: shots/S02-01.png, actions.log:8', '',
	'## S03 - second breaks', 'Status: fail - Finding 2', 'Steps:', '1. VERIFY it saves -> FAIL - Finding 2', '   Evidence: shots/S03-01.png, actions.log:14', '',
].join('\n');
const ACTIONS = Array.from({ length: 20 }, (_, i) => `2026-10-11T00:00:${String(i).padStart(2, '0')}Z click ${i + 1}`).join('\n');

/** REPORT with a failing VERIFY on each finding, citing the shots its scenario took. */
const SHOT_REPORT = { ...REPORT, findings: REPORT.findings.map(f => ({ ...f, steps: [{ kind: 'action', text: 'Open it.' }, { kind: 'verify', text: 'it works', result: 'fail', finding: f.n, shots: [`shots/S0${f.n + 1}-01.png`] }] })) };

test('checkGaps names each check the reply does not show it made: the action log and the failing steps\' screenshots', () => {
	const gaps = data => checkGaps(SHOT_REPORT, parseVerifyReply(reply(data)), { ledger: LOG_LEDGER, actionsLog: ACTIONS });
	const seen = n => ({ shots: [{ file: `S0${n + 1}-01.png`, shows: 'the notice' }] });
	assert.deepEqual(gaps(verdicts([1, 'confirmed', { log: [6, 10], ...seen(1) }], [2, 'confirmed', { log: [12, 15], shots: [{ file: 'shots/S03-01.png', shows: 'an empty grid' }] }])), []);
	assert.deepEqual(gaps(verdicts([1, 'confirmed', seen(1)], [2, 'confirmed', { log: [12, 25], ...seen(2) }])), [
		{ n: 1, kind: 'log', why: 'gave no actions.log lines' },
		{ n: 2, kind: 'log', why: 'gave actions.log lines 12-25, but the log has 20' },
	]);
	// A range that leaves out the line the failing scenario cites was not read where it matters.
	assert.deepEqual(gaps(verdicts([1, 'confirmed', { log: [1, 5], ...seen(1) }], [2, 'confirmed', { log: [12, 15], shots: ['S02-01.png'] }])), [
		{ n: 1, kind: 'log', why: 'gave actions.log lines 1-5, which miss line 8 that its failing scenario cites' },
		{ n: 2, kind: 'shots', why: 'did not list S03-01.png, which its failing VERIFY steps cite' },
	]);
	// A shot named without what it shows, or that the notes say was not opened, was not checked.
	assert.deepEqual(checkGaps(SHOT_REPORT, parseVerifyReply(reply(verdicts([1, 'confirmed', { log: [6, 10], shots: ['S02-01.png'] }], [2, 'confirmed', { log: [12, 15], ...seen(2) }]), 'I did not open S03-01.png.')), { ledger: LOG_LEDGER, actionsLog: ACTIONS }), [
		{ n: 1, kind: 'shots', why: 'listed without saying what it shows S02-01.png, which its failing VERIFY steps cite' },
		{ n: 2, kind: 'shots', why: 'listed but says it did not open S03-01.png, which its failing VERIFY steps cite' },
	]);
	// No action log, nothing to check the steps against; the screenshots still count.
	assert.deepEqual(checkGaps(SHOT_REPORT, parseVerifyReply(reply(verdicts([1, 'confirmed', seen(1)], [2, 'confirmed']))), { ledger: LOG_LEDGER, actionsLog: '' }), [
		{ n: 2, kind: 'shots', why: 'did not list S03-01.png, which its failing VERIFY steps cite' },
	]);
	// A finding with no failing shots has none to list.
	assert.deepEqual(checkGaps(REPORT, parseVerifyReply(reply(verdicts([1, 'confirmed'], [2, 'confirmed']))), { ledger: LOG_LEDGER, actionsLog: '' }), []);
	assert.match(checkMessage([{ n: 1, kind: 'log', why: 'gave no actions.log lines' }]), /^Your reply for Finding 1 gave no actions\.log lines\. .*giving that range as `log`.*listing each in `shots` with what it shows/);
});

test('applyVerification says which checks the verifier did not show it made', () => {
	const gaps = [{ n: 2, kind: 'log', why: '' }, { n: 1, kind: 'shots', why: '' }, { n: 2, kind: 'shots', why: '' }];
	const out = applyVerification(REPORT, parseVerifyReply(reply(verdicts([1, 'confirmed'], [2, 'confirmed']), 'No process issues.')), { gaps });
	assert.deepEqual(out.verification.unchecked, { log: [2], shots: [1, 2] });
	// Its all-clear goes: the pipeline found checks missing.
	assert.doesNotMatch(out.verification.text, /No process issues/);
	assert.match(out.verification.text, /\n\n_The verifier did not show it checked the steps of Finding 2 against the action log, or the Observed of Finding 1, Finding 2 against its screenshots\._$/);
	assert.match(apply(REPORT, verdicts([1, 'confirmed']), 'No process issues.').verification.text, /No process issues\.$/);
	assert.equal(apply(REPORT, verdicts([1, 'confirmed'])).verification.unchecked, undefined);
});
