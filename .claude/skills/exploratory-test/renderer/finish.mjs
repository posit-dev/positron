/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The verification step every run ends with, shared by CI (run.mjs) and a
// local run, so a report reads the same wherever it was made. The verifier is
// an agent and each side runs it its own way; everything around it is here.
// The pipeline calls writeVerifyPrompt and applyVerifyReply.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { knownFixLines, knownIssueOutcomes } from './known-issues.mjs';
import { lintActionsLog } from './lint-ledger.mjs';
import { parseLedger } from './ledger.mjs';
import { readJson } from './text.mjs';

/**
 * The verify pass's prompt: verifier.md with the run's paths and diff range
 * filled in, and lint's check of actions.log, read from the run directory
 * unless `actionsLog` is given. A placeholder with no value, or a value with
 * no placeholder, throws, so the template and this list cannot drift apart quietly.
 */
export function buildVerifyPrompt(template, { workDir, repoRoot, baseSha, headSha, actionsLog, changeBase, reportFile = join(workDir, 'report.json') }) {
	const logPath = join(workDir, 'actions.log');
	const log = actionsLog ?? (existsSync(logPath) ? readFileSync(logPath, 'utf8') : undefined);
	const logProblems = log === undefined ? [] : lintActionsLog(log);
	const values = {
		LOG_CHECK: log === undefined
			? 'no actions.log in the run directory.'
			: logProblems.length ? `\n\n${logProblems.map(p => `- ${p.text}`).join('\n')}\n` : 'clean: every line is stamped as the helpers stamp it, in time order.',
		REPORT: reportFile,
		ACTIONS_LOG: `${workDir}/actions.log`,
		LEDGER: `${workDir}/ledger.md`,
		FILES: `${workDir}/files/`,
		KNOWN_ISSUES: `${workDir}/known-issues.json`,
		REPO: repoRoot,
		DIFF: `${baseSha}...${headSha}`,
		HEAD: headSha,
		CHANGE_RANGE: `${baseSha}..${headSha}`,
		CHANGE_SCOPE: changeBase?.usable
			? `The change under test is the commits in \`${baseSha}..${headSha}\`.`
			: `This run has no usable base (${changeBase?.reason ?? 'none was given'}), so mark no finding related and skip the steps below.`,
		SEARCH: `node ${join(dirname(fileURLToPath(import.meta.url)), 'known-issues.mjs')} --search`,
	};
	const used = new Set();
	const missing = new Set();
	const prompt = String(template).replace(/\{\{(\w+)\}\}/g, (whole, key) => {
		if (!(key in values)) {
			missing.add(key);
			return whole;
		}
		used.add(key);
		return values[key];
	});
	const unused = Object.keys(values).filter(k => !used.has(k));
	if (missing.size || unused.length) {
		throw new Error(`verifier.md placeholders out of step: ${[...[...missing].map(k => `no value for {{${k}}}`), ...unused.map(k => `{{${k}}} not in the template`)].join(', ')}`);
	}
	return prompt.trim();
}

/**
 * Whether the run has a base the change mark can be judged against: a base
 * SHA, not the head, with commits between them. A main run has none. `name`
 * is the base ref the reader knows, when the caller has it.
 */
