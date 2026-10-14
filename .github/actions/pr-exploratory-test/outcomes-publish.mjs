/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Publishes the outcomes page to Posit Connect as static content only its
// owner can open, with the rows beside it so the next run can start from them.
//   node outcomes-publish.mjs previous > previous.jsonl
//   node outcomes-publish.mjs deploy index.html rows.jsonl
// Needs CONNECT_API_KEY; the content belongs to the key's owner.

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
	const call = async (method, path, { body, type = 'application/json', raw = false } = {}) => {
		const url = path.startsWith('http') ? path : `${server}${path}`;
		const res = await fetch(url, { method, headers: { Authorization: `Key ${key}`, ...(body ? { 'Content-Type': type } : {}) }, body });
		if (!res.ok) {
			throw new Error(`Connect ${method} ${url.replace(server, '')} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
		}
		return raw ? res : res.json();
	};
	return {
		call,
		/** The content named `name` that the key's owner owns, or null. */
		async find(name) {
			const me = await call('GET', '/__api__/v1/user');
			const found = await call('GET', `/__api__/v1/content?name=${encodeURIComponent(name)}&owner_guid=${me.guid}`);
			return found[0] ?? null;
		},
	};
}

/** The rows the last deploy published, or '' before the first. */
export async function fetchPrevious({ server, key, name = NAME, fetch = globalThis.fetch }) {
	const c = client({ server, key, fetch });
	const content = await c.find(name);
	if (!content) {
		return '';
	}
	try {
		return await (await c.call('GET', `${content.content_url}rows.jsonl`, { raw: true })).text();
	} catch {
		// Deployed, but not with rows yet.
		return '';
	}
}

/** Deploys `archive`, creating the content on the first run; returns its URL once the deploy task ends. */
export async function deploy({ server, key, name = NAME, title = TITLE, vanity = VANITY, archive, fetch = globalThis.fetch, wait = 5 }) {
	const c = client({ server, key, fetch });
	let content = await c.find(name);
	if (!content) {
		// acl with no one added: only the owner can open it until someone is added in Connect.
		content = await c.call('POST', '/__api__/v1/content', { body: JSON.stringify({ name, title, access_type: 'acl' }) });
		await c.call('PUT', `/__api__/v1/content/${content.guid}/vanity`, { body: JSON.stringify({ path: vanity }) });
	}
	const { id } = await c.call('POST', `/__api__/v1/content/${content.guid}/bundles`, { body: archive, type: 'application/gzip' });
	const { task_id: task } = await c.call('POST', `/__api__/v1/content/${content.guid}/deploy`, { body: JSON.stringify({ bundle_id: id }) });
	for (; ;) {
		const status = await c.call('GET', `/__api__/v1/tasks/${task}?wait=${wait}`);
		if (status.finished) {
			if (status.code !== 0) {
				throw new Error(`Connect deploy failed: ${status.error || `code ${status.code}`}`);
			}
			return content.content_url;
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
	if (command === 'previous') {
		process.stdout.write(await fetchPrevious({ server, key }));
	} else if (command === 'deploy') {
		const files = Object.fromEntries(paths.map(p => [basename(p), readFileSync(p)]));
		console.log(`[outcomes] published ${await deploy({ server, key, archive: bundle(files) })}`);
	} else {
		throw new Error('usage: outcomes-publish.mjs previous | deploy <file>...');
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
