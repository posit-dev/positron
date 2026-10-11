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
import { knownFixLines, knownIssueOutcomes, parseLinked } from './known-issues.mjs';
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
			: logProblems.length ? `\n\n${logProblems.map(p => `- ${p}`).join('\n')}\n` : 'clean: every line is stamped as the helpers stamp it, in time order.',
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
			: `This run has no usable base (${changeBase?.reason ?? 'none was given'}), so write no CHANGE line and skip the rest of this section.`,
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

/**
 * The verifier's reply from its VERDICTS line on, or from its KNOWN, INTENDED,
 * LINKED, FEATURE, TITLE or CHANGE line if that came first. Its final message can open with notes to
 * itself, which would otherwise lead the Verification details.
 */
export function fromVerdictLine(text) {
	if (typeof text !== 'string') {
		return text;
	}
	const lines = text.split('\n');
	const at = lines.findIndex(l => /^(?:VERDICTS|KNOWN|INTENDED|LINKED|FEATURE|TITLE|CHANGE):/.test(l.trim().toUpperCase()));
	return at > 0 ? lines.slice(at).join('\n') : text;
}

/**
 * Parses the verifier's machine-readable verdict line.
 *
 * Expects `VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE` anywhere in the text.
 * Returns a Map of finding number to the verdict word report.json keeps.
 */
export function parseVerdicts(text) {
	const out = new Map();
	if (typeof text !== 'string') {
		return out;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith('VERDICTS:'));
	if (!line) {
		return out;
	}
	for (const part of line.slice(line.indexOf(':') + 1).split(';')) {
		const m = part.trim().match(/^(\d+)\s*=\s*(.+)$/);
		if (!m) {
			continue;
		}
		const verdict = m[2].trim().toUpperCase();
		const word = verdict.startsWith('CONFIRMED') ? 'confirmed'
			: verdict.startsWith('FALSE') ? 'disputed'
				: verdict.startsWith('UNRESOLVED') ? 'unresolved'
					: null;
		if (word) {
			out.set(Number(m[1]), word);
		}
	}
	return out;
}

/**
 * Parses the verifier's known-issue line.
 *
 * Expects `KNOWN: 2=#15102; 3=#14991,#15153` anywhere in the text. Returns a
 * Map of finding number to the issue numbers it may duplicate. A part it
 * cannot read is skipped, like parseVerdicts.
 */
export function parseKnown(text) {
	return parseIssueLine(text, 'KNOWN');
}

/**
 * Parses the verifier's INTENDED line, the same shape as KNOWN: findings that
 * match an issue closed as not planned, so the behavior was judged intended.
 */
export function parseIntended(text) {
	return parseIssueLine(text, 'INTENDED');
}

function parseIssueLine(text, name) {
	const out = new Map();
	if (typeof text !== 'string') {
		return out;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith(`${name}:`));
	if (!line) {
		return out;
	}
	for (const part of line.slice(line.indexOf(':') + 1).split(';')) {
		const m = part.trim().match(/^(\d+)\s*=\s*(.+)$/);
		const issues = m ? [...m[2].matchAll(/#(\d+)/g)].map(i => Number(i[1])) : [];
		if (issues.length) {
			out.set(Number(m[1]), [...new Set(issues)]);
		}
	}
	return out;
}

/**
 * Parses one of the verifier's `KEY: 3=text; 4=text` lines into a Map of
 * finding number to text. A part it cannot read, or one with a `|` that would
 * break the table, is skipped.
 */
function parseNumbered(text, key) {
	const out = new Map();
	if (typeof text !== 'string') {
		return out;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith(`${key}:`));
	if (!line) {
		return out;
	}
	for (const part of line.slice(line.indexOf(':') + 1).split(';')) {
		const m = part.trim().match(/^(\d+)\s*=\s*"?([^"|]*?)"?$/);
		if (m && m[2].trim()) {
			out.set(Number(m[1]), m[2].trim());
		}
	}
	return out;
}

/** `FEATURE: 3=new folder flow`: the feature the evidence points to. */
export function parseFeatures(text) {
	return parseNumbered(text, 'FEATURE');
}

/** `TITLE: 1=...`: a title naming the trigger the evidence shows. */
export function parseTitles(text) {
	return parseNumbered(text, 'TITLE');
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
 * Why the reply's VERDICTS line cannot be applied to this report, or '' when
 * it can: it must give one verdict per finding number, no more, no fewer. A
 * verifier that keyed its line by position instead of by number (the findings
 * are listed worst first) gives a number the report lacks or misses one it has
 * whenever the numbers are not exactly 1..n; within 1..n it cannot be told
 * apart here, which is why the prompt says it plainly.
 */
export function verdictMismatch(report, reply) {
	const want = [...new Set(findingNumbers(report))].sort((a, b) => a - b);
	const got = [...parseVerdicts(reply).keys()].sort((a, b) => a - b);
	const missing = want.filter(n => !got.includes(n));
	const extra = got.filter(n => !want.includes(n));
	if (!missing.length && !extra.length) {
		return '';
	}
	return `the VERDICTS line gives findings ${got.join(', ') || 'none'}, but the report's findings are ${want.join(', ')}`
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
 * reply gave no severity, and each KNOWN match on a fix or a closed issue.
 */
export function verifyLogLines(knownIssues, ledger, reply) {
	const coverage = knownIssues?.issues?.length && parseLedger(ledger);
	if (!coverage) {
		return [];
	}
	const ki = knownIssueOutcomes(knownIssues, coverage, parseLinked(reply), parseKnown(reply));
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
 * report.json with the verifier's verdicts on its findings, and its reply as
 * `verification`, which the page shows collapsed. A failed pass shows open,
 * because "these findings are unreviewed" is not a detail to hide behind a
 * click, and keeps the explorer's titles and Features.
 */
export function applyVerification(json, verdicts, { failed = false } = {}) {
	const fields = [['verified', parseVerdicts(verdicts)], ['known', parseKnown(verdicts)], ['intended', parseIntended(verdicts)],
		...(failed ? [] : [['title', parseTitles(verdicts)], ['feature', parseFeatures(verdicts)]])];
	const findings = (json.findings ?? []).map(f => fields.reduce((out, [key, values]) => (values.has(f.n) ? { ...out, [key]: values.get(f.n) } : out), f));
	return { ...json, findings, verification: { failed, text: failed ? verdicts : `${PREAMBLE}\n\n${verdicts}` } };
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
 * when its VERDICTS are keyed to other numbers than the report's, so a
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
	const findings = hasFindings(report);
	const mismatch = !error && findings && parseVerdicts(reply).size ? verdictMismatch(report, reply) : '';
	if (mismatch && !giveUp) {
		return { mismatch };
	}
	const failed = Boolean(error || mismatch) || !reply || (findings && !parseVerdicts(reply).size);
	const unreviewed = findings ? 'The findings above are unreviewed.' : 'The known issues above are unrated.';
	const why = error ? `: ${error}` : mismatch ? `: ${mismatch}` : reply ? ': the reply had no VERDICTS line' : '';
	const verdicts = failed
		? `_Verification did not complete${why}. ${unreviewed}_${reply ? `\n\n${reply}` : ''}`
		: fromVerdictLine(reply);
	writeReport(path, applyVerification(report, verdicts, { failed }));
	return { failed, logLines: verifyLogLines(knownIssues, ledger, error ? '' : reply) };
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
