/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Downloads one artifact from a workflow run over many parallel HTTP range
// requests. actions/download-artifact pulls a single artifact over one
// connection, so one slow connection can stall a multi-GB download for over an
// hour. Here each range retries on its own, so a stalled range costs seconds.
//
// Upload the artifact with `archive: false` so the blob is the file itself.
//
// Usage:
//   node .github/scripts/download-artifact-parallel.mts <artifact-name> <output-file>
//
// Env:
//   GITHUB_TOKEN          token with `actions: read`
//   GITHUB_REPOSITORY     owner/repo (set by Actions)
//   GITHUB_RUN_ID         run that uploaded the artifact (set by Actions)
//   GITHUB_API_URL        defaults to https://api.github.com
//   DOWNLOAD_CONNECTIONS  parallel ranges in flight, default 16

import { createReadStream } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const CHUNK_SIZE = 64 * 1024 * 1024;
const CONNECTIONS = Number(process.env.DOWNLOAD_CONNECTIONS || 16);
const STALL_MS = 30_000;
const MAX_ATTEMPTS = 6;
// The signed blob URL the API redirects to expires after about a minute.
const URL_MAX_AGE_MS = 45_000;
const PROGRESS_INTERVAL_MS = 15_000;

const [name, outFile] = process.argv.slice(2);
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const apiUrl = process.env.GITHUB_API_URL || 'https://api.github.com';

if (!name || !outFile || !token || !repo || !runId) {
	console.error('Usage: download-artifact-parallel.mts <artifact-name> <output-file>');
	console.error('Requires GITHUB_TOKEN, GITHUB_REPOSITORY, and GITHUB_RUN_ID.');
	process.exit(2);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const mb = (bytes: number) => (bytes / 1024 / 1024).toFixed(0);

function api(path: string, init: RequestInit = {}) {
	return fetch(`${apiUrl}/repos/${repo}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			Accept: 'application/vnd.github+json',
			'X-GitHub-Api-Version': '2022-11-28',
		},
	});
}

interface Artifact {
	id: number;
	name: string;
	expired: boolean;
	digest?: string | null;
}

async function findArtifact(): Promise<Artifact> {
	const res = await api(`/actions/runs/${runId}/artifacts?name=${encodeURIComponent(name)}&per_page=100`);
	if (!res.ok) {
		throw new Error(`Listing artifacts failed: HTTP ${res.status} ${await res.text()}`);
	}
	const { artifacts } = await res.json() as { artifacts: Artifact[] };
	const artifact = artifacts.find(a => a.name === name && !a.expired);
	if (!artifact) {
		throw new Error(`No artifact named '${name}' in run ${runId}`);
	}
	return artifact;
}

let blobUrl: string | undefined;
let blobUrlAt = 0;
let blobUrlPending: Promise<string> | undefined;

// Returns the signed blob URL, refreshing it when stale or when forced after a failure.
// Concurrent callers share one refresh.
function getBlobUrl(artifactId: number, force: boolean): Promise<string> {
	if (!force && blobUrl && Date.now() - blobUrlAt < URL_MAX_AGE_MS) {
		return Promise.resolve(blobUrl);
	}
	blobUrlPending ??= (async () => {
		try {
			const res = await api(`/actions/artifacts/${artifactId}/zip`, { redirect: 'manual' });
			const location = res.headers.get('location');
			if (res.status !== 302 || !location) {
				throw new Error(`Expected a redirect to the blob URL, got HTTP ${res.status}`);
			}
			blobUrl = location;
			blobUrlAt = Date.now();
			return blobUrl;
		} finally {
			blobUrlPending = undefined;
		}
	})();
	return blobUrlPending;
}

// Reads the total size from the blob itself rather than trusting the API's size field.
async function getTotalSize(artifactId: number) {
	const res = await fetch(await getBlobUrl(artifactId, false), { headers: { Range: 'bytes=0-0' } });
	await res.body?.cancel();
	const match = /\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
	if (res.status !== 206 || !match) {
		throw new Error(`Blob does not support range requests (HTTP ${res.status})`);
	}
	return Number(match[1]);
}

let downloadedBytes = 0;

async function downloadRange(fh: FileHandle, artifactId: number, start: number, end: number) {
	for (let attempt = 1; ; attempt++) {
		const controller = new AbortController();
		let timer: NodeJS.Timeout | undefined;
		const resetStallTimer = () => {
			clearTimeout(timer);
			timer = setTimeout(() => controller.abort(new Error(`no data for ${STALL_MS / 1000}s`)), STALL_MS);
		};
		let position = start;
		try {
			resetStallTimer();
			const url = await getBlobUrl(artifactId, attempt > 1);
			const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` }, signal: controller.signal });
			if (res.status !== 206) {
				await res.body?.cancel();
				throw new Error(`HTTP ${res.status}`);
			}
			for await (const buf of res.body!) {
				resetStallTimer();
				// write() can write fewer bytes than asked; finish the buffer before moving on.
				for (let off = 0; off < buf.length;) {
					const { bytesWritten } = await fh.write(buf, off, buf.length - off, position);
					off += bytesWritten;
					position += bytesWritten;
					downloadedBytes += bytesWritten;
				}
			}
			if (position !== end + 1) {
				throw new Error(`short read: got ${position - start} of ${end - start + 1} bytes`);
			}
			return;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			downloadedBytes -= position - start;
			if (attempt >= MAX_ATTEMPTS) {
				throw new Error(`Range ${start}-${end} failed after ${attempt} attempts: ${message}`);
			}
			console.log(`Range ${start}-${end} attempt ${attempt} failed (${message}); retrying`);
			await sleep(Math.min(1000 * 2 ** attempt, 15_000));
		} finally {
			clearTimeout(timer);
		}
	}
}

async function sha256(file: string) {
	const hash = createHash('sha256');
	for await (const buf of createReadStream(file, { highWaterMark: 8 * 1024 * 1024 })) {
		hash.update(buf);
	}
	return hash.digest('hex');
}

const started = Date.now();
const artifact = await findArtifact();
const total = await getTotalSize(artifact.id);
console.log(`Downloading '${name}' (ID ${artifact.id}, ${mb(total)} MB) over ${CONNECTIONS} connections`);

const ranges: [number, number][] = [];
for (let start = 0; start < total; start += CHUNK_SIZE) {
	ranges.push([start, Math.min(start + CHUNK_SIZE, total) - 1]);
}

const fh = await open(outFile, 'w');
const progress = setInterval(() => {
	const seconds = (Date.now() - started) / 1000;
	console.log(`${mb(downloadedBytes)} / ${mb(total)} MB (${mb(downloadedBytes / seconds)} MB/s)`);
}, PROGRESS_INTERVAL_MS);
try {
	await fh.truncate(total);
	let next = 0;
	const worker = async () => {
		while (next < ranges.length) {
			const [start, end] = ranges[next++];
			await downloadRange(fh, artifact.id, start, end);
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONNECTIONS, ranges.length) }, worker));
} finally {
	clearInterval(progress);
	await fh.close();
}

const seconds = (Date.now() - started) / 1000;
console.log(`Downloaded ${mb(total)} MB in ${seconds.toFixed(0)}s (${mb(total / seconds)} MB/s)`);

if (artifact.digest) {
	const expected = artifact.digest.replace(/^sha256:/, '');
	const actual = await sha256(outFile);
	if (actual !== expected) {
		throw new Error(`Digest mismatch: expected ${expected}, got ${actual}`);
	}
	console.log(`SHA256 digest verified: ${actual}`);
} else {
	console.log('Artifact has no digest; skipping verification');
}
