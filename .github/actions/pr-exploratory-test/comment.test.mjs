/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postOrEditComment, findFailure, buildRunUrl } from './comment.mjs';

/** A fake GitHub that records every call and answers writes with id 99. */
function fakeGitHub() {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		calls.push({ method: init.method || 'GET', url, body: init.body ? JSON.parse(init.body) : undefined });
		return { ok: true, status: init.method === 'POST' ? 201 : 200, json: async () => ({ id: 99 }) };
	};
	return { fetchImpl, calls };
}

const args = { token: 't', repo: 'posit-dev/positron', prNumber: '42', body: 'new' };

test('postOrEditComment posts a new comment when given no id', async () => {
	const gh = fakeGitHub();
	assert.deepEqual(await postOrEditComment({ ...args, fetchImpl: gh.fetchImpl }), { action: 'created', id: 99 });
	assert.equal(gh.calls.length, 1);
	assert.equal(gh.calls[0].method, 'POST');
	assert.match(gh.calls[0].url, /\/repos\/posit-dev\/positron\/issues\/42\/comments$/);
	assert.equal(gh.calls[0].body.body, 'new');
});

test('postOrEditComment edits the given comment and nothing else', async () => {
	// Each /test owns its comment; an earlier run's comment must stay as it was.
	const gh = fakeGitHub();
	assert.deepEqual(await postOrEditComment({ ...args, commentId: '7', fetchImpl: gh.fetchImpl }), { action: 'updated', id: 7 });
	assert.equal(gh.calls.length, 1);
	assert.equal(gh.calls[0].method, 'PATCH');
	assert.match(gh.calls[0].url, /\/repos\/posit-dev\/positron\/issues\/comments\/7$/);
	assert.equal(gh.calls[0].body.body, 'new');
});

test('postOrEditComment throws on an API error', async () => {
	const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
	await assert.rejects(postOrEditComment({ ...args, fetchImpl }), /403/);
	await assert.rejects(postOrEditComment({ ...args, commentId: '7', fetchImpl }), /403/);
});

/** A fake jobs API: a run id maps to its jobs; an unknown run answers 404. */
function fakeJobs(runs) {
	const urls = [];
	const fetchImpl = async url => {
		urls.push(url);
		const id = /\/runs\/(\d+)\//.exec(url)[1];
		return runs[id]
			? { ok: true, status: 200, json: async () => ({ jobs: runs[id] }) }
			: { ok: false, status: 404, text: async () => 'nope' };
	};
	return { fetchImpl, urls };
}

const failedJob = { name: 'explore', conclusion: 'failure', html_url: 'https://github.com/x/y/actions/runs/2/job/9', steps: [{ name: 'Build', number: 4, conclusion: 'failure' }] };
const env = { GH_TOKEN: 'g', GITHUB_REPOSITORY: 'posit-dev/positron', GITHUB_RUN_ID: '1', GITHUB_SERVER_URL: 'https://github.com' };

const ownJob = { ...failedJob, name: 'dispatch', steps: [{ name: 'Report the explore run', number: 9, conclusion: 'failure' }] };

test('findFailure prefers the builds step when both runs failed and tags its repo', async () => {
	const gh = fakeJobs({ 1: [ownJob], 2: [failedJob] });
	const failure = await findFailure({ ...env, BUILDS_RUN_ID: '2', BUILDS_RUN_ATTEMPT: '3', BUILDS_TOKEN: 'b' }, gh.fetchImpl);
	assert.deepEqual(failure, { job: 'explore', step: 'Build', url: `${failedJob.html_url}#step:4:1`, repo: 'positron-builds' });
	assert.equal(gh.urls.length, 1);
	assert.match(gh.urls[0], /\/repos\/posit-dev\/positron-builds\/actions\/runs\/2\/attempts\/3\/jobs/);
});

test('findFailure falls back to the positron step when the builds run has none, and leaves repo unset', async () => {
	const gh = fakeJobs({ 1: [ownJob], 2: [] });
	const failure = await findFailure({ ...env, BUILDS_RUN_ID: '2' }, gh.fetchImpl);
	assert.deepEqual(failure, { job: 'dispatch', step: 'Report the explore run', url: `${failedJob.html_url}#step:9:1` });
	assert.equal(gh.urls.length, 2);
});

test('findFailure without BUILDS_RUN_ID only reads the positron run', async () => {
	const gh = fakeJobs({ 1: [] });
	assert.equal(await findFailure(env, gh.fetchImpl), null);
	assert.equal(gh.urls.length, 1);
});

test('buildRunUrl names positron-builds when BUILDS_RUN_ID is set, else positron', () => {
	assert.equal(buildRunUrl({ ...env, BUILDS_RUN_ID: '2' }), 'https://github.com/posit-dev/positron-builds/actions/runs/2');
	assert.equal(buildRunUrl(env), 'https://github.com/posit-dev/positron/actions/runs/1');
});
