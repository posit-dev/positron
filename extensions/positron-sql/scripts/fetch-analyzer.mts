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
 *   pointer and report the file changed, and refuse a checkout that changes the pointer, so the
 *   checkout is given `lfs-clean.mts` as its LFS clean filter, which reads the module as its
 *   pointer. A checkout that changes the pointer then replaces it, and the next install fetches the
 *   new module.
 *
 * A module fetched either way is kept in `.build/sql-analyzer/`, named by its SHA-256, and taken
 * from there the next time the pointer names it. CI caches that directory, so its jobs do not each
 * spend the repository's LFS bandwidth on the same object.
 *
 * Run by the root postinstall on every `npm install`, and by CI when a cached `node_modules`
 * means no install runs. Exits non-zero when the module cannot be had, which the postinstall reports
 * as a warning, so an install without network access still completes.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { extensionDir, git, hasGitLfs, type LfsPointer, modulePath, moduleRepoPath, readPointer } from './lfs.mts';

/** Where fetched modules are kept, each named by its SHA-256. CI caches it; see the comment above. */
const CACHE = path.join(extensionDir, '..', '..', '.build', 'sql-analyzer');

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
	if (!matches(bytes, pointer)) {
		throw new Error(`the module downloaded from ${server} is not the one the pointer names`);
	}
	return bytes;
}

/** Whether `bytes` are the object the pointer names. */
function matches(bytes: Buffer, pointer: LfsPointer): boolean {
	return bytes.length === pointer.size
		&& crypto.createHash('sha256').update(bytes).digest('hex') === pointer.oid;
}

/** The module the pointer names, if an earlier fetch kept it. */
function cached(pointer: LfsPointer): Buffer | undefined {
	try {
		const bytes = fs.readFileSync(path.join(CACHE, pointer.oid));
		return matches(bytes, pointer) ? bytes : undefined;
	} catch {
		return undefined;
	}
}

/** Keeps a fetched module for the next install. Best effort: failing to keep it costs a download. */
function keep(bytes: Buffer, pointer: LfsPointer): void {
	try {
		fs.mkdirSync(CACHE, { recursive: true });
		fs.writeFileSync(path.join(CACHE, pointer.oid), bytes);
	} catch {
		// Fetched again next time.
	}
}

/**
 * Puts the module in place of the pointer. Written beside the pointer and moved over it, so an
 * interrupted install leaves the pointer rather than half a module. Without git-lfs, git would then
 * see the module where it expects the pointer, so the checkout's clean filter is set to read it as
 * the pointer (git runs filters from the top of the working tree, hence the path from there). The
 * index entry is then refreshed through it: git takes a file whose size differs from the one it
 * recorded as changed without filtering it, and the size it recorded is the pointer's.
 */
function install(bytes: Buffer): void {
	const partial = `${modulePath}.partial`;
	fs.writeFileSync(partial, bytes);
	fs.renameSync(partial, modulePath);
	if (!hasGitLfs()) {
		git(['config', 'filter.lfs.clean', 'node extensions/positron-sql/scripts/lfs-clean.mts']);
		git(['update-index', '--', path.relative(extensionDir, modulePath)]);
	}
}

async function main(): Promise<void> {
	const pointer = readPointer(modulePath);
	if (!pointer) {
		return;
	}

	const kept = cached(pointer);
	if (kept) {
		install(kept);
		log('Restored the SQL analyzer from .build/sql-analyzer.');
		return;
	}

	if (hasGitLfs()) {
		const root = git(['rev-parse', '--show-toplevel'])?.toString().trim();
		if (root && git(['-C', root, 'lfs', 'pull', `--include=${moduleRepoPath}`]) && !readPointer(modulePath)) {
			keep(fs.readFileSync(modulePath), pointer);
			log('Fetched the SQL analyzer with git-lfs.');
			return;
		}
	}

	const failures: string[] = [];
	for (const server of servers()) {
		try {
			const bytes = await download(server, pointer);
			install(bytes);
			keep(bytes, pointer);
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
