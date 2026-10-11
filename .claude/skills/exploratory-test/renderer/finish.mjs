/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The verification step every run ends with, shared by CI (run.mjs) and a
// local run, so a report reads the same wherever it was made. The verifier is
// an agent and each side runs it its own way; everything around it is here.
//
// Local usage, around a verifier subagent:
//   node finish.mjs prompt <run dir> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>]
//     writes <run dir>/verify-prompt.md and prints its path, or says there
//     are no findings to verify, and writes <run dir>/change-base.json
//   node finish.mjs apply <run dir> <reply file>
//     adds the reply's verdicts to report.json

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { knownFixLines, knownIssueOutcomes } from './known-issues.mjs';
import { lintActionsLog } from './lint-ledger.mjs';
import { parseLedger } from './ledger.mjs';

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
			out.findings.set(f.n, { verified, known: issues(f.known), intended: issues(f.intended), feature: words(f.feature), title: words(f.title), related: f.related === true });
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
	try {
		return JSON.parse(readFileSync(join(dir, 'known-issues.json'), 'utf8'));
	} catch {
		return null;
	}
}

const PREAMBLE = 'A second agent re-read this report with the repository but without driving the app. Advisory only: no finding was changed or removed.';

/**
 * report.json with the verifier's verdicts on its findings, and its notes as
 * `verification`, which the page shows collapsed. `reply` is
 * parseVerifyReply's. A failed pass shows `text` open, because "these
 * findings are unreviewed" is not a detail to hide behind a click, and
 * changes no finding.
 */
export function applyVerification(json, reply, { failed = false, text = '' } = {}) {
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
	const linked = [...reply.linked].map(([issue, severity]) => ({ issue, severity }));
	return {
		...json,
		findings,
		verification: { failed, text: `${PREAMBLE}\n\n${reply.notes}`.trim(), ...(related.length ? { related } : {}), ...(linked.length ? { linked } : {}) },
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
	return { path, report: readReport(path), ledger, knownIssues, observed: observedLinked(knownIssues, ledger) };
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
 * Adds a verifier reply to the run's report. Returns `{ mismatch }`, writing nothing,
 * when its verdicts are keyed to other numbers than the report's, so a
 * corrected reply can be applied; with `giveUp` that marks the findings
 * unreviewed instead. An `error`, or an empty reply or one with no verdicts,
 * says the verification did not complete rather than leaving the findings
 * looking reviewed. Otherwise returns `{ failed, logLines }`.
 */
export function applyVerifyReply(dir, reply, { error = '', giveUp = false } = {}) {
	const { path, report, ledger, knownIssues } = readRun(dir);
	if (isVerified(report)) {
		return { already: true };
	}
	reply = String(reply ?? '').trim();
	const parsed = parseVerifyReply(reply);
	const findings = hasFindings(report);
	const mismatch = !error && findings && parsed.findings.size ? verdictMismatch(report, parsed) : '';
	if (mismatch && !giveUp) {
		return { mismatch };
	}
	const failed = Boolean(error || mismatch) || !reply || Boolean(parsed.problem) || (findings && !parsed.findings.size);
	const unreviewed = findings ? 'The findings above are unreviewed.' : 'The known issues above are unrated.';
	const why = error ? `: ${error}` : mismatch ? `: ${mismatch}` : !reply ? '' : parsed.problem ? `: ${parsed.problem}` : ': the reply gave no verdicts';
	const text = `_Verification did not complete${why}. ${unreviewed}_${reply ? `\n\n${reply}` : ''}`;
	writeReport(path, applyVerification(report, parsed, { failed, text }));
	return { failed, logLines: verifyLogLines(knownIssues, ledger, failed ? parseVerifyReply('') : parsed) };
}

function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: { repo: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' }, 'base-name': { type: 'string' } },
	});
	const [command, dir, replyFile] = positionals;
	const path = dir && reportPath(dir);
	if (!path || !existsSync(path)) {
		console.error('usage: node finish.mjs prompt <run dir> --repo <checkout> --base <sha> --head <sha> [--base-name <ref>]\n       node finish.mjs apply <run dir> <reply file>');
		return 2;
	}
	if (command === 'prompt') {
		if (!values.repo || !values.base || !values.head) {
			console.error('finish: prompt needs --repo, --base and --head');
			return 2;
		}
		const out = writeVerifyPrompt(dir, { ...values, baseName: values['base-name'] });
		console.log(out ?? 'no findings: nothing to verify');
		return 0;
	}
	if (command === 'apply') {
		// Checked before anything is written: marking the findings unreviewed
		// over a mistyped path would also stop a corrected retry.
		if (!replyFile || !existsSync(replyFile)) {
			console.error(`finish: reply file not found: ${replyFile ?? '(none given)'}`);
			return 2;
		}
		const result = applyVerifyReply(dir, readFileSync(replyFile, 'utf8'));
		if (result.already) {
			console.error(`finish: ${path} is already verified`);
			return 1;
		}
		if (result.mismatch) {
			console.error(`finish: ${result.mismatch} Send the verifier this message, save its corrected reply and apply again.`);
			return 1;
		}
		for (const line of result.logLines) {
			console.error(`finish: ${line}`);
		}
		console.log(`finish: ${result.failed ? 'marked unreviewed' : 'verdicts added to'} ${path}`);
		return 0;
	}
	console.error(`finish: unknown command ${command ?? ''}`);
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
