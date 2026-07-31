/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { DOCS_MAX_DOWNLOAD_BYTES, IDocsBundleRequest } from '../../common/positronDocsBundle.js';
import { PositronDocsCache } from '../../common/positronDocsCache.js';
import { fakeDigest, fakeZip, FakeArchive, FakeFileStore, FakeHttpClient, recordingLogger } from './fakes.js';

const ROOT = '/userdata/User/positron-docs';
const BASE = 'https://cdn.posit.co/positron/releases/docs';
const EXACT_ZIP = `${BASE}/positron-llms-2026.05.0-179.zip`;
const LATEST_ZIP = `${BASE}/positron-llms-latest.zip`;
const STATE_PATH = `${ROOT}/state.json`;

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
		profile: 'positron',
		baseUrl: BASE,
		...overrides,
	};
}

function setup() {
	let clock = 1_000_000;
	let ids = 0;
	const files = new FakeFileStore();
	const http = new FakeHttpClient();
	const archive = new FakeArchive(files);
	const logger = recordingLogger();
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
		/** The persisted cache state, parsed. */
		readState: async () => JSON.parse(await files.readFile(STATE_PATH)),
		/** Serve `zipUrl` with a matching, correctly-formatted checksum file. */
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

		const state = await ctx.readState();
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

		// readdir rather than listUnder: an empty leftover staging directory has no
		// file keys, so listUnder cannot see the leak this test is named for.
		expect((await ctx.files.readdir(ROOT)).filter(name => name.startsWith('.'))).toEqual([]);
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
	// `expectedLog` is what makes each case falsifiable: every rejection produces
	// the same three observable outcomes, so without a distinct reason a test
	// would still pass if the code refused the bundle for the wrong reason.
	// Matched across both levels on purpose - which level each outcome kind logs
	// at is asserted separately below.
	async function expectRejected(configure: (ctx: ReturnType<typeof setup>) => void, expectedLog: string) {
		const ctx = setup();
		configure(ctx);
		const docs = await ctx.cache.ensure(request());
		expect(docs).toBeUndefined();
		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179`)).toBe(false);
		expect(ctx.files.listUnder(ROOT).filter(p => p.includes('/.tmp-') || p.includes('/.staging-'))).toEqual([]);
		expect([...ctx.logger.warns, ...ctx.logger.infos].join('\n')).toContain(expectedLog);
		return ctx;
	}

	it('rejects when the checksum file 404s', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 404 });
		}, 'checksum file unavailable (HTTP 404)');
	});

	it('rejects when the checksum file is unparseable', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: '<!DOCTYPE html><html>404</html>' });
		}, 'checksum file does not hold a sha256 digest');
	});

	it('rejects when the digest does not match the zip', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179') });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'b'.repeat(64)}  bundle.zip` });
		}, 'digest mismatch');
	});

	it('rejects a corrupt archive', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, 'not-a-zip-at-all');
		}, 'corrupt archive');
	});

	it('rejects an archive entry that escapes the target', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({ 'llms.txt': 'x', '../../evil.sh': 'rm -rf /' }));
		}, 'archive entry escapes the target: ../../evil.sh');
	});

	it('rejects a bundle whose schema is not 1', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 2, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 2 }),
				'llms.txt': '# Positron\n',
			}));
		}, 'extracted bundle invalid (bad-manifest)');
	});

	it('rejects a bundle whose fileCount does not match', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, fakeZip({
				'bundle.json': JSON.stringify({ schema: 1, profile: 'positron', version: '2026.05.0-179', generated: 'g', docsBaseUrl: 'd', fileCount: 99 }),
				'llms.txt': '# Positron\n',
			}));
		}, 'extracted bundle invalid (file-count-mismatch)');
	});

	it('aborts a download that exceeds the size cap', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 200, body: payload('2026.05.0-179'), byteLength: DOCS_MAX_DOWNLOAD_BYTES + 1 });
			c.http.route(`${EXACT_ZIP}.sha256sum`, { status: 200, body: `${'c'.repeat(64)}  x` });
		}, `exceeds ${DOCS_MAX_DOWNLOAD_BYTES} bytes`);
	});

	it('returns undefined on a network failure', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 0, throws: 'getaddrinfo ENOTFOUND cdn.posit.co' });
		}, 'getaddrinfo ENOTFOUND cdn.posit.co');
	});

	it('returns undefined on a 5xx', async () => {
		await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 503 });
		}, 'unexpected HTTP 503 from HEAD');
	});

	it('returns undefined on a disk write error', async () => {
		await expectRejected(c => {
			c.publish(EXACT_ZIP, payload('2026.05.0-179'));
			c.files.failWritesUnder = ROOT;
		}, 'ENOSPC');
	});

	it('logs a fetch failure at info, and a refused payload at warn', async () => {
		// A docs download failing is not worth interrupting anyone over, so an
		// unreachable CDN stays at info. A payload that arrived and was refused
		// is different: something is wrong with what was published, and that
		// earns a warn.
		const failed = await expectRejected(c => {
			c.http.route(EXACT_ZIP, { status: 404 });
			c.http.route(LATEST_ZIP, { status: 0, throws: 'getaddrinfo ENOTFOUND cdn.posit.co' });
		}, 'fetch failed for');
		expect(failed.logger.warns).toEqual([]);

		const refused = await expectRejected(c => {
			c.publish(EXACT_ZIP, 'not-a-zip-at-all');
		}, 'corrupt archive');
		expect(refused.logger.warns.join('\n')).toContain('rejected bundle from');
	});
});

