/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Makes sure `resources/sql-analyzer.wasm` is the SQL analyzer rather than a Git LFS pointer to it.
 *
 * The module is stored in Git LFS (see `.gitattributes`), which keeps each rebuild out of the
 * history every clone downloads. A checkout made with git-lfs installed already has the module and
 * this does nothing. One made without it -- a machine that never installed git-lfs, a CI image
 * that does not ship it -- has a pointer, which this replaces:
 *
 * - With git-lfs installed, by `git lfs pull`, so the file is what git expects and the working
 *   tree stays clean.
 * - Without it, by asking the repository's LFS server for the object directly and checking it
 *   against the SHA-256 the pointer names. Git would then see the module where it expects the
 *   pointer and report the file changed, so it is marked `--assume-unchanged`; a checkout that
 *   changes the pointer still overwrites it, and the next install fetches the new module.
 *
 * Run by the root postinstall on every `npm install`, and by CI when a cached `node_modules`
 * means no install runs. Fails when the module cannot be had, since the extension cannot work
 * without it.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extensionDir, git, hasGitLfs, type LfsPointer, modulePath, moduleRepoPath, readPointer } from './lfs.mts';

/** Where the module is fetched from when git cannot fetch it: this repository's LFS server. */
const UPSTREAM = 'https://github.com/posit-dev/positron.git';

function log(message: string): void {
	console.log(`[positron-sql] ${message}`);
}

/**
 * The HTTPS URL of the checkout's `origin`, so a fork's LFS objects are fetched from the fork,
 * then the upstream repository's.
 */
function servers(): string[] {
	const origin = git(['remote', 'get-url', 'origin'])?.toString().trim();
	const https = origin
		?.replace(/^git@github\.com:/, 'https://github.com/')
		.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
	const candidates = https?.startsWith('https://') ? [https, UPSTREAM] : [UPSTREAM];
	return [...new Set(candidates.map(url => url.endsWith('.git') ? url : `${url}.git`))];
}

/**
 * The credentials to send, if any. The repository is public, so none are needed; CI passes its
 * token anyway, which keeps a busy runner clear of the anonymous rate limit.
 */
function authorization(): Record<string, string> {
	const token = process.env.POSITRON_GITHUB_RO_PAT ?? process.env.GITHUB_TOKEN;
	return token
		? { Authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}` }
		: {};
}

/**
 * Downloads an object through the Git LFS batch API, and returns it once it matches the pointer.
 * See https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md.
 */
async function download(server: string, pointer: LfsPointer): Promise<Buffer> {
	const response = await fetch(`${server}/info/lfs/objects/batch`, {
		method: 'POST',
		headers: {
			'Accept': 'application/vnd.git-lfs+json',
			'Content-Type': 'application/vnd.git-lfs+json',
			...authorization(),
		},
		body: JSON.stringify({
			operation: 'download',
			transfers: ['basic'],
			objects: [{ oid: pointer.oid, size: pointer.size }],
		}),
	});
	if (!response.ok) {
		throw new Error(`${server} answered the LFS batch request with HTTP ${response.status}`);
	}
	const batch = await response.json() as {
		objects?: { error?: { message: string }; actions?: { download?: { href: string; header?: Record<string, string> } } }[];
	};
	const object = batch.objects?.[0];
	const action = object?.actions?.download;
	if (!action) {
		throw new Error(`${server} has no download for the module: ${object?.error?.message ?? 'no action given'}`);
	}

	const content = await fetch(action.href, { headers: action.header ?? {} });
	if (!content.ok) {
		throw new Error(`downloading the module from ${server} failed with HTTP ${content.status}`);
	}
	const bytes = Buffer.from(await content.arrayBuffer());
	const oid = crypto.createHash('sha256').update(bytes).digest('hex');
	if (bytes.length !== pointer.size || oid !== pointer.oid) {
		throw new Error(`the module downloaded from ${server} is not the one the pointer names`);
	}
	return bytes;
}

async function main(): Promise<void> {
	const pointer = readPointer(modulePath);
	if (!pointer) {
		return;
	}

	if (hasGitLfs()) {
		const root = git(['rev-parse', '--show-toplevel'])?.toString().trim();
		if (root && git(['-C', root, 'lfs', 'pull', `--include=${moduleRepoPath}`]) && !readPointer(modulePath)) {
			log('Fetched the SQL analyzer with git-lfs.');
			return;
		}
	}

	const failures: string[] = [];
	for (const server of servers()) {
		try {
			const bytes = await download(server, pointer);
			// Written beside the pointer and moved over it, so an interrupted install leaves the
			// pointer rather than half a module.
			const partial = `${modulePath}.partial`;
			fs.writeFileSync(partial, bytes);
			fs.renameSync(partial, modulePath);
			git(['update-index', '--assume-unchanged', '--', path.relative(extensionDir, modulePath)]);
			log(`Fetched the SQL analyzer from ${server} (${(bytes.length / 1024).toFixed(0)} KB).`);
			return;
		} catch (error) {
			failures.push(String(error instanceof Error ? error.message : error));
		}
	}
	throw new Error(`Could not fetch the SQL analyzer, which is stored in Git LFS:\n  ${failures.join('\n  ')}\n`
		+ 'Install git-lfs (https://git-lfs.com) and run `git lfs pull`, or re-run the install with network access.');
}

try {
	await main();
} catch (error) {
	console.error(`[positron-sql] ${error instanceof Error ? error.message : error}`);
	process.exit(1);
}