export function changeBase(repoRoot, baseSha, headSha, name) {
	const out = reason => ({ usable: !reason, reason, name: name || null });
	if (!baseSha || !headSha) {
		return out('no base commit');
	}
	if (baseSha === headSha) {
		return out('the base is the head');
	}
	try {
		const count = execFileSync('git', ['-C', repoRoot, 'rev-list', '--count', `${baseSha}..${headSha}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		return out(count === '0' ? 'no commits between the base and the head' : '');
	} catch {
		return out('git could not list the commits between the base and the head');
	}
}

/** Writes what the renderer needs of changeBase to <run dir>/change-base.json. */
export function writeChangeBase(dir, base) {
	writeFileSync(join(dir, 'change-base.json'), `${JSON.stringify({ usable: base.usable, name: base.name })}\n`);
}

const VERDICTS = { 'confirmed': 'confirmed', 'false positive': 'disputed', 'unresolved': 'unresolved' };
const SEVERITIES = ['major', 'moderate', 'minor'];

/**
 * The verifier's reply: the fenced `json` block it opens with, and its notes
 * after the block. Anything before the block is its notes to itself, and is
 * dropped. `findings` maps a finding number to `{ verified, known, intended,
 * feature, title, related }`, `linked` an issue number to its severity, and
 * `problem` says why the block could not be read, or is ''. An entry it
 * cannot read is skipped, so one bad entry costs only that finding.
 */
export function parseVerifyReply(text) {
	const raw = String(text ?? '');
	const out = { findings: new Map(), linked: new Map(), notes: raw.trim(), problem: '' };
	const block = /```json[ \t]*\n([\s\S]*?)\n```/.exec(raw);
	if (!block) {
		out.problem = 'the reply has no ```json block';
		return out;
	}
	out.notes = raw.slice(block.index + block[0].length).trim();
	let data;
	try {
		data = JSON.parse(block[1]);
	} catch (err) {
		out.problem = `its json block does not parse: ${err.message}`;
		return out;
	}
	const issues = value => (Array.isArray(value) ? [...new Set(value.filter(Number.isInteger))] : []);
	// A title or feature lands in the filed issue's title, where `|` breaks the table.
	const words = value => (typeof value === 'string' && value.trim() && !value.includes('|') ? value.trim() : null);
	for (const f of Array.isArray(data?.findings) ? data.findings : []) {
		const verified = VERDICTS[String(f?.verdict ?? '').trim().toLowerCase()];
		if (Number.isInteger(f?.n) && verified) {
			const log = Array.isArray(f.log) && f.log.length === 2 && f.log.every(Number.isInteger) && f.log[0] >= 1 && f.log[0] <= f.log[1] ? f.log : null;
			// A bare file name is read as a shot listed without saying what it shows.
			const shots = Array.isArray(f.shots)
				? f.shots.map(x => (typeof x === 'string' ? { file: x } : x)).filter(x => typeof x?.file === 'string').map(x => ({ file: basename(x.file.trim()), shows: typeof x.shows === 'string' ? x.shows.trim() : '' }))
				: null;
			out.findings.set(f.n, { verified, known: issues(f.known), intended: issues(f.intended), feature: words(f.feature), title: words(f.title), related: f.related === true, log, shots });
		}
	}
	for (const l of Array.isArray(data?.linked) ? data.linked : []) {
		const severity = String(l?.severity ?? '').toLowerCase();
		if (Number.isInteger(l?.issue) && SEVERITIES.includes(severity)) {
			out.linked.set(l.issue, severity);
		}
	}
	return out;
}

/** Finding number to the issues the reply matched it with, under `key` (`known` or `intended`). */
export function issueMatches(reply, key) {
	return new Map([...reply.findings].filter(([, f]) => f[key].length).map(([n, f]) => [n, f[key]]));
}

/**
 * True when report.json has at least one finding.
 *
 * A run that found nothing has nothing to verify, and asking anyway produced a
 * page of prose auditing claims nobody disputed.
 */
export function hasFindings(report) {
	return findingNumbers(report).length > 0;
}

/** report.json's finding numbers, in its order. */
export function findingNumbers(report) {
	return (report?.findings ?? []).map(f => f.n);
}

/**
 * Why the reply's verdicts cannot be applied to this report, or '' when they
 * can: one per finding number, no more, no fewer. A verifier that keyed them
 * by position instead of by number gives a number the report lacks or misses
 * one it has whenever the numbers are not exactly 1..n; within 1..n it cannot
 * be told apart here, which is why the prompt says it plainly.
 */
export function verdictMismatch(report, reply) {
	const want = [...new Set(findingNumbers(report))].sort((a, b) => a - b);
	const got = [...reply.findings.keys()].sort((a, b) => a - b);
	const missing = want.filter(n => !got.includes(n));
	const extra = got.filter(n => !want.includes(n));
	if (!missing.length && !extra.length) {
		return '';
	}
	return `the verdicts give findings ${got.join(', ') || 'none'}, but the report's findings are ${want.join(', ')}`
		+ `${missing.length ? `; missing ${missing.join(', ')}` : ''}${extra.length ? `; not in the report: ${extra.join(', ')}` : ''}.`
		+ ' Key each verdict by the finding\'s number, its `n`, not by its position.';
}

/** The actions.log lines the ledger cites in each scenario that failed for finding `n`. */
function citedLogLines(ledger, n) {
	const failing = String(ledger ?? '').split(/\n(?=## )/).filter(s => new RegExp(`^## [SN]\\d+\\b[\\s\\S]*?(?:Status: fail|FAIL)\\W+Finding ${n}\\b`).test(s));
	return [...new Set(failing.flatMap(s => [...s.matchAll(/actions\.log:(\d+)/g)].map(m => Number(m[1]))))].sort((a, b) => a - b);
}

/** The screenshots finding `f`'s failing VERIFY steps cite, by file name. */
function failShots(f) {
	return [...new Set((f.steps ?? []).filter(st => st.kind === 'verify' && st.result === 'fail').flatMap(st => st.shots ?? []).map(p => basename(p)))];
}

/**
 * Each check the reply does not show it made, as `{ n, kind, why }`: a
 * finding with no `log` range, a range past the log's end or one that misses a
 * line its failing scenario cites (`kind` 'log'); and a finding whose `shots`
 * leave out a screenshot its failing VERIFY steps cite ('shots'). Without an
 * action log there is nothing to check the steps against.
 */
export function checkGaps(report, reply, { ledger, actionsLog }) {
	// A shot the notes say was not opened was not checked, whatever the list says.
	const unopened = new Set([...String(reply.notes ?? '').matchAll(/\b(?:did not|didn't|could not|couldn't) (?:open|view|look at|check|read)\s+`?([\w.-]+\.(?:png|jpe?g))/gi)].map(m => m[1]));
	const lines = String(actionsLog ?? '').split('\n').filter(Boolean).length;
	return (report?.findings ?? []).flatMap(f => {
		const { n } = f;
		const got = reply.findings.get(n);
		const gaps = [];
		const range = got?.log;
		if (lines && !range) {
			gaps.push({ n, kind: 'log', why: 'gave no actions.log lines' });
		} else if (lines && range[1] > lines) {
			gaps.push({ n, kind: 'log', why: `gave actions.log lines ${range[0]}-${range[1]}, but the log has ${lines}` });
		} else if (lines) {
			const missed = citedLogLines(ledger, n).filter(line => line < range[0] || line > range[1]);
			if (missed.length) {
				gaps.push({ n, kind: 'log', why: `gave actions.log lines ${range[0]}-${range[1]}, which miss line${missed.length > 1 ? 's' : ''} ${missed.join(', ')} that its failing scenario cites` });
			}
		}
		const listed = new Map((got?.shots ?? []).map(x => [x.file, x.shows]));
		const cited = failShots(f);
		const missing = [
			[cited.filter(shot => !listed.has(shot)), 'did not list'],
			[cited.filter(shot => listed.has(shot) && !listed.get(shot)), 'listed without saying what it shows'],
			[cited.filter(shot => listed.get(shot) && unopened.has(shot)), 'listed but says it did not open'],
		].filter(([shots]) => shots.length);
		for (const [shots, what] of missing) {
			gaps.push({ n, kind: 'shots', why: `${what} ${shots.join(', ')}, which its failing VERIFY steps cite` });
		}
		return gaps;
	});
}

/** The message that asks the verifier for the checks it did not show it made. */
export function checkMessage(gaps) {
	return `Your reply ${gaps.map(g => `for Finding ${g.n} ${g.why}`).join('; ')}. For each of those findings, do the check your instructions ask: read the lines of actions.log its failing scenario covers and check its steps and VERIFY lines against them, giving that range as \`log\`; and look at each screenshot its failing VERIFY steps cite and check its Observed against it, listing each in \`shots\` with what it shows. Reply again in full, in the same format.`;
}

/**
 * The linked issues the ledger says the run ran into, which the verifier
 * rates. Empty without a list or a ledger.
 */
export function observedLinked(knownIssues, ledger) {
	const coverage = knownIssues?.issues?.length && parseLedger(ledger);
	return coverage ? knownIssueOutcomes(knownIssues, coverage).observed.map(o => o.issue.number) : [];
}

/**
 * Run-log lines about the linked issues after verify: each observed one the
 * reply gave no severity, and each known match on a fix or a closed issue.
 * `reply` is parseVerifyReply's.
 */
export function verifyLogLines(knownIssues, ledger, reply) {
	const coverage = knownIssues?.issues?.length && parseLedger(ledger);
	if (!coverage) {
		return [];
	}
	const ki = knownIssueOutcomes(knownIssues, coverage, reply.linked, issueMatches(reply, 'known'));
	return [...ki.unrated.map(n => `Couldn't rate #${n}: verifier line missing or malformed`), ...knownFixLines(ki)];
}

/** Reads a run directory's known-issues.json, or null when there is none or it does not parse. */
export function readKnownIssues(dir) {
	return readJson(join(dir, 'known-issues.json'));
}

const PREAMBLE = 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was changed or removed.';

/**
 * report.json with the verifier's verdicts on its findings, and its notes as
 * `verification`, which the page shows collapsed. `reply` is
 * parseVerifyReply's. A failed pass shows `text` open, because "these
 * findings are unreviewed" is not a detail to hide behind a click, and
 * changes no finding.
 */
export function applyVerification(json, reply, { failed = false, text = '', gaps = [] } = {}) {
	if (failed) {
		return { ...json, verification: { failed, text } };
	}
	const findings = (json.findings ?? []).map(f => {
		const v = reply.findings.get(f.n);
		if (!v) {
			return f;
		}
		return {
			...f,
			verified: v.verified,
			...(v.known.length ? { known: v.known } : {}),
			...(v.intended.length ? { intended: v.intended } : {}),
			...(v.title ? { title: v.title } : {}),
			...(v.feature ? { feature: v.feature } : {}),
		};
	});
	const related = [...reply.findings].filter(([, f]) => f.related).map(([n]) => n);
	const unchecked = Object.fromEntries(['log', 'shots'].map(kind => [kind, [...new Set(gaps.filter(g => g.kind === kind).map(g => g.n))]]).filter(([, ns]) => ns.length));
	const named = ns => ns.map(n => `Finding ${n}`).join(', ');
	const skipped = [
		unchecked.log ? `the steps of ${named(unchecked.log)} against the action log` : '',
		unchecked.shots ? `the Observed of ${named(unchecked.shots)} against its screenshots` : '',
	].filter(Boolean).join(', or ');
	const linked = [...reply.linked].map(([issue, severity]) => ({ issue, severity }));
	return {
		...json,
		findings,
		verification: {
			failed,
			// A skipped check is said, so "No process issues" is not read as one that passed.
			// Its own all-clear would contradict what the pipeline found missing.
			text: [PREAMBLE, skipped ? reply.notes.replace(/\n*No process issues\.?\s*$/, '') : reply.notes, skipped ? `_The verifier did not show it checked ${skipped}._` : ''].filter(Boolean).join('\n\n'),
			...(related.length ? { related } : {}),
			...(linked.length ? { linked } : {}),
			...(skipped ? { unchecked } : {}),
		},
	};
}

/** True once report.json carries a verification, so it is never added twice. */
export function isVerified(report) {
	return Boolean(report?.verification);
}

const VERIFIER_PATH = fileURLToPath(new URL('../verifier.md', import.meta.url));

/** The run's report.json. */
export function reportPath(dir) {
	return join(dir, 'report.json');
}

/** report.json at `path`, parsed. */
export function readReport(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

/** Writes report.json to `path`. */
export function writeReport(path, report) {
	writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`);
}

/** A run directory's report, ledger and known issues, as the verify steps read them. */
function readRun(dir) {
	const ledgerPath = join(dir, 'ledger.md');
	const knownIssues = readKnownIssues(dir);
	const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '';
	const path = reportPath(dir);
	const actionsLog = existsSync(join(dir, 'actions.log')) ? readFileSync(join(dir, 'actions.log'), 'utf8') : '';
	return { path, report: readReport(path), ledger, actionsLog, knownIssues, observed: observedLinked(knownIssues, ledger) };
}

/**
 * Writes <run dir>/change-base.json, and <run dir>/verify-prompt.md and returns
 * its path, or null when there is nothing to verify. Linked issues the run ran
 * into still need a severity. `baseName` is the base branch, for the change mark.
 */
export function writeVerifyPrompt(dir, { repo, base, head, baseName }) {
	const changed = changeBase(repo, base, head, baseName);
	writeChangeBase(dir, changed);
	const { path, report, observed } = readRun(dir);
	if (!hasFindings(report) && !observed.length) {
		return null;
	}
	const out = join(dir, 'verify-prompt.md');
	writeFileSync(out, buildVerifyPrompt(readFileSync(VERIFIER_PATH, 'utf8'), {
		workDir: dir, repoRoot: repo, baseSha: base, headSha: head, changeBase: changed, reportFile: path,
	}));
	return out;
}

/**
 * Adds a verifier reply to the run's report. Returns `{ retry }`, writing
 * nothing, when the reply can be fixed by asking once more: its verdicts keyed
 * to other numbers than the report's, or a check it does not show it made (a
 * finding's steps against the action log, its Observed against its
 * screenshots). `retry` is the message to send. With `final` nothing is asked:
 * wrong numbers mark the findings unreviewed, and a missing check is named in
 * the report. An `error`, or an empty reply or one with no verdicts, says the
 * verification did not complete rather than leaving the findings looking
 * reviewed. Otherwise returns `{ failed, logLines }`.
 */
export function applyVerifyReply(dir, reply, { error = '', final = false } = {}) {
	const { path, report, ledger, actionsLog, knownIssues } = readRun(dir);
	if (isVerified(report)) {
		return { already: true };
	}
	reply = String(reply ?? '').trim();
	const parsed = parseVerifyReply(reply);
	const findings = hasFindings(report);
	const mismatch = !error && findings && parsed.findings.size ? verdictMismatch(report, parsed) : '';
	if (mismatch && !final) {
		return { retry: `${mismatch} Reply again in full, in the same format.` };
	}
	const failed = Boolean(error || mismatch) || !reply || Boolean(parsed.problem) || (findings && !parsed.findings.size);
	const gaps = failed ? [] : checkGaps(report, parsed, { ledger, actionsLog });
	if (gaps.length && !final) {
		return { retry: checkMessage(gaps) };
	}
	const unreviewed = findings ? 'The findings above are unreviewed.' : 'The known issues above are unrated.';
	const why = error ? `: ${error}` : mismatch ? `: ${mismatch}` : !reply ? '' : parsed.problem ? `: ${parsed.problem}` : ': the reply gave no verdicts';
	const text = `_Verification did not complete${why}. ${unreviewed}_${reply ? `\n\n${reply}` : ''}`;
	writeReport(path, applyVerification(report, parsed, { failed, text, gaps }));
	return { failed, logLines: verifyLogLines(knownIssues, ledger, failed ? parseVerifyReply('') : parsed) };
}
