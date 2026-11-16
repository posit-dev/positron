/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Posts or edits the PR comment for one `/explore` run. The body comes from
// renderPrComment in lib.mjs; this file is only the GitHub I/O around it.

import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson } from '../../../.claude/skills/exploratory-test/renderer/shared/text.mjs';
import { renderPrComment, buildShotsBaseUrl, failedStep } from './lib.mjs';

const API = 'https://api.github.com';

async function gh(fetchImpl, token, path, init = {}) {
	const res = await fetchImpl(`${API}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'Content-Type': 'application/json',
		},
	});
	if (!res.ok) {
		throw new Error(`GitHub ${init.method || 'GET'} ${path} failed: ${res.status} ${await res.text()}`);
	}
	return res.json();
}

/**
 * Edits the comment this run posted, or posts one. Each /explore owns a comment,
 * so the running comment becomes that run's result and earlier runs' results
 * stay where they were.
 */
export async function postOrEditComment({ fetchImpl, token, repo, prNumber, commentId, body }) {
	const payload = { body: JSON.stringify({ body }) };
	if (commentId) {
		await gh(fetchImpl, token, `/repos/${repo}/issues/comments/${commentId}`, { method: 'PATCH', ...payload });
		return { action: 'updated', id: Number(commentId) };
	}
	const created = await gh(fetchImpl, token, `/repos/${repo}/issues/${prNumber}/comments`, { method: 'POST', ...payload });
	return { action: 'created', id: created.id };
}

/** The run's report.json, or null when the build failed first or the agent never wrote one. */
function readReport(workDir) {
	return workDir ? readJson(join(workDir, 'report.json')) : null;
}

/** The numbers of the findings the run's page lists as known issues, from its stats.json. */
function readDemoted(workDir) {
	return ((workDir ? readJson(join(workDir, 'stats.json')) : null)?.demoted ?? []).map(d => d.finding);
}

/** The step that failed in this run attempt, or null when none did or the jobs can't be read. */
export async function findFailedStep({ fetchImpl, token, repo, runId, attempt }) {
	try {
		const { jobs } = await gh(fetchImpl, token, `/repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`);
		return failedStep(jobs);
	} catch (err) {
		console.log(`[comment] could not read the run's jobs: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

const BUILDS_REPO = 'posit-dev/positron-builds';

/** The run the comment links to: the builds run when one was dispatched, else this one. */
export function buildRunUrl(env) {
	const server = env.GITHUB_SERVER_URL || 'https://github.com';
	return env.BUILDS_RUN_ID
		? `${server}/${BUILDS_REPO}/actions/runs/${env.BUILDS_RUN_ID}`
		: `${server}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

/**
 * The failed step in the builds run when one was dispatched (tagged with its
 * repo), else in this run. Builds first: the dispatch job here fails whenever
 * the builds run did, so this run's own step would always win.
 */
export async function findFailure(env, fetchImpl) {
	if (env.BUILDS_RUN_ID) {
		const builds = await findFailedStep({
			fetchImpl,
			token: env.BUILDS_TOKEN,
			repo: BUILDS_REPO,
			runId: env.BUILDS_RUN_ID,
			attempt: env.BUILDS_RUN_ATTEMPT || '1',
		});
		if (builds) {
			return { ...builds, repo: 'positron-builds' };
		}
	}
	return findFailedStep({
		fetchImpl,
		token: env.GH_TOKEN,
		repo: env.GITHUB_REPOSITORY,
		runId: env.GITHUB_RUN_ID,
		attempt: env.GITHUB_RUN_ATTEMPT || '1',
	});
}

async function main() {
	const state = process.env.COMMENT_STATE === 'running' ? 'running' : (process.env.OUTCOME || '');
	// Only a run that failed before the agent ran needs the step that broke.
	const failure = state ? null : await findFailure(process.env, fetch);
	const body = renderPrComment({
		state,
		report: state === 'running' ? null : readReport(process.env.WORK_DIR),
		demoted: state === 'running' ? [] : readDemoted(process.env.WORK_DIR),
		baseUrl: buildShotsBaseUrl(process.env.REPORT_BASE_URL || ''),
		runUrl: buildRunUrl(process.env),
		scanUrl: process.env.SCAN_URL || '',
		buildsRun: Boolean(process.env.BUILDS_RUN_ID),
		headSha: process.env.HEAD_SHA || '',
		reason: process.env.DECLINE_REASON || '',
		focus: process.env.FOCUS || '',
		autoRun: process.env.AUTO_RUN === 'true',
		failure,
	});
	const { action, id } = await postOrEditComment({
		fetchImpl: fetch,
		token: process.env.GH_TOKEN,
		repo: process.env.GITHUB_REPOSITORY,
		prNumber: process.env.PR_NUMBER,
		commentId: process.env.COMMENT_ID || '',
		body,
	});
	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(process.env.GITHUB_OUTPUT, `comment_id=${id}\n`);
	}
	console.log(`[comment] ${action} ${id} (${state || 'failed'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
