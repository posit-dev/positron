/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Publishes the outcomes page to Posit Connect, with the rows beside it so the
// next run can start from them. The content is made once, by hand, and belongs
// to whoever made it; CI only deploys to its GUID, so its key's user must own
// the content or be a collaborator on it.
//   node outcomes-publish.mjs create            (once; prints the GUID)
//   node outcomes-publish.mjs previous > previous.jsonl
//   node outcomes-publish.mjs deploy index.html rows.jsonl
// Needs CONNECT_API_KEY, and CONNECT_CONTENT_GUID for previous and deploy.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'explore-outcomes';
const TITLE = '/explore outcomes';
const VANITY = '/explore-outcomes/';

/** The manifest for a static bundle of `files` (`{ name: content }`), opening on index.html. */
export function buildManifest(files) {
	const sums = Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { checksum: createHash('md5').update(content).digest('hex') }]));
	return { version: 1, metadata: { appmode: 'static', primary_html: 'index.html' }, files: sums };
}

/** `files` and their manifest as a tar.gz, all at the top. */
export function bundle(files) {
	const dir = mkdtempSync(join(tmpdir(), 'outcomes-bundle-'));
	try {
		const all = { ...files, 'manifest.json': JSON.stringify(buildManifest(files), null, 2) };
		for (const [name, content] of Object.entries(all)) {
			writeFileSync(join(dir, name), content);
		}
		execFileSync('tar', ['-czf', 'bundle.tar.gz', ...Object.keys(all)], { cwd: dir });
		return readFileSync(join(dir, 'bundle.tar.gz'));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function client({ server, key, fetch }) {
	// Connect's load balancer is sticky by cookie; without it a task can be polled on a server that doesn't have it.
	const cookies = new Map();
	return async (method, path, { body, type = 'application/json', raw = false } = {}) => {
		const url = path.startsWith('http') ? path : `${server}${path}`;
		const cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
		const res = await fetch(url, { method, headers: { Authorization: `Key ${key}`, ...(body ? { 'Content-Type': type } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body });
		for (const c of res.headers.getSetCookie()) {
			const [, k, v] = c.match(/^([^=;\s]+)=([^;]*)/) ?? [];
			if (k) {
				cookies.set(k, v);
			}
		}
		if (!res.ok) {
			throw new Error(`Connect ${method} ${url.replace(server, '')} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
		}
		return raw ? res : res.json();
	};
}

/** Makes the content, open only to its owner until others are added; returns its GUID. */
export async function create({ server, key, name = NAME, title = TITLE, vanity = VANITY, fetch = globalThis.fetch }) {
	const call = client({ server, key, fetch });
	const content = await call('POST', '/__api__/v1/content', { body: JSON.stringify({ name, title, access_type: 'acl' }) });
	await call('PUT', `/__api__/v1/content/${content.guid}/vanity`, { body: JSON.stringify({ path: vanity }) });
	return content.guid;
}

/** The rows the last deploy published, or '' before the first. */
export async function fetchPrevious({ server, key, guid, fetch = globalThis.fetch }) {
	const call = client({ server, key, fetch });
	const content = await call('GET', `/__api__/v1/content/${guid}`);
	try {
		return await (await call('GET', `${content.content_url}rows.jsonl`, { raw: true })).text();
	} catch {
		// Deployed, but not with rows yet.
		return '';
	}
}

/** Deploys `archive` to the content; returns its URL once the deploy task ends, or throws after `timeout` ms. */
export async function deploy({ server, key, guid, archive, fetch = globalThis.fetch, wait = 5, timeout = 30 * 60_000 }) {
	const call = client({ server, key, fetch });
	const content = await call('GET', `/__api__/v1/content/${guid}`);
	const { id } = await call('POST', `/__api__/v1/content/${guid}/bundles`, { body: archive, type: 'application/gzip' });
	const { task_id: task } = await call('POST', `/__api__/v1/content/${guid}/deploy`, { body: JSON.stringify({ bundle_id: id }) });
	const deadline = Date.now() + timeout;
	for (; ;) {
		const status = await call('GET', `/__api__/v1/tasks/${task}?wait=${wait}`);
		if (status.finished) {
			if (status.code !== 0) {
				throw new Error(`Connect deploy failed: ${status.error || `code ${status.code}`}`);
			}
			return content.content_url;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Connect deploy task ${task} did not finish in ${timeout / 60_000} minutes`);
		}
	}
}

async function main() {
	const [command, ...paths] = process.argv.slice(2);
	const key = process.env.CONNECT_API_KEY;
	if (!key) {
		throw new Error('CONNECT_API_KEY is not set');
	}
	const server = process.env.CONNECT_SERVER || 'https://connect.posit.it';
	if (command === 'create') {
		console.log(await create({ server, key }));
		return;
	}
	const guid = process.env.CONNECT_CONTENT_GUID;
	if (!guid) {
		throw new Error('CONNECT_CONTENT_GUID is not set; make the content once with `create`');
	}
	if (command === 'previous') {
		process.stdout.write(await fetchPrevious({ server, key, guid }));
	} else if (command === 'deploy') {
		const files = Object.fromEntries(paths.map(p => [basename(p), readFileSync(p)]));
		console.log(`[outcomes] published ${await deploy({ server, key, guid, archive: bundle(files) })}`);
	} else {
		throw new Error('usage: outcomes-publish.mjs create | previous | deploy <file>...');
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