describe('PositronDocsCache: damaged cache state', () => {
	it('reinstalls when state names a version directory that is gone', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		// Someone cleared part of the cache directory by hand, leaving state.json
		// pointing at nothing. The bundle must come back, not be served from a
		// path that no longer exists.
		await ctx.files.delete(`${ROOT}/2026.05.0-179`);

		const docs = await ctx.makeCache().ensure(request());

		expect(docs?.version).toBe('2026.05.0-179');
		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179/llms.txt`)).toBe(true);
		expect(ctx.logger.warns.join('\n')).toContain('is unusable (missing-manifest)');
	});

	it('treats an unparseable state.json as a cold cache', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.files.writeFile(STATE_PATH, '{ not json');

		const docs = await ctx.cache.ensure(request());

		expect(docs?.version).toBe('2026.05.0-179');
		expect((await ctx.readState()).resolution).toBe('exact');
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
		expect((await ctx.readState()).resolution).toBe('fallback');

		// The release's docs publish. The next launch converges.
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		const second = await ctx.makeCache().ensure(request());
		expect(second?.version).toBe('2026.05.0-179');
		expect(second?.isExactMatch).toBe(true);
		expect((await ctx.readState()).resolution).toBe('exact');
		// Converging also cleans up: the fallback bundle is superseded.
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100`)).toBe(false);
	});

	it('keeps the cached bundle when latest answers 304', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());
		const before = ctx.files.listUnder(ROOT);

		ctx.advance(5 * 60 * 1000);
		const second = await ctx.makeCache().ensure(request());

		expect(second?.version).toBe('2026.04.0-100');
		expect(ctx.files.listUnder(ROOT)).toEqual(before);
		expect(ctx.logger.infos.join('\n')).toContain('unchanged (304)');
		// listUnder only compares paths, so it cannot see whether _touchState
		// ran. Assert the content moved too, or a regression that stopped
		// touching state would pass unnoticed.
		const state = await ctx.readState();
		expect(state.resolution).toBe('fallback');
		expect(state.lastAttemptAt).toBe(1_000_000 + 5 * 60 * 1000);
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
		['missing checksum file', (c: ReturnType<typeof setup>) => {
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

describe('PositronDocsCache: logging', () => {
	// Support reads these logs to work out what a build reached for. Naming the
	// URL and the decision before the request is what makes a download that
	// hangs or dies mid-flight diagnosable at all.
	it('names the target and the resolution before an exact request', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request());

		expect(ctx.logger.infos).toContain(`[positron-docs] fetching ${EXACT_ZIP} (exact)`);
	});

	it('names the target and the resolution when falling back to latest', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'));
		await ctx.cache.ensure(request());

		expect(ctx.logger.infos).toContain(`[positron-docs] fetching ${LATEST_ZIP} (fallback)`);
	});

	it('names the target and the resolution for a dailies build', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));
		await ctx.cache.ensure(request({ quality: 'dailies' }));

		expect(ctx.logger.infos).toContain(`[positron-docs] fetching ${LATEST_ZIP} (latest-by-policy)`);
	});
});

