/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Trial: the explorer writes report.json instead of report.md (REPORT_FORMAT=json).
// The verifier, isolator and editor read markdown, so they do not run here.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readRunDir, skillVersion, writeRunPage } from '../../../.claude/skills/exploratory-test/renderer/html.mjs';
import { buildRetryPrompt, checkReportJson, mergeRetry, schemaProblems } from '../../../.claude/skills/exploratory-test/renderer/lint-json.mjs';
import { reportFromJson } from '../../../.claude/skills/exploratory-test/renderer/report-json.mjs';

const RENDERER = fileURLToPath(new URL('../../../.claude/skills/exploratory-test/renderer/', import.meta.url));

/** The CI override that replaces the skill's write and render steps. */
export function jsonOverride(workDir) {
	return [
		`**Write \`report.json\`, not \`report.md\`.** Write the report as JSON matching the schema in \`${RENDERER}report.schema.json\`, with Bash as one quoted heredoc: \`cat > "${workDir}/report.json" <<'REPORT'\`.`,
		'The skill\'s write-up rules still decide what you report, its wording, evidence and length; ignore what they say about markdown layout (headings, tables, bold labels, link syntax, the render step). Fields the schema marks markdown take markdown. `scenarios` is the coverage the ledger records, one item per scenario, with surfaces you did not run as status `not-run`. Leave out `header.pr`, which the workflow adds.',
		`Then run \`node ${RENDERER}lint-json.mjs "${workDir}/report.json"\`, fix every line it prints, and run it again until it prints none. It checks the schema, and that the report agrees with \`ledger.md\`: a finding's steps and rate are the scenario's that failed for it, each step as the ledger words it (you may trim, not add).`,
	].join(' ');
}

/** Schema problems first: the ledger check reads fields the schema requires. */
function problemsOf(json, ledger) {
	const shape = schemaProblems(json);
	return shape.length ? shape.map(text => ({ text })) : checkReportJson(json, ledger);
}

/**
 * Checks report.json against the ledger and, if anything is wrong, resumes the
 * explorer once with the problems, keeping only the parts it was asked to fix.
 * Returns the report, or null when the explorer wrote none.
 */
export async function settleReportJson(workDir, { resume, log = console.log }) {
	const path = join(workDir, 'report.json');
	if (!existsSync(path)) {
		return null;
	}
	const ledger = existsSync(join(workDir, 'ledger.md')) ? readFileSync(join(workDir, 'ledger.md'), 'utf8') : '';
	const read = () => {
		try {
			return JSON.parse(readFileSync(path, 'utf8'));
		} catch (err) {
			log(`[json] report.json does not parse: ${err.message}`);
			return null;
		}
	};
	const first = read();
	const problems = first ? problemsOf(first, ledger) : [{ text: 'report.json is not valid JSON' }];
	log(`[json] ${problems.length} problems after the explorer: ${problems.map(p => p.text).join(' | ')}`);
	if (!problems.length || !resume) {
		return first;
	}
	if (first) {
		copyFileSync(path, join(workDir, 'report.first.json'));
	}
	await resume(`${buildRetryPrompt(problems)}\n\nWrite it to \`${path}\` again and run the check.`);
	const retry = read();
	if (!retry) {
		return first;
	}
	copyFileSync(path, join(workDir, 'report.retry.json'));
	// A broken first draft has nothing to merge into.
	const { report, ignored } = first && !schemaProblems(first).length ? mergeRetry(first, retry, problems) : { report: retry, ignored: [] };
	const left = problemsOf(report, ledger);
	log(`[json] after the retry: ${left.length} problems${ignored.length ? `; kept the first version of ${ignored.join(', ')}` : ''}`);
	writeFileSync(path, `${JSON.stringify(report, null, '\t')}\n`);
	writeFileSync(join(workDir, 'json-trial.json'), `${JSON.stringify({ first: problems.map(p => p.text), left: left.map(p => p.text), ignored }, null, 2)}\n`);
	return report;
}

/** A plain markdown stand-in for report.md: the job summary, stats and outcome read it. */
export function summaryMarkdown(json) {
	const h = json.header ?? {};
	const cell = text => String(text ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
	return [
		`# ${h.title ?? 'Exploratory test'}`,
		'',
		`\`${h.branch ?? ''}\` | \`${String(h.sha ?? '').slice(0, 10)}\``,
		'',
		`**Result:** ${h.result ?? ''}`,
		`**Tested:** ${h.tested ?? ''}`,
		`**Not exercised:** ${h.notExercised ?? 'none'}`,
		'',
		'## Findings',
		'',
		...(json.findings?.length ? [
			'| # | Finding | Severity | Reproduction |',
			'|---|---------|----------|--------------|',
			...json.findings.map(f => `| ${f.n} | ${cell(f.title)} | ${f.severity} | ${f.reproduced?.n}/${f.reproduced?.m} |`),
		] : ['No findings.']),
		'',
		'This run wrote `report.json`; `index.html` is the report.',
	].join('\n');
}

/** Renders report.json as the run's index.html, as render-json.mjs does. */
export async function writeJsonPage(workDir, json, options) {
	const { ledger, knownIssues, issueRefs, changeBase, fileExists, readFile } = readRunDir(workDir);
	const report = reportFromJson(json, { ledger, pipeline: {} });
	await writeRunPage(join(workDir, 'index.html'), '', report, {
		report, ledger, fileExists, readFile, knownIssues, issueRefs, changeBase, skillVersion: skillVersion(), ...options,
	});
}
