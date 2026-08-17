/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Fixture CDN for the llm-docs bundle. Serves the same URL shapes as
// cdn.posit.co so POSITRON_LLMS_DOCS_URL can point here instead.
//
//   node server.mjs [--port 8099]
//
// Scenarios are switched at runtime, so one Positron session can be walked
// through several of them:
//
//   curl localhost:8099/_ctl/scenario/ok
//   curl localhost:8099/_ctl/scenario/digest-mismatch
//   curl localhost:8099/_ctl/log        # what the client has requested
//
// See scenarios below for the full list.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { deflateRawSync } from 'node:zlib';

const port = Number(process.argv[process.argv.indexOf('--port') + 1]) || 8099;

// A version this build will never match, so a release build stays in
// `fallback` rather than accidentally resolving `exact`.
const LATEST_VERSION = '9999.01.0-1';

/** Minimal zip writer: stored-or-deflated entries, no dependencies. */
function makeZip(entries) {
	const chunks = [];
	const central = [];
	let offset = 0;
	const crcTable = [];
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let k = 0; k < 8; k++) { c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; }
		crcTable[i] = c >>> 0;
	}
	const crc32 = buf => {
		let c = 0xFFFFFFFF;
		for (const byte of buf) { c = crcTable[(c ^ byte) & 0xFF] ^ (c >>> 8); }
		return (c ^ 0xFFFFFFFF) >>> 0;
	};

	for (const [name, contents] of Object.entries(entries)) {
		const nameBuf = Buffer.from(name, 'utf8');
		const raw = Buffer.from(contents, 'utf8');
		const deflated = deflateRawSync(raw);
		const useDeflate = deflated.length < raw.length;
		const body = useDeflate ? deflated : raw;
		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4);
		local.writeUInt16LE(useDeflate ? 8 : 0, 8);
		local.writeUInt32LE(crc32(raw), 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(nameBuf.length, 26);
		chunks.push(local, nameBuf, body);

		const dir = Buffer.alloc(46);
		dir.writeUInt32LE(0x02014b50, 0);
		dir.writeUInt16LE(20, 4);
		dir.writeUInt16LE(20, 6);
		dir.writeUInt16LE(useDeflate ? 8 : 0, 10);
		dir.writeUInt32LE(crc32(raw), 16);
		dir.writeUInt32LE(body.length, 20);
		dir.writeUInt32LE(raw.length, 24);
		dir.writeUInt16LE(nameBuf.length, 28);
		dir.writeUInt32LE(offset, 42);
		central.push(dir, nameBuf);
		offset += local.length + nameBuf.length + body.length;
	}

	const centralBuf = Buffer.concat(central);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(Object.keys(entries).length, 8);
	end.writeUInt16LE(Object.keys(entries).length, 10);
	end.writeUInt32LE(centralBuf.length, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...chunks, centralBuf, end]);
}

// Bundles are built once and reused. The zip and its checksum arrive as two
// separate requests, so anything that varies per call (a timestamp, say) makes
// every install fail a digest check that is actually working correctly.
const bundleCache = new Map();

/** A structurally valid bundle. fileCount must match what the zip holds. */
function makeBundle(version, options = {}) {
	const key = `${version}|${options.fileCount ?? ''}|${options.extraPages ?? ''}`;
	let zip = bundleCache.get(key);
	if (!zip) {
		zip = buildBundle(version, options);
		bundleCache.set(key, zip);
	}
	return zip;
}

function buildBundle(version, { fileCount, extraPages = 0 } = {}) {
	const entries = {
		'llms.txt': `# Positron docs (fixture ${version})\n\n- [Console](console.md)\n`,
		'console.md': `# Console\n\nFixture page from bundle ${version}.\n`,
	};
	for (let i = 0; i < extraPages; i++) {
		entries[`page-${i}.md`] = `# Page ${i}\n`;
	}
	const declared = fileCount ?? Object.keys(entries).length + 1; // +1 for bundle.json
	entries['bundle.json'] = JSON.stringify({
		schema: 1,
		profile: 'positron',
		version,
		// Fixed, not `new Date()`: see the bundleCache note above.
		generated: '2026-08-01T00:00:00Z',
		docsBaseUrl: 'https://positron.posit.co/',
		fileCount: declared,
	}, null, 2);
	return makeZip(entries);
}