describe('PositronDocsCache: a cache installed mid-attempt', () => {
	// Two windows opening at once on a cold cache: one installs, the other's
	// download fails. The failing window memoizes its result for the session, so
	// it has to notice the bundle that landed while it was in flight or it stays
	// on web docs until the next relaunch.
	it('serves a bundle another window installed while this attempt was in flight', async () => {
		const ctx = setup();
		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'));

		let release!: () => void;
		const held = new Promise<void>(resolve => { release = resolve; });
		const secondWindow = new PositronDocsCache({
			rootPath: ROOT, files: ctx.files, archive: ctx.archive, logger: ctx.logger,
			now: () => 2_000_000, newId: () => 'second',
			http: {
				// Hangs until released, then fails: this window reads an empty cache
				// on the way in and never installs anything itself.
				get: async () => { await held; throw new Error('ENOTFOUND'); },
				head: url => ctx.http.head(url),
			},
		});

		const pending = secondWindow.ensure(request({ quality: 'dailies' }));
		expect((await ctx.cache.ensure(request({ quality: 'dailies' })))?.version).toBe('2026.05.0-179');

		release();
		expect((await pending)?.version).toBe('2026.05.0-179');

		// The failing window records its failure without erasing the version the
		// other window installed. Losing that would orphan the bundle on disk for
		// every later session, not just this one.
		const state = await ctx.readState();
		expect({ version: state.version, lastError: state.lastError }).toEqual({
			version: '2026.05.0-179',
			lastError: 'ENOTFOUND',
		});
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

	it('honours invalidate() called while a fetch is in flight', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.http.route(LATEST_ZIP, { status: 404 });

		// An ai.enabled flip can land mid-download. The completing attempt must
		// not re-arm the session gate and swallow the retry.
		const inFlight = ctx.cache.ensure(request());
		ctx.cache.invalidate();
		await inFlight;
		const afterFirst = ctx.http.headCalls.length;

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
		expect((await ctx.readState()).lastFailureAt).toBeDefined();

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

		const state = await ctx.readState();
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

describe('PositronDocsCache: superseded version cleanup', () => {
	it('deletes the superseded version directory on install', async () => {
		const ctx = setup();
		ctx.http.route(EXACT_ZIP, { status: 404 });
		ctx.publish(LATEST_ZIP, payload('2026.04.0-100'), 'etag-april');
		await ctx.cache.ensure(request());

		ctx.publish(LATEST_ZIP, payload('2026.05.0-179'), 'etag-may');
		await ctx.makeCache().ensure(request());

		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179/llms.txt`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/2026.04.0-100`)).toBe(false);
	});

	it('never touches entries it did not supersede, including another window in-flight work', async () => {
		const ctx = setup();
		ctx.publish(EXACT_ZIP, payload('2026.05.0-179'));

		// Two windows share this directory. Cleanup deletes only the version
		// the previous state named - there is no sweep - so a concurrent
		// window's temp file survives an install here unconditionally.
		await ctx.files.writeFile(`${ROOT}/.tmp-otherwindow.zip`, 'in flight');

		await ctx.cache.ensure(request());

		expect(await ctx.files.exists(`${ROOT}/.tmp-otherwindow.zip`)).toBe(true);
		expect(await ctx.files.exists(`${ROOT}/2026.05.0-179/llms.txt`)).toBe(true);
	});
});
