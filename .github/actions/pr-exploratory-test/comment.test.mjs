/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postOrEditComment } from './comment.mjs';

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