const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// Each scenario decides how the latest zip, its checksum, and the exact
// version are served. `exact` responses are what a release build HEADs first.
//
// `expect` is served over /_ctl/scenarios and shown by the extension's "Run
// Scenario" command, so it stays next to the behaviour it describes.
const scenarios = {
	/** Happy path: latest publishes, exact does not. */
	'ok': { expect: `installs ${LATEST_VERSION}, isExactMatch: false` },
	/** Nothing published at all. */
	'bundle-404': { zip: 404, expect: 'undefined, no version directory' },
	/** Zip published, checksum missing. */
	'checksum-404': { checksum: 404, expect: 'zip fetched, install refused, undefined' },
	/** Checksum names a digest the zip does not have. */
	'digest-mismatch': { digest: 'mismatch', expect: 'rejected, "digest mismatch" logged' },
	/** Checksum body is not a digest at all. */
	'checksum-garbage': { digest: 'garbage', expect: 'rejected, "does not hold a sha256 digest"' },
	/** Truncated zip. */
	'corrupt-zip': { corrupt: true, expect: 'rejected, "corrupt archive"' },
	/** Manifest declares more files than the zip holds. */
	'file-count-mismatch': { fileCount: 99, expect: 'rejected, "file-count-mismatch"' },
	/** Manifest version escapes the cache root. */
	'evil-version': { version: '../../evil', expect: 'rejected at manifest parse; nothing written outside the root' },
	/** Slower than the 10s bounded wait. */
	'slow': { delayMs: 20_000, expect: 'undefined at ~10s, download continues, next call served' },
	/** Exact version is published too. Release-quality builds only. */
	'exact-published': { exactPublished: true, expect: 'only meaningful on a faked release build - see the README' },
	/** Bigger than the 25MB cap. */
	'oversize': { oversize: true, expect: 'aborted, "exceeds 26214400 bytes"' },
	/** Checksum body over the 8KB cap. */
	'oversize-checksum': { oversizeChecksum: true, expect: 'aborted, "exceeds 8192 bytes"' },
};

let current = 'ok';
let etagCounter = 1;
const log = [];

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://localhost:${port}`);
	const path = url.pathname;

	if (path.startsWith('/_ctl/scenario/')) {
		const next = path.slice('/_ctl/scenario/'.length);
		if (!scenarios[next]) {
			res.writeHead(400).end(`unknown scenario. try: ${Object.keys(scenarios).join(', ')}\n`);
			return;
		}
		current = next;
		// A new scenario is a new object, so the ETag must change or a client
		// holding the old one gets a 304 and never sees the new body.
		etagCounter++;
		res.writeHead(200).end(`scenario = ${current}\n`);
		return;
	}
	if (path === '/_ctl/scenarios') {
		// JSON so the extension can build its picker without duplicating the list.
		const body = Object.entries(scenarios).map(([name, s]) => ({ name, expect: s.expect, current: name === current }));
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
		return;
	}
	if (path === '/_ctl/log') {
		res.writeHead(200).end(log.join('\n') + '\n');
		return;
	}
	if (path === '/_ctl/reset') {
		log.length = 0;
		res.writeHead(200).end('log cleared\n');
		return;
	}

	const s = scenarios[current];
	const line = `${new Date().toISOString().slice(11, 23)}  ${req.method} ${path}${req.headers['if-none-match'] ? `  If-None-Match: ${req.headers['if-none-match']}` : ''}`;
	log.push(line);
	console.log(`[${current}] ${line}`);

	const isChecksum = path.endsWith('.sha256sum');
	const zipPath = isChecksum ? path.slice(0, -'.sha256sum'.length) : path;
	const match = /^\/positron-(?:workbench-)?llms-(.+)\.zip$/.exec(zipPath);
	if (!match) {
		res.writeHead(404).end();
		return;
	}
	const requested = match[1];
	const isLatest = requested === 'latest';

	// An exact request only succeeds in the scenario that publishes it.
	if (!isLatest && !s.exactPublished) {
		res.writeHead(404).end();
		return;
	}

	if (s.delayMs) {
		await new Promise(resolve => setTimeout(resolve, s.delayMs));
	}

	const version = s.version ?? (isLatest ? LATEST_VERSION : requested);
	const zip = s.oversize
		? Buffer.alloc(26 * 1024 * 1024, 0x41)
		: makeBundle(version, { fileCount: s.fileCount });
	const body = s.corrupt ? zip.subarray(0, Math.floor(zip.length / 2)) : zip;
	const etag = `"fixture-${current}-${etagCounter}"`;

	if (isChecksum) {
		if (s.checksum === 404) {
			res.writeHead(404).end();
			return;
		}
		if (s.oversizeChecksum) {
			res.writeHead(200, { 'content-type': 'text/plain' }).end('x'.repeat(9 * 1024));
			return;
		}
		const digest = s.digest === 'mismatch' ? 'b'.repeat(64)
			: s.digest === 'garbage' ? 'not-a-digest-at-all'
				: sha256(body);
		res.writeHead(200, { 'content-type': 'text/plain' }).end(`${digest}  positron-llms-${requested}.zip\n`);
		return;
	}

	if (s.zip === 404) {
		res.writeHead(404).end();
		return;
	}

	// Conditional GET support, so the 304 path is exercisable.
	if (req.headers['if-none-match'] === etag) {
		res.writeHead(304, { etag }).end();
		return;
	}
	if (req.method === 'HEAD') {
		res.writeHead(200, { etag, 'content-length': String(body.length) }).end();
		return;
	}
	res.writeHead(200, { etag, 'content-type': 'application/zip', 'content-length': String(body.length) }).end(body);
});

server.listen(port, '127.0.0.1', () => {
	console.log(`docs fixture CDN on http://127.0.0.1:${port}  (scenario: ${current})`);
	console.log(`scenarios: ${Object.keys(scenarios).join(', ')}`);
});
