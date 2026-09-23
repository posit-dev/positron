/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertComment } from './comment.mjs';
import { COMMENT_MARKER } from './lib.mjs';

const BOT = 'github-actions[bot]';

/** A fake GitHub: serves `pages` of comments and records every write. */
function fakeGitHub(pages) {
	const calls = [];
	const fetchImpl = async (url, init = {}) => {
		const method = init.method || 'GET';
		calls.push({ method, url, body: init.body ? JSON.parse(init.body) : undefined });
		if (method === 'GET') {
			const page = Number(new URL(url).searchParams.get('page'));
			return { ok: true, status: 200, json: async () => pages[page - 1] ?? [] };
		}
		return { ok: true, status: method === 'POST' ? 201 : 200, json: async () => ({ id: 99 }) };
	};
	return { fetchImpl, calls };
}

const args = { token: 't', repo: 'posit-dev/positron', prNumber: '42', body: `${COMMENT_MARKER}\nnew` };

test('upsertComment creates a comment when none carries the marker', async () => {
	const gh = fakeGitHub([[{ id: 1, user: { login: 'someone' }, body: 'hi' }]]);
	assert.equal(await upsertComment({ ...args, fetchImpl: gh.fetchImpl }), 'created');
	const post = gh.calls.find(c => c.method === 'POST');
	assert.match(post.url, /\/repos\/posit-dev\/positron\/issues\/42\/comments$/);
	assert.equal(post.body.body, args.body);
});

test('upsertComment edits the existing marker comment in place', async () => {
	const gh = fakeGitHub([[{ id: 7, user: { login: BOT }, body: `${COMMENT_MARKER}\nold` }]]);
	assert.equal(await upsertComment({ ...args, fetchImpl: gh.fetchImpl }), 'updated');
	const patch = gh.calls.find(c => c.method === 'PATCH');
	assert.match(patch.url, /\/repos\/posit-dev\/positron\/issues\/comments\/7$/);
	assert.equal(patch.body.body, args.body);
	assert.equal(gh.calls.filter(c => c.method === 'POST').length, 0);
});

test('upsertComment finds the marker comment past the first page', async () => {
	// A busy PR: 100 comments on page one, ours on page two.
	const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, user: { login: 'someone' }, body: 'x' }));
	const gh = fakeGitHub([page1, [{ id: 500, user: { login: BOT }, body: `${COMMENT_MARKER}\nold` }]]);
	assert.equal(await upsertComment({ ...args, fetchImpl: gh.fetchImpl }), 'updated');
	assert.match(gh.calls.find(c => c.method === 'PATCH').url, /comments\/500$/);
});

test('upsertComment stops paging at a short page', async () => {
	const gh = fakeGitHub([[{ id: 1, user: { login: 'someone' }, body: 'x' }]]);
	await upsertComment({ ...args, fetchImpl: gh.fetchImpl });
	assert.equal(gh.calls.filter(c => c.method === 'GET').length, 1);
});

test('upsertComment throws on an API error rather than posting blind', async () => {
	const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'forbidden' });
	await assert.rejects(upsertComment({ ...args, fetchImpl }), /403/);
});
