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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

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
		REPO: repoRoot,
		DIFF: `${baseSha}...${headSha}`,
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
 * The verifier's reply from its VERDICTS line on. Its final message can open
 * with notes to itself, which would otherwise lead the Verification details.
 */
export function fromVerdictLine(text) {
	if (typeof text !== 'string') {
		return text;
	}
	const lines = text.split('\n');
	const at = lines.findIndex(l => l.trim().toUpperCase().startsWith('VERDICTS:'));
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
 * Appends a `Verified` column to the findings table.
 *
 * Best effort by design: the table is written by an agent, and its shape has
 * drifted before. Anything unexpected returns the report untouched so a
 * cosmetic column can never cost the report its findings. The verdicts are
 * appended in full below regardless, so nothing is lost when this bails.
 */
export function annotateFindingsTable(report, verdicts) {
	if (typeof report !== 'string' || !(verdicts instanceof Map) || verdicts.size === 0) {
		return report;
	}
	const lines = report.split('\n');
	const header = lines.findIndex(l => /^\|\s*#\s*\|/.test(l));
	if (header === -1 || !/^\|[\s:|-]+\|$/.test(lines[header + 1] || '')) {
		return report;
	}
	lines[header] = `${lines[header].replace(/\s*$/, '')} Verified |`;
	lines[header + 1] = `${lines[header + 1].replace(/\s*$/, '')}---|`;
	for (let i = header + 2; i < lines.length; i++) {
		if (!lines[i].startsWith('|')) {
			break;
		}
		const n = Number((lines[i].match(/^\|\s*(\d+)\s*\|/) || [])[1]);
		lines[i] = `${lines[i].replace(/\s*$/, '')} ${verdicts.get(n) || '-'} |`;
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
	return `${annotateFindingsTable(report, parseVerdicts(verdicts))}\n\n${section}`;
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
	if (command === 'prompt') {
		if (!hasFindings(report)) {
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
		const failed = !reply || !parseVerdicts(reply).size;
		const verdicts = failed
			? `_Verification did not complete${reply ? `: the reply had no VERDICTS line` : ''}. The findings above are unreviewed._${reply ? `\n\n${reply}` : ''}`
			: fromVerdictLine(reply);
		writeFileSync(reportPath, applyVerification(report.trimEnd(), verdicts, { failed }));
		console.log(`finish: ${failed ? 'marked unreviewed' : 'verdicts added to'} ${reportPath}`);
		return 0;
	}
	console.error(`finish: unknown command ${command ?? ''}`);
	return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = main(process.argv.slice(2));
}
