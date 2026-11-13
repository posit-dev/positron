/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Turns a positron-builds explore run into one state per model for the report
// job. Never throws on missing input: every model gets a state.

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { formatTally, reportLinkLine, resolveDispatchOutcome } from './lib.mjs';

/** The models a run covers, from resolve's opus, sonnet or both. */
export function modelsFor(model) {
	if (model === 'both') { return ['opus', 'sonnet']; }
	return model === 'sonnet' ? ['sonnet'] : ['opus'];
}

/** Parsed JSON from a file or string, or `fallback` when it is missing or unparseable. */
export function parseJson(text, fallback = null) {
	try {
		return text ? JSON.parse(text) : fallback;
	} catch {
		return fallback;
	}
}

function readFile(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

const REPORT_HOST = 'https://positron-reports.tail00da2.ts.net';

/** The one report URL the builds run's publish job can write for a model, or '' without a run id and attempt. */
export function expectedReportUrl(runId, runAttempt, model) {
	if (!/^\d+$/.test(String(runId ?? '')) || !/^\d+$/.test(String(runAttempt ?? ''))) { return ''; }
	return `${REPORT_HOST}/exploratory-report-${runId}-${runAttempt}-${model}-ubuntu-x64/`;
}

const isCount = n => Number.isInteger(n) && n >= 0;

/**
 * The findings tally from a result file's counts, or '' when any is not a
 * whole number or the severities add up to more than the total.
 */
export function tallyFromResult(result) {
	const severity = result?.severity;
	const findings = result?.findings;
	if (!isCount(findings) || !severity || !['major', 'moderate', 'minor'].every(s => isCount(severity[s]))) { return ''; }
	if (severity.major + severity.moderate + severity.minor > findings) { return ''; }
	return formatTally(severity, findings);
}

/**
 * The state and report URL per model, the findings tally for each model whose
 * result file carried counts, and the scan job URL for each model whose scan failed.
 * A report URL counts only when it is the one this run publishes to: PR code can upload artifacts.
 */
export function collectResults({ dir, models, runConclusion, timedOutModels, jobs, runId, runAttempt }) {
	const results = {};
	const scanUrls = {};
	const tallies = {};
	for (const model of models) {
		const raw = parseJson(readFile(join(dir, `explore-result-${model}.json`)));
		const result = raw && typeof raw === 'object' && raw.model === model ? raw : null;
		const urlFile = parseJson(readFile(join(dir, `explore-report-url-${model}.json`)));
		const expected = expectedReportUrl(runId, runAttempt, model);
		const reportUrl = expected && urlFile?.model === model && urlFile.reportUrl === expected ? expected : '';
		results[model] = resolveDispatchOutcome({ model, runConclusion, timedOutModels, result, reportUrl });
		const tally = tallyFromResult(result);
		if (tally) { tallies[model] = tally; }
		if (results[model].state === 'scan-failed') {
			const job = (Array.isArray(jobs) ? jobs : []).find(j => j?.name === `scan (${model})`);
			scanUrls[model] = typeof job?.html_url === 'string' ? job.html_url : '';
		}
	}
	return { results, scanUrls, tallies };
}

const STATE_LABELS = {
	'complete': 'Complete',
	'partial': 'Partial run (turn cap)',
	'timed-out': 'Stopped at the time limit',
	'no-report': 'No report',
	'failed': 'Failed',
	'scan-failed': 'Secret scan failed',
	'outdated': 'Branch predates the helper update',
	'cancelled': 'Cancelled',
	'job-timeout': 'Job timed out',
};

/**
 * The job summary, as the builds run's explore job writes it: the tally and
 * the report link, with the outcome first when the run did not complete.
 * Without a report it names the outcome alone. A heading names each model
 * when the run compared two.
 */
export function renderDispatchSummary({ results, scanUrls = {}, tallies = {} }) {
	const models = Object.keys(results);
	const blocks = models.map(model => {
		const { state, reportUrl } = results[model];
		// An outcome the map does not know is never echoed: it came from the builds run.
		const label = Object.hasOwn(STATE_LABELS, state) ? STATE_LABELS[state] : STATE_LABELS.failed;
		const lines = models.length > 1 ? [`### ${model}`, ''] : [];
		if (reportUrl) {
			const tally = tallies[model] ?? '';
			const headline = state === 'complete' ? (tally || label) : [label, tally].filter(Boolean).join(': ');
			lines.push(`**${headline}**`, '', reportLinkLine(`${reportUrl}index.html`));
		} else {
			lines.push(`**${label}**`);
			if (scanUrls[model]) {
				lines.push('', `[Scan job](${scanUrls[model]})`);
			} else if (state === 'complete') {
				lines.push('', 'The report was not published; the positron-builds run above has its artifact.');
			}
		}
		return lines.join('\n');
	});
	return `\n${blocks.join('\n\n')}\n`;
}

function main() {
	const env = process.env;
	const timedOut = parseJson(env.TIMED_OUT, []);
	const { results, scanUrls, tallies } = collectResults({
		dir: env.RESULT_DIR || '',
		models: modelsFor(env.MODEL),
		runConclusion: env.RUN_CONCLUSION || '',
		timedOutModels: new Set(Array.isArray(timedOut) ? timedOut : []),
		jobs: parseJson(readFile(env.JOBS_FILE || ''), []),
		runId: env.BUILDS_RUN_ID,
		runAttempt: env.BUILDS_RUN_ATTEMPT,
	});
	console.log(JSON.stringify({ results, scanUrls }, null, 2));
	if (env.GITHUB_OUTPUT) {
		appendFileSync(env.GITHUB_OUTPUT, `results=${JSON.stringify(results)}\nscan_urls=${JSON.stringify(scanUrls)}\n`);
	}
	// Below the builds run link the dispatch step wrote; no run, nothing to summarize.
	if (env.GITHUB_STEP_SUMMARY && /^\d+$/.test(env.BUILDS_RUN_ID ?? '')) {
		appendFileSync(env.GITHUB_STEP_SUMMARY, renderDispatchSummary({ results, scanUrls, tallies }));
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
