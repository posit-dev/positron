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
import { buildManifest, bundle, create, deploy, fetchPrevious } from './outcomes-publish.mjs';

const SERVER = 'https://connect.example.com';
const CONTENT = { guid: 'c1', content_url: `${SERVER}/content/c1/` };

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
		const value = typeof reply === 'function' ? reply(init) : reply;
		return value instanceof Response ? value : typeof value === 'string' ? new Response(value) : Response.json(value);
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

test('fetchPrevious reads rows.jsonl from the content with the key', async () => {
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/content/c1': CONTENT,
		'GET /content/c1/rows.jsonl': '{"run":"1"}\n',
	});
	assert.equal(await fetchPrevious({ server: SERVER, key: 'k', guid: 'c1', fetch }), '{"run":"1"}\n');
	assert.ok(calls.every(c => c.headers.Authorization === 'Key k'));
});

test('fetchPrevious is empty when the content has no rows yet', async () => {
	const { fetch } = fakeConnect({ 'GET /__api__/v1/content/c1': CONTENT });
	assert.equal(await fetchPrevious({ server: SERVER, key: 'k', guid: 'c1', fetch }), '');
});

test('deploy uploads to the given content, waits for the task, and never creates or renames anything', async () => {
	let polls = 0;
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/content/c1': CONTENT,
		'POST /__api__/v1/content/c1/bundles': { id: 'b1' },
		'POST /__api__/v1/content/c1/deploy': { task_id: 't1' },
		'GET /__api__/v1/tasks/t1?wait=5': () => ++polls < 2 ? { finished: false } : { finished: true, code: 0 },
	});
	assert.equal(await deploy({ server: SERVER, key: 'k', guid: 'c1', archive: Buffer.from('x'), fetch }), `${SERVER}/content/c1/`);
	assert.equal(calls.find(c => c.path.endsWith('/bundles')).headers['Content-Type'], 'application/gzip');
	assert.deepEqual(JSON.parse(calls.find(c => c.path.endsWith('/deploy')).body), { bundle_id: 'b1' });
	assert.equal(polls, 2);
	assert.deepEqual(calls.map(c => c.method).filter(m => m !== 'GET'), ['POST', 'POST']);
});

test('deploy sends back the cookies Connect sets, so a load balancer keeps the task on one server', async () => {
	const sticky = (body, cookie) => Response.json(body, { headers: [['Set-Cookie', `${cookie}; Path=/; HttpOnly`]] });
	const { fetch, calls } = fakeConnect({
		'GET /__api__/v1/content/c1': () => sticky(CONTENT, 'lb=a'),
		'POST /__api__/v1/content/c1/bundles': { id: 'b1' },
		'POST /__api__/v1/content/c1/deploy': () => sticky({ task_id: 't1' }, 'lb=b'),
		'GET /__api__/v1/tasks/t1?wait=5': init => init.headers.Cookie === 'lb=b' ? { finished: true, code: 0 } : new Response('task not found', { status: 404 }),
	});
	await deploy({ server: SERVER, key: 'k', guid: 'c1', archive: Buffer.from('x'), fetch });
	assert.equal(calls[0].headers.Cookie, undefined);
	assert.equal(calls[1].headers.Cookie, 'lb=a');
});

test('create makes acl content at the vanity path and returns its GUID', async () => {
	const { fetch, calls } = fakeConnect({
		'POST /__api__/v1/content': CONTENT,
		'PUT /__api__/v1/content/c1/vanity': {},
	});
	assert.equal(await create({ server: SERVER, key: 'k', fetch }), 'c1');
	assert.deepEqual(JSON.parse(calls[0].body), { name: 'explore-outcomes', title: '/explore outcomes', access_type: 'acl' });
	assert.deepEqual(JSON.parse(calls[1].body), { path: '/explore-outcomes/' });
});

test('a failed deploy task throws with its error', async () => {
	const { fetch } = fakeConnect({
		'GET /__api__/v1/content/c1': CONTENT,
		'POST /__api__/v1/content/c1/bundles': { id: 'b2' },
		'POST /__api__/v1/content/c1/deploy': { task_id: 't2' },
		'GET /__api__/v1/tasks/t2?wait=5': { finished: true, code: 1, error: 'bad manifest' },
	});
	await assert.rejects(deploy({ server: SERVER, key: 'k', guid: 'c1', archive: Buffer.from('x'), fetch }), /bad manifest/);
});

test('a Connect error names the call that failed', async () => {
	const { fetch } = fakeConnect({});
	await assert.rejects(fetchPrevious({ server: SERVER, key: 'k', guid: 'c1', fetch }), /GET \/__api__\/v1\/content\/c1 failed: 404/);
});
