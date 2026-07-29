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
	// A fresh cache over the same fakes stands in for a new session: it
	// re-reads state.json from the shared file store, exactly as a relaunch
	// would. Tests that model "the next launch" must use this rather than
	// calling ensure() twice on one instance.
	const makeCache = () => new PositronDocsCache({
		rootPath: ROOT, http, files, archive, logger,
		now: () => clock,
		newId: () => `id${++ids}`,
	});
	const cache = makeCache();
	return {
		cache, makeCache, files, http, archive, logger,
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
		const getsAfterInstall = ctx.http.getCalls.length;
		const headsAfterInstall = ctx.http.headCalls.length;

		const docs = await ctx.makeCache().ensure(request());

		expect(docs?.isExactMatch).toBe(true);
		// Release builds are network-free once exactly matched. This is the
		// whole point of version-stamping the cache directory. Counted as a
		// delta rather than an absolute: the install itself HEADs the exact URL,
		// so what matters is that the next launch adds nothing.
		expect(ctx.http.getCalls.length).toBe(getsAfterInstall);
		expect(ctx.http.headCalls.length).toBe(headsAfterInstall);
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

describe('PositronDocsCache: convergence', () => {
	it('serves the fallback bundle first, then converges to exact', async () => {
		const ctx = setup();
		// Exact is not published yet; latest holds an older release's docs.
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.http.route(`${EXACT_ZIP}.sha256sum`, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');

		// Intermediate state matters: a test that checked only the end state
		// would pass even if the fallback never worked.
		const first = await ctx.cache.ensure(request());
		expect(first?.version).toBe('2026.04.0-100');
		expect(first?.isExactMatch).toBe(false);
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).resolution).toBe('fallback');

		// The release's docs publish. The next launch converges.
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const second = await ctx.makeCache().ensure(request());
		expect(second?.version).toBe('2026.05.0-179');
		expect(second?.isExactMatch).toBe(true);
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).resolution).toBe('exact');
	});

	it('keeps the cached bundle when latest answers 304', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());
		const before = ctx.files.listUnder(ROOT);

		const second = await ctx.makeCache().ensure(request());

		expect(second?.version).toBe('2026.04.0-100');
		expect(ctx.files.listUnder(ROOT)).toEqual(before);
		expect(ctx.logger.infos.join('\n')).toContain('unchanged (304)');
	});

	it('replaces the cached bundle when latest moves', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		const second = await ctx.makeCache().ensure(request());

		expect(second?.version).toBe('2026.05.0-179');
	});

	it('re-enters fallback when the app updates past the cached bundle', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		const first = await ctx.cache.ensure(request());
		expect(first?.isExactMatch).toBe(true);

		// The user updates to a release whose docs have not published yet.
		const updated = request({ positronVersion: '2026.06.0', positronBuildNumber: 42 });
		ctx.http.route(`${BASE}/positron-llms-2026.06.0-42.zip`, { status: 404 });
		ctx.http.route(LATEST_ZIP, { status: 404 });

		const second = await ctx.makeCache().ensure(updated);

		// Local docs never silently regress to web-only because of an update.
		expect(second?.version).toBe('2026.05.0-179');
		expect(second?.isExactMatch).toBe(false);
	});

	it('never HEADs the exact URL on a dailies build', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request({ quality: 'dailies' }));
		expect(ctx.http.headCalls).toEqual([]);
	});

	it('HEADs the exact URL again on the very next launch while in fallback', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());
		await ctx.makeCache().ensure(request());

		// The 404 convergence check is deliberately never throttled.
		expect(ctx.http.headCalls.filter(url => url === EXACT_ZIP)).toHaveLength(2);
	});
});

