/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Posts or edits the single PR comment for a `/test` run. The body comes from
// renderPrComment in lib.mjs; this file is only the GitHub I/O around it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findMarkerCommentId, renderPrComment, buildShotsBaseUrl } from './lib.mjs';

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
 * Edits the comment carrying the marker, or creates one. Reads every page: the
 * API serves at most 100 comments a page, and missing ours on page two would
 * post a duplicate.
 */
export async function upsertComment({ fetchImpl, token, repo, prNumber, body }) {
	const comments = [];
	for (let page = 1; ; page++) {
		const batch = await gh(fetchImpl, token, `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
		comments.push(...batch);
		if (batch.length < 100) {
			break;
		}
	}
	const id = findMarkerCommentId(comments);
	if (id !== null) {
		await gh(fetchImpl, token, `/repos/${repo}/issues/comments/${id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
		return 'updated';
	}
	await gh(fetchImpl, token, `/repos/${repo}/issues/${prNumber}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
	return 'created';
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
	});
	const result = await upsertComment({
		fetchImpl: fetch,
		token: process.env.GH_TOKEN,
		repo: process.env.GITHUB_REPOSITORY,
		prNumber: process.env.PR_NUMBER,
		body,
	});
	console.log(`[comment] ${result} (${state || 'failed'})`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
