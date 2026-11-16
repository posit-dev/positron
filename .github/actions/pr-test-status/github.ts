/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Job } from './lanes.ts';
import type { LaneOutput } from './render.ts';
import { sanitizeName } from './results.ts';

const API = 'https://api.github.com/repos/posit-dev';
const BUILDS = `${API}/positron-builds`;
const STATUSES = `${API}/positron/statuses`;

/** Calls the API. Errors carry the status only: response bodies are not echoed. */
async function call(token: string, method: string, url: string, body?: unknown): Promise<unknown> {
	const res = await fetch(url, {
		method,
		headers: {
			'Authorization': `Bearer ${token}`,
			'Accept': 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
			...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) {
		throw new Error(`GitHub API ${method} failed with status ${res.status}`);
	}
	return res.json();
}

/** A commit status has four states: anything that ended without passing or failing is `error`. */
export function statusState(out: LaneOutput): 'pending' | 'success' | 'failure' | 'error' {
	if (out.status === 'in_progress') {
		return 'pending';
	}
	return out.conclusion === 'success' || out.conclusion === 'failure' ? out.conclusion : 'error';
}

/** Lists every job of a positron-builds run, 100 per page. Needs BUILDS_TOKEN. */
export async function listJobs(token: string, runId: string): Promise<Job[]> {
	const jobs: Job[] = [];
	for (let page = 1; ; page++) {
		const data = await call(token, 'GET', `${BUILDS}/actions/runs/${runId}/jobs?per_page=100&filter=latest&page=${page}`) as { total_count: number; jobs: Job[] };
		jobs.push(...data.jobs.map(j => ({
			id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, html_url: j.html_url,
			steps: (j.steps ?? []).map(s => ({ name: s.name, conclusion: s.conclusion })),
		})));
		if (data.jobs.length < 100 || jobs.length >= data.total_count) {
			return jobs;
		}
	}
}

/** Reads a positron-builds run's status. Needs BUILDS_TOKEN. */
export async function getRun(token: string, runId: string): Promise<{ status: string; conclusion: string | null }> {
	const data = await call(token, 'GET', `${BUILDS}/actions/runs/${runId}`) as { status: string; conclusion: string | null };
	return { status: data.status, conclusion: data.conclusion };
}

/** Sets a lane's commit status on a positron commit. Needs STATUS_TOKEN. */
export async function setStatus(token: string, sha: string, context: string, out: LaneOutput, url: string): Promise<void> {
	await call(token, 'POST', `${STATUSES}/${sha}`, {
		context: sanitizeName(context),
		state: statusState(out),
		// GitHub caps a status description at 140 characters.
		description: out.title.slice(0, 140),
		target_url: url,
	});
}
