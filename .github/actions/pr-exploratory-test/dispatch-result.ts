/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Turns a positron-builds explore run into one state per model for the report
// job. Never throws on missing input: every model gets a state.

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveDispatchOutcome } from './lib.mjs';

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

/**
 * The state and report URL per model, and the scan job URL for each model whose scan failed.
 * A report URL counts only when it is the one this run publishes to: PR code can upload artifacts.
 */
export function collectResults({ dir, models, runConclusion, timedOutModels, jobs, runId, runAttempt }) {
	const results = {};
	const scanUrls = {};
	for (const model of models) {
		const raw = parseJson(readFile(join(dir, `explore-result-${model}.json`)));
		const result = raw && typeof raw === 'object' && raw.model === model ? raw : null;
		const urlFile = parseJson(readFile(join(dir, `explore-report-url-${model}.json`)));
		const expected = expectedReportUrl(runId, runAttempt, model);
		const reportUrl = expected && urlFile?.model === model && urlFile.reportUrl === expected ? expected : '';
		results[model] = resolveDispatchOutcome({ model, runConclusion, timedOutModels, result, reportUrl });
		if (results[model].state === 'scan-failed') {
			const job = (Array.isArray(jobs) ? jobs : []).find(j => j?.name === `scan (${model})`);
			scanUrls[model] = typeof job?.html_url === 'string' ? job.html_url : '';
		}
	}
	return { results, scanUrls };
}

function main() {
	const env = process.env;
	const timedOut = parseJson(env.TIMED_OUT, []);
	const { results, scanUrls } = collectResults({
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
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
