/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildManifest, bundle, deploy, fetchPrevious } from './outcomes-publish.mjs';

const SERVER = 'https://connect.example.com';
const ME = { guid: 'me-1' };

/** A fake Connect: `routes` maps `METHOD path` to a reply, and every call is recorded. */
function fakeConnect(routes) {
	const calls = [];
	const fetch = async (url, init = {}) => {
		const method = init.method ?? 'GET';
		const path = url.replace(SERVER, '');
		calls.push({ method, path, headers: init.headers, body: init.body });
		const reply = routes[`${method} ${path}`];
		if (reply === undefined) {
			return new Response('not found', { status: 404 });
		}
		const value = typeof reply === 'function' ? reply() : reply;
		return typeof value === 'string' ? new Response(value) : Response.json(value);
	};
	return { fetch, calls };
}

test('buildManifest marks the bundle static with index.html first, and sums each file', () => {
	const m = buildManifest({ 'index.html': '<p>hi</p>', 'rows.jsonl': '{}\n' });
	assert.equal(m.metadata.appmode, 'static');
	assert.equal(m.metadata.primary_html, 'index.html');
	assert.deepEqual(Object.keys(m.files), ['index.html', 'rows.jsonl']);
	assert.equal(m.files['index.html'].checksum, createHash('md5').update('<p>hi</p>').digest('hex'));
	assert.match(m.files['rows.jsonl'].checksum, /^[0-9a-f]{32}$/);
});

test('bundle is a tar.gz with the manifest and the files at the top', () => {
	const dir = mkdtempSync(join(tmpdir(), 'outcomes-bundle-test-'));
	const path = join(dir, 'b.tar.gz');
	writeFileSync(path, bundle({ 'index.html': '<p>hi</p>', 'rows.jsonl': '{}\n' }));
	assert.deepEqual(execFileSync('tar', ['-tzf', path], { encoding: 'utf8' }).split('\n').filter(Boolean).sort(), ['index.html', 'manifest.json', 'rows.jsonl']);
});

test('fetchPrevious reads rows.jsonl from the content the key owns, with the key', async () => {
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/user': ME,
		'GET /__api__/v1/content?name=explore-outcomes&owner_guid=me-1': [{ guid: 'c1', content_url: `${SERVER}/content/c1/` }],
		'GET /content/c1/rows.jsonl': '{"run":"1"}\n',
	});
	assert.equal(await fetchPrevious({ server: SERVER, key: 'k', name: 'explore-outcomes', fetch }), '{"run":"1"}\n');
	assert.ok(calls.every(c => c.headers.Authorization === 'Key k'));
});

test('fetchPrevious is empty before the first deploy', async () => {
	const { fetch } = fakeConnect({ 'GET /__api__/v1/user': ME, 'GET /__api__/v1/content?name=explore-outcomes&owner_guid=me-1': [] });
	assert.equal(await fetchPrevious({ server: SERVER, key: 'k', name: 'explore-outcomes', fetch }), '');
});

test('the first deploy creates the content for the owner only, sets its vanity URL, uploads and waits for the task', async () => {
	let polls = 0;
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/user': ME,
		'GET /__api__/v1/content?name=explore-outcomes&owner_guid=me-1': [],
		'POST /__api__/v1/content': { guid: 'c1', content_url: `${SERVER}/content/c1/` },
		'PUT /__api__/v1/content/c1/vanity': { path: '/explore-outcomes/' },
		'POST /__api__/v1/content/c1/bundles': { id: 'b1' },
		'POST /__api__/v1/content/c1/deploy': { task_id: 't1' },
		'GET /__api__/v1/tasks/t1?wait=5': () => ++polls < 2 ? { finished: false } : { finished: true, code: 0 },
	});
	const url = await deploy({ server: SERVER, key: 'k', name: 'explore-outcomes', title: 'T', vanity: '/explore-outcomes/', archive: Buffer.from('x'), fetch });
	assert.equal(url, `${SERVER}/content/c1/`);
	assert.deepEqual(JSON.parse(calls.find(c => c.method === 'POST' && c.path === '/__api__/v1/content').body), { name: 'explore-outcomes', title: 'T', access_type: 'acl' });
	assert.equal(calls.find(c => c.path.endsWith('/bundles')).headers['Content-Type'], 'application/gzip');
	assert.deepEqual(JSON.parse(calls.find(c => c.path.endsWith('/deploy')).body), { bundle_id: 'b1' });
	assert.equal(polls, 2);
});

test('a later deploy reuses the content and leaves its settings alone', async () => {
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/user': ME,
		'GET /__api__/v1/content?name=explore-outcomes&owner_guid=me-1': [{ guid: 'c1', content_url: `${SERVER}/content/c1/` }],
		'POST /__api__/v1/content/c1/bundles': { id: 'b2' },
		'POST /__api__/v1/content/c1/deploy': { task_id: 't2' },
		'GET /__api__/v1/tasks/t2?wait=5': { finished: true, code: 0 },
	});
	await deploy({ server: SERVER, key: 'k', name: 'explore-outcomes', title: 'T', vanity: '/explore-outcomes/', archive: Buffer.from('x'), fetch });
	assert.ok(!calls.some(c => c.path === '/__api__/v1/content' || c.path.endsWith('/vanity')));
});

test('a failed deploy task throws with its error', async () => {
	const { fetch } = fakeConnect({
		'GET /__api__/v1/user': ME,
		'GET /__api__/v1/content?name=explore-outcomes&owner_guid=me-1': [{ guid: 'c1', content_url: `${SERVER}/content/c1/` }],
		'POST /__api__/v1/content/c1/bundles': { id: 'b2' },
		'POST /__api__/v1/content/c1/deploy': { task_id: 't2' },
		'GET /__api__/v1/tasks/t2?wait=5': { finished: true, code: 1, error: 'bad manifest' },
	});
	await assert.rejects(deploy({ server: SERVER, key: 'k', name: 'explore-outcomes', title: 'T', vanity: '/x/', archive: Buffer.from('x'), fetch }), /bad manifest/);
});

test('a Connect error names the call that failed', async () => {
	const { fetch } = fakeConnect({});
	await assert.rejects(fetchPrevious({ server: SERVER, key: 'k', name: 'explore-outcomes', fetch }), /GET \/__api__\/v1\/user failed: 404/);
});
