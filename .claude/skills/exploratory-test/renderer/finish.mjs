/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The verification step every run ends with, shared by CI (run.mjs) and a
// local run, so a report reads the same wherever it was made. The verifier is
// an agent and each side runs it its own way; everything around it is here.
//
// Local usage, around a verifier subagent:
//   node finish.mjs prompt <run dir> --repo <checkout> --base <sha> --head <sha>
//     writes <run dir>/verify-prompt.md and prints its path, or says there
//     are no findings to verify
//   node finish.mjs apply <run dir> <reply file>
//     adds the reply's verdicts to report.md

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { knownFixLines, knownIssueOutcomes, parseLinked } from './known-issues.mjs';
import { parseLedger } from './report-parse.mjs';

/**
 * The verify pass's prompt: verifier.md with the run's paths and diff range
 * filled in. A placeholder with no value, or a value with no placeholder,
 * throws, so the template and this list cannot drift apart quietly.
 */
export function buildVerifyPrompt(template, { workDir, repoRoot, baseSha, headSha }) {
	const values = {
		REPORT: `${workDir}/report.md`,
		ACTIONS_LOG: `${workDir}/actions.log`,
		LEDGER: `${workDir}/ledger.md`,
		FILES: `${workDir}/files/`,
		KNOWN_ISSUES: `${workDir}/known-issues.json`,
		REPO: repoRoot,
		DIFF: `${baseSha}...${headSha}`,
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
 * The verifier's reply from its VERDICTS line on, or from its KNOWN, LINKED,
 * FEATURE or TITLE line if that came first. Its final message can open with notes to
 * itself, which would otherwise lead the Verification details.
 */
export function fromVerdictLine(text) {
	if (typeof text !== 'string') {
		return text;
	}
	const lines = text.split('\n');
	const at = lines.findIndex(l => /^(?:(?:VERDICTS|KNOWN|LINKED|FEATURE|TITLE)|IMPACT \d+):/.test(l.trim().toUpperCase()));
	return at > 0 ? lines.slice(at).join('\n') : text;
}

/**
 * Parses the verifier's machine-readable verdict line.
 *
 * Expects `VERDICTS: 1=CONFIRMED; 2=FALSE POSITIVE` anywhere in the text.
 * Returns a Map of finding number to a short word for the table cell.
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
	const out = new Map();
	if (typeof text !== 'string') {
		return out;
	}
	const line = text.split('\n').find(l => l.trim().toUpperCase().startsWith('KNOWN:'));
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
 * The report with each finding on the TITLE line retitled, in its heading and
 * its table row. The explorer titles a finding by the steps it took, which can
 * name a trigger the verifier finds is not the one that matters.
 */
export function applyTitles(report, titles) {
	if (!(titles instanceof Map) || !titles.size) {
		return report;
	}
	let inFindings = false;
	return report.split('\n').map(line => {
		if (/^## /.test(line)) {
			inFindings = /^## Findings\s*$/.test(line);
		}
		const heading = /^(###\s+Finding\s+(\d+):\s*).*$/.exec(line);
		if (heading && titles.has(Number(heading[2]))) {
			return `${heading[1]}${titles.get(Number(heading[2]))}`;
		}
		const row = inFindings && /^(\|\s*(\d+)\s*\|)[^|]*(\|.*)$/.exec(line);
		if (row && titles.has(Number(row[2]))) {
			return `${row[1]} ${titles.get(Number(row[2]))} ${row[3]}`;
		}
		return line;
	}).join('\n');
}

/**
 * `IMPACT 7: Anyone who ...`, one line per finding, since an Impact holds `;`:
 * the Impact narrowed to what the run showed.
 */
export function parseImpacts(text) {
	const out = new Map();
	for (const m of String(text ?? '').matchAll(/^IMPACT (\d+):[ \t]*(\S.*?)\s*$/gm)) {
		out.set(Number(m[1]), m[2]);
	}
	return out;
}

/** The report with each finding's `**Impact:**` line replaced by its IMPACT line. */
export function applyImpacts(report, impacts) {
	return rewriteLabel(report, 'Impact', impacts);
}

/**
 * The report with each `**Feature:**` line on the FEATURE line rewritten. The
 * explorer picks Feature before the cause is known, and it prefixes the filed
 * issue's title. A finding with no Feature line is left for lint to catch.
 */
export function applyFeatures(report, features) {
	return rewriteLabel(report, 'Feature', features);
}

/** The report with the `**<label>:**` line of each finding in `values` replaced. */
function rewriteLabel(report, label, values) {
	if (!(values instanceof Map) || !values.size) {
		return report;
	}
	let n = null;
	return report.split('\n').map(line => {
		const heading = /^###\s+Finding\s+(\d+):/.exec(line);
		if (heading) {
			n = Number(heading[1]);
		} else if (/^(<details>|## )/.test(line)) {
			n = null;
		} else if (n !== null && values.has(n) && line.startsWith(`**${label}:**`)) {
			return `**${label}:** ${values.get(n)}`;
		}
		return line;
	}).join('\n');
}

/**
 * Appends a `Verified` column to the findings table, and a `Known` column when
 * the verifier matched a finding to an existing issue.
 *
 * Best effort by design: the table is written by an agent, and its shape has
 * drifted before. Anything unexpected returns the report untouched so a
 * cosmetic column can never cost the report its findings. The verdicts are
 * appended in full below regardless, so nothing is lost when this bails.
 */
export function annotateFindingsTable(report, verdicts, known = new Map()) {
	const columns = [];
	if (verdicts instanceof Map && verdicts.size) {
		columns.push(['Verified', n => verdicts.get(n) || '-']);
	}
	if (known instanceof Map && known.size) {
		columns.push(['Known', n => (known.get(n) || []).map(i => `#${i}`).join(', ') || '-']);
	}
	if (typeof report !== 'string' || !columns.length) {
		return report;
	}
	const lines = report.split('\n');
	const header = lines.findIndex(l => /^\|\s*#\s*\|/.test(l));
	if (header === -1 || !/^\|[\s:|-]+\|$/.test(lines[header + 1] || '')) {
		return report;
	}
	lines[header] = `${lines[header].replace(/\s*$/, '')}${columns.map(([name]) => ` ${name} |`).join('')}`;
	lines[header + 1] = `${lines[header + 1].replace(/\s*$/, '')}${'---|'.repeat(columns.length)}`;
	for (let i = header + 2; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			break;
		}
		const n = Number((lines[i].match(/^\|\s*(\d+)\s*\|/) || [])[1]);
		lines[i] = `${lines[i].replace(/\s*$/, '')}${columns.map(([, cell]) => ` ${cell(n)} |`).join('')}`;
	}
	return lines.join('\n');
}

/**
 * True when the report has a findings table with at least one numbered row.
 *
 * A run that found nothing has nothing to verify, and asking anyway produced a
 * page of prose auditing claims nobody disputed.
 */
export function hasFindings(report) {
	if (typeof report !== 'string') {
		return false;
	}
	const lines = report.split('\n');
	const header = lines.findIndex(l => /^\|\s*#\s*\|/.test(l));
	if (header === -1) {
		return false;
	}
	for (let i = header + 2; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			return false;
		}
		if (/^\|\s*\d+\s*\|/.test(lines[i])) {
			return true;
		}
	}
	return false;
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
 * The report with the verifier's verdicts added: a Verified column in the
 * findings table, which is what a reviewer scanning it sees, and the reasoning
 * below. Collapsed, and last. A failed pass stays open, because "these
 * findings are unreviewed" is not a detail to hide behind a click. The blank
 * lines around the markdown are load bearing.
 */
export function applyVerification(report, verdicts, { failed = false } = {}) {
	const section = failed
		? `## Verification\n\n${verdicts}\n`
		: `<details>\n<summary>Verification details</summary>\n\n${PREAMBLE}\n\n${verdicts}\n\n</details>\n`;
	const revised = failed ? report : applyImpacts(applyTitles(applyFeatures(report, parseFeatures(verdicts)), parseTitles(verdicts)), parseImpacts(verdicts));
	return `${annotateFindingsTable(revised, parseVerdicts(verdicts), parseKnown(verdicts))}\n\n${section}`;
}

/**
 * True once a report carries a verification, so it is never added twice. Only
 * the sections applyVerification writes count: an explorer's own heading does not.
 */
export function isVerified(report) {
	return /^<summary>Verification details<\/summary>$|^## Verification\n\n_Verification did not complete/m.test(String(report ?? ''));
}

const VERIFIER_PATH = fileURLToPath(new URL('../verifier.md', import.meta.url));

function main(argv) {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: { repo: { type: 'string' }, base: { type: 'string' }, head: { type: 'string' } },
	});
	const [command, dir, replyFile] = positionals;
	const reportPath = dir && join(dir, 'report.md');
	if (!reportPath || !existsSync(reportPath)) {
		console.error('usage: node finish.mjs prompt <run dir> --repo <checkout> --base <sha> --head <sha>\n       node finish.mjs apply <run dir> <reply file>');
		return 2;
	}
	const report = readFileSync(reportPath, 'utf8');
	const ledgerPath = join(dir, 'ledger.md');
	const ledger = existsSync(ledgerPath) ? readFileSync(ledgerPath, 'utf8') : '';
	const knownIssues = readKnownIssues(dir);
	const observed = observedLinked(knownIssues, ledger);
	if (command === 'prompt') {
		// Linked issues the run ran into still need a severity.
		if (!hasFindings(report) && !observed.length) {
			console.log('no findings: nothing to verify');
			return 0;
		}
		if (!values.repo || !values.base || !values.head) {
			console.error('finish: prompt needs --repo, --base and --head');
			return 2;
		}
		const out = join(dir, 'verify-prompt.md');
		writeFileSync(out, buildVerifyPrompt(readFileSync(VERIFIER_PATH, 'utf8'), {
			workDir: dir, repoRoot: values.repo, baseSha: values.base, headSha: values.head,
		}));
		console.log(out);
		return 0;
	}
	if (command === 'apply') {
		// Checked before anything is written: marking the findings unreviewed
		// over a mistyped path would also stop a corrected retry.
		if (!replyFile || !existsSync(replyFile)) {
			console.error(`finish: reply file not found: ${replyFile ?? '(none given)'}`);
			return 2;
		}
		if (isVerified(report)) {
			console.error('finish: report.md is already verified');
			return 1;
		}
		const reply = readFileSync(replyFile, 'utf8').trim();
		// An empty reply, or one with no verdicts, still says so, rather than
		// leaving the findings looking reviewed.
		const findings = hasFindings(report);
		const failed = !reply || (findings && !parseVerdicts(reply).size);
		const unreviewed = findings ? 'The findings above are unreviewed.' : 'The known issues above are unrated.';
		const verdicts = failed
			? `_Verification did not complete${reply ? `: the reply had no VERDICTS line` : ''}. ${unreviewed}_${reply ? `\n\n${reply}` : ''}`
			: fromVerdictLine(reply);
		writeFileSync(reportPath, applyVerification(report.trimEnd(), verdicts, { failed }));
		for (const line of verifyLogLines(knownIssues, ledger, reply)) {
			console.error(`finish: ${line}`);
		}
		console.log(`finish: ${failed ? 'marked unreviewed' : 'verdicts added to'} ${reportPath}`);
		return 0;
	}
	console.error(`finish: unknown command ${command ?? ''}`);
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
