/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Posts or edits the PR comment for one `/test` run. The body comes from
// renderPrComment in lib.mjs; this file is only the GitHub I/O around it.

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderPrComment, buildShotsBaseUrl } from './lib.mjs';

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
 * Edits the comment this run posted, or posts one. Each /test owns a comment,
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

function readReport(workDir) {
	if (!workDir) {
		return null;
	}
	try {
		return readFileSync(join(workDir, 'report.md'), 'utf8');
	} catch {
		// No report: the build failed first, or the agent never wrote one.
		return null;
	}
}

async function main() {
	const state = process.env.COMMENT_STATE === 'running' ? 'running' : (process.env.OUTCOME || '');
	const body = renderPrComment({
		state,
		markdown: state === 'running' ? null : readReport(process.env.WORK_DIR),
		baseUrl: buildShotsBaseUrl(process.env.REPORT_BASE_URL || ''),
		runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
		headSha: process.env.HEAD_SHA || '',
		model: process.env.MODEL || '',
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