describe('PositronDocsCache: cache-present rule', () => {
	/** Install a good bundle, then break the next launch's fetch. */
	async function withWarmCache(breakIt: (ctx: ReturnType<typeof setup>) => void) {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		const first = await ctx.cache.ensure(request({ quality: 'dailies' }));
		expect(first?.version).toBe('2026.04.0-100');

		breakIt(ctx);
		return { ctx, second: await ctx.makeCache().ensure(request({ quality: 'dailies' })) };
	}

	// This is the finding that broke the first draft of the design, so every
	// failure kind gets explicit coverage rather than one representative case.
	it.each([
		['network failure', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 0, throws: 'ENOTFOUND' })],
		['5xx', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 503 })],
		['404 on latest', (c: ReturnType<typeof setup>) => c.http.route(LATEST_ZIP, { status: 404 })],
		['corrupt zip', (c: ReturnType<typeof setup>) => c.publish(LATEST_ZIP, 'not-a-zip')],
		['schema 2', (c: ReturnType<typeof setup>) => c.publish(LATEST_ZIP, fakeZip({
			'bundle.json': JSON.stringify({ schema: 2, profile: 'positron', version: 'v', generated: 'g', docsBaseUrl: 'd', fileCount: 2 }),
			'llms.txt': 'x',
		}))],
		['digest mismatch', (c: ReturnType<typeof setup>) => {
			c.http.route(LATEST_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${LATEST_ZIP}.sha256sum`, { status: 200, body: `${'d'.repeat(64)}  x` });
		}],
		['missing sidecar', (c: ReturnType<typeof setup>) => {
			c.http.route(LATEST_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${LATEST_ZIP}.sha256sum`, { status: 404 });
		}],
		['disk error', (c: ReturnType<typeof setup>) => {
			c.publish(LATEST_ZIP, payload('2026.05.0-179'));
			c.files.failWritesUnder = ROOT;
		}],
	])('still serves the warm cache after %s', async (_label, breakIt) => {
		const { ctx, second } = await withWarmCache(breakIt);

		expect(second?.version).toBe('2026.04.0-100');
		// The previously installed directory survives untouched.
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100/llms.txt`)).toBe(true);
	});
});

describe('PositronDocsCache: single flight', () => {
	it('joins two concurrent calls into one download', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const [a, b] = await Promise.all([ctx.cache.ensure(request()), ctx.cache.ensure(request())]);

		expect(a?.version).toBe('2026.05.0-179');
		expect(b?.version).toBe('2026.05.0-179');
		expect(ctx.http.getCalls.filter(url => url === EXACT_ZIP)).toHaveLength(1);
	});

	it('does not re-attempt within a session, but invalidate() permits one more', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.http.route(LATEST_ZIP, { status: 404 });
		await ctx.cache.ensure(request());
		const afterFirst = ctx.http.headCalls.length;

		await ctx.cache.ensure(request());
		expect(ctx.http.headCalls.length).toBe(afterFirst);

		// The one in-session re-attempt the spec allows: an ai.enabled flip.
		ctx.cache.invalidate();
		await ctx.cache.ensure(request());
		expect(ctx.http.headCalls.length).toBeGreaterThan(afterFirst);
	});
});

describe('PositronDocsCache: hard-failure throttling', () => {
	it('records lastFailureAt and skips the next session inside the window', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 503 });
		ctx.http.route(LATEST_ZIP, { status: 503 });
		await ctx.cache.ensure(request());
		expect(JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`)).lastFailureAt).toBeDefined();

		ctx.advance(59 * 60 * 1000);
		const callsBefore = ctx.http.getCalls.length;
		await ctx.makeCache().ensure(request());

		expect(ctx.http.getCalls.length).toBe(callsBefore);
	});

	it('retries once the throttle window has passed', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 503 });
		ctx.http.route(LATEST_ZIP, { status: 503 });
		await ctx.cache.ensure(request());
		const callsBefore = ctx.http.getCalls.length;

		ctx.advance(61 * 60 * 1000);
		await ctx.makeCache().ensure(request());

		expect(ctx.http.getCalls.length).toBeGreaterThan(callsBefore);
	});

	it('does not throttle a 404, so convergence keeps running', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		const state = JSON.parse(await ctx.files.readFile(`${ROOT}/state.json`));
		expect(state.lastFailureAt).toBeUndefined();

		ctx.advance(60 * 1000);
		await ctx.makeCache().ensure(request());
		expect(ctx.http.headCalls.filter(url => url === EXACT_ZIP)).toHaveLength(2);
	});

	it('still serves the cache when persisting the failure marker fails', async () => {
		// A full disk breaks both the download and the throttle bookkeeping.
		// The bookkeeping is best-effort: it must never turn a served bundle
		// into web-only, which is what an unhandled write error would do.
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		expect(await ctx.cache.ensure(request({ quality: 'dailies' }))).toBeDefined();

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		ctx.files.failWritesUnder = ROOT;

		const second = await ctx.makeCache().ensure(request({ quality: 'dailies' }));
		expect(second?.version).toBe('2026.04.0-100');
	});
});

describe('PositronDocsCache: pruning', () => {
	it('deletes superseded version directories on success', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		await ctx.makeCache().ensure(request());

		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179/llms.txt`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100`)).toBe(false);
	});

	it('leaves another window in-flight temp entries alone but collects abandoned ones', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		// Two windows share this directory. A recent temp file belongs to a
		// live download; an old one is an abandoned leftover.
		await ctx.files.writeFile(`${ROOT}/.tmp-otherwindow.zip`, 'in flight');
		ctx.files.mtimes.set(`${ROOT}/.tmp-otherwindow.zip`, 1_000_000);
		await ctx.files.writeFile(`${ROOT}/.staging-abandoned/x`, 'stale');
		ctx.files.mtimes.set(`${ROOT}/.staging-abandoned`, 1_000_000 - 11 * 60 * 1000);

		await ctx.cache.ensure(request());

		expect(await ctx.files.exists(`${ROOT}/.tmp-otherwindow.zip`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/.staging-abandoned`)).toBe(false);
	});
});
