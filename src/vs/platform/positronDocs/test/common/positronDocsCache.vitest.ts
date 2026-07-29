/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { DocsProfile, IDocsBundleRequest } from '../../common/positronDocsBundle.js';
import { PositronDocsCache } from '../../common/positronDocsCache.js';
import { fakeDigest, fakeZip, FakeArchive, FakeFileStore, FakeHttpClient, recordingLogger } from './fakes.js';

const ROOT = '/userdata/User/positron-docs';
const BASE = 'https://cdn.posit.co/positron/releases/docs';
const EXACT_ZIP = `${BASE}/positron-llms-2026.05.0-179.zip`;
const LATEST_ZIP = `${BASE}/positron-llms-latest.zip`;

/** A fake-zip payload whose manifest declares the three files it contains. */
function payload(version: string): string {
	return fakeZip({
		'bundle.json': JSON.stringify({
			schema: 1, profile: 'positron', version,
			generated: '2026-07-24T18:02:11Z',
			docsBaseUrl: 'https://positron.posit.co/', fileCount: 3,
		}),
		'llms.txt': '# Positron\n\n- [Welcome](welcome.llms.md)\n',
		'welcome.llms.md': '# Welcome\n',
	});
}

function request(overrides: Partial<IDocsBundleRequest> = {}): IDocsBundleRequest {
	return {
		quality: 'releases',
		positronVersion: '2026.05.0',
		positronBuildNumber: 179,
		profile: 'positron' as DocsProfile,
		baseUrl: BASE,
		...overrides,
	};
}

function setup() {
	const files = new FakeFileStore();
	const http = new FakeHttpClient();
	const archive = new FakeArchive(files);
	const logger = recordingLogger();
	let clock = 1_000_000;
	let ids = 0;
	const cache = new PositronDocsCache({
		rootPath: ROOT, http, files, archive, logger,
		now: () => clock,
		newId: () => `id${++ids}`,
	});
	return {
		cache, files, http, archive, logger,
		advance: (ms: number) => { clock += ms; },
		/** Serve `zipUrl` with a matching, correctly-formatted sidecar. */
		publish: (zipUrl: string, body: string, etag?: string) => {
			http.route(zipUrl, { status: 200, body, etag });
			http.route(`${zipUrl}.sha256sum`, { status: 200, body: `${fakeDigest(body)}  bundle.zip\n` });
		},
	};
}

describe('PositronDocsCache: cold cache install', () => {
	it('downloads, verifies, extracts, and swaps in a release build bundle', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const docs = await ctx.cache.ensure(request());

		expect(docs).toMatchInlineSnapshot(`
			{
			  "docsBaseUrl": "https://positron.posit.co/",
			  "isExactMatch": true,
			  "path": "/userdata/User/positron-docs/2026.05.0-179",
			  "profile": "positron",
			  "schema": 1,
			  "version": "2026.05.0-179",
			}
		`);
	});

	it('records state naming the installed version', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		const state = JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`));
		expect({
			version: state.version, requestedVersion: state.requestedVersion,
			resolution: state.resolution, profile: state.profile, sourceUrl: state.sourceUrl,
		}).toMatchInlineSnapshot(`
			{
			  "profile": "positron",
			  "requestedVersion": "2026.05.0-179",
			  "resolution": "exact",
			  "sourceUrl": "https://cdn.posit.co/positron/releases/docs/positron-llms-2026.05.0-179.zip",
			  "version": "2026.05.0-179",
			}
		`);
	});

	it('leaves no temp or staging entries behind', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		expect(ctx.files.listUnder(ROOT).filter(p => p.includes('/.'))).toEqual([]);
	});

	it('fetches the latest alias for a dailies build', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));

		expect(await ctx.cache.ensure(request({ quality: 'dailies' }))).toBeDefined();
		expect(ctx.http.getCalls).toContain(LATEST_ZIP);
		expect(ctx.http.getCalls).not.toContain(EXACT_ZIP);
	});
});

describe('PositronDocsCache: warm exact cache', () => {
	it('serves the cache without touching the network', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());
		const callsAfterInstall = ctx.http.getCalls.length;

		const docs = await ctx.cache.ensure(request());

		expect(docs?.isExactMatch).toBe(true);
		// Release builds are network-free once exactly matched. This is the
		// whole point of version-stamping the cache directory.
		expect(ctx.http.getCalls.length).toBe(callsAfterInstall);
		expect(ctx.http.headCalls).toEqual([]);
	});
});

describe('PositronDocsCache: download rejections on a cold cache', () => {
	// Each of these must leave no version directory behind and return
	// undefined, so the assistant falls back to the web exactly as it does
	// today. Task 6 asserts the same failures against a warm cache.
	async function expectRejected(configure: (ctx: ReturnType<typeof setup>) => void) {
		const ctx = setup();
		configure(ctx);
		const docs = await ctx.cache.ensure(request());
		expect(docs).toBeUndefined();
		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179`)).toBe(false);
		expect(ctx.files.listUnder(ROOT).filter(p => p.includes('/.tmp-') || p.includes('/.staging-'))).toEqual([]);
		return ctx;
	}

	it('rejects when the digest sidecar 404s', async () => {
		const ctx = await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 404 });
		});
		expect(ctx.logger.warns.join('\n')).toContain('digest sidecar');
	});

	it('rejects when the sidecar is unparseable', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: '<!DOCTYPE html><html>404</html>' });
		});
	});

	it('rejects when the digest does not match the zip', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'b'.repeat(64)}  bundle.zip` });
		});
	});

	it('rejects a corrupt archive', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, 'not-a-zip-at-all');
		});
	});

	it('rejects an archive entry that escapes the target', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({ 'llms.txt': 'x', '../../evil.sh': 'rm -rf /' }));
		});
	});

	it('rejects a bundle whose schema is not 1', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 2, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 2 }),
				'llms.txt': '# Positron\n',
			}));
		});
	});

	it('rejects a bundle whose fileCount does not match', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 1, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 99 }),
				'llms.txt': '# Positron\n',
			}));
		});
	});

	it('aborts a download that exceeds the 5MB cap', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179'), byteLength: 6 * 1024 * 1024 });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'c'.repeat(64)}  x` });
		});
	});

	it('returns undefined on a network failure', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 0, throws: 'getaddrinfo ENOTFOUND cdn.posit.co' });
		});
	});

	it('returns undefined on a 5xx', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 503 });
		});
	});

	it('returns undefined on a disk write error', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, payload('2026.05.0-179'));
			c.files.failWritesUnder = ROOT;
		});
	});

	it('never notifies: nothing is logged at a level above warn', async () => {
		const ctx = await expectRejected(c => { c.http.route(EXACT_ZIP, { status: 503 }); });
		// The logger port has no error level on purpose - a docs download
		// failing is not worth interrupting anyone over.
		expect(Object.keys(ctx.logger)).not.toContain('error');
	});
});
