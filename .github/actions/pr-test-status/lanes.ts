/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** The fields of a workflow-run job (jobs API) that we use. */
export type Job = {
	id: number;
	name: string;
	status: 'queued' | 'in_progress' | 'completed' | 'waiting' | 'pending';
	conclusion: string | null;
	html_url: string;
	steps?: { name: string; conclusion: string | null }[];
};

/** One test lane: every job (shard, scan, publish) that belongs to it. */
export type Lane = {
	name: string;
	jobs: Job[];
	state: 'in_progress' | 'success' | 'failure' | 'cancelled';
};

/** Jobs that never started keep their raw template text instead of an expanded name. */
const UNEXPANDED = /\$\{\{|inputs\.| \|\| /;

const SUFFIX = /-(?:publish|scan-\d+|logs-scan|\d+)$/;

/**
 * Maps a job name like `e2e / e2e-electron-ubuntu-3` to its lane name, or
 * null for a job that is not part of a lane (no ` / `, or an unexpanded template name).
 */
export function laneName(jobName: string): string | null {
	const at = jobName.indexOf(' / ');
	if (at < 0 || UNEXPANDED.test(jobName)) {
		return null;
	}
	const left = jobName.slice(0, at);
	const stripped = jobName.slice(at + 3).replace(SUFFIX, '');
	return stripped === left ? left : `${left} / ${stripped}`;
}

function laneState(jobs: Job[], runCompleted: boolean): Lane['state'] {
	if (jobs.some(j => j.status !== 'completed')) {
		return 'in_progress';
	}
	if (jobs.some(j => j.conclusion === 'failure' || j.conclusion === 'timed_out')) {
		return 'failure';
	}
	// Jobs that wait on others are not listed until they start, so while the
	// run is going a lane with no failure may still gain jobs.
	if (!runCompleted) {
		return 'in_progress';
	}
	if (jobs.some(j => j.conclusion === 'cancelled')) {
		return 'cancelled';
	}
	return 'success';
}

/** Groups jobs into lanes sorted by name; lanes where every job was skipped are dropped. */
export function groupLanes(jobs: Job[], runCompleted = true): Lane[] {
	const byName = new Map<string, Job[]>();
	for (const job of jobs) {
		const name = laneName(job.name);
		if (name === null) {
			continue;
		}
		byName.set(name, [...(byName.get(name) ?? []), job]);
	}
	return [...byName.entries()]
		.filter(([, laneJobs]) => !laneJobs.every(j => j.conclusion === 'skipped'))
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([name, laneJobs]) => ({ name, jobs: laneJobs, state: laneState(laneJobs, runCompleted) }));
}
