/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
// Type-only, with createServer dynamically imported below: the layer rule bans
// http at module scope, and the source module honours it the same way.
import type { IncomingMessage, Server, ServerResponse } from 'http';
import type * as vscode from 'vscode';
import type { AddressInfo } from 'net';
import { tmpdir } from 'os';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { join } from '../../../../../base/common/path.js';
import { assertDefined } from '../../../../../base/common/types.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { PositronDocsTriggers } from '../../../../../platform/positronDocs/common/positronDocsTriggers.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AI_ENABLED_KEY } from '../../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';
import { ExtHostConfigProvider, IExtHostConfiguration } from '../../../common/extHostConfiguration.js';
import { IExtHostExtensionService } from '../../../common/extHostExtensionService.js';
import { IExtHostInitDataService } from '../../../common/extHostInitDataService.js';
import { deriveBundleRequest, NodeDocsHttpClient, NodeExtHostDocs } from '../../../node/positron/extHostDocsNode.js';

// `quality` is spelled out in the default rather than filled in with `??`, so a
// caller can pass `quality: undefined` to model a dev build.
function initData(overrides: { quality?: string | undefined; version?: string; build?: number } = { quality: 'releases' }) {
	return stubInterface<IExtHostInitDataService>({
		quality: overrides.quality,
		positronVersion: overrides.version ?? '2026.05.0',
		positronBuildNumber: overrides.build ?? 179,
		environment: stubInterface<IExtHostInitDataService['environment']>({
			globalStorageHome: URI.file('/userdata/User/globalStorage'),
		}),
	});
}

describe('deriveBundleRequest', () => {
	it('reads version, build number, and quality from init data', () => {
		expect(deriveBundleRequest(initData(), {})).toMatchObject({
			quality: 'releases',
			positronVersion: '2026.05.0',
			positronBuildNumber: 179,
		});
	});

	it('falls back to the product.json default when no env override is set', () => {
		expect(deriveBundleRequest(initData(), {}).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('lets POSITRON_LLMS_DOCS_URL take precedence over the product.json value', () => {
		// This override is what makes the feature verifiable on demand against
		// a local fixture server, since product.json is baked at build time.
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: 'http://127.0.0.1:8099/docs' }).baseUrl)
			.toBe('http://127.0.0.1:8099/docs');
	});

	it('ignores an empty POSITRON_LLMS_DOCS_URL rather than building a relative URL', () => {
		expect(deriveBundleRequest(initData(), { POSITRON_LLMS_DOCS_URL: '' }).baseUrl)
			.toBe('https://cdn.posit.co/positron/releases/docs');
	});

	it('resolves the profile to positron on desktop', () => {
		// isWorkbench is false in the Vitest process, which has no RS_SERVER_URL.
		expect(deriveBundleRequest(initData(), {}).profile).toBe('positron');
	});

	it('passes an undefined quality through for dev builds', () => {
		expect(deriveBundleRequest(initData({ quality: undefined }), {}).quality).toBeUndefined();
	});
});

/** Init data for a build whose cache would land under `root`, if it created one. */
function initDataAt(root: string) {
	return stubInterface<IExtHostInitDataService>({
		quality: 'dailies',
		positronVersion: '2026.05.0',
		positronBuildNumber: 179,
		environment: stubInterface<IExtHostInitDataService['environment']>({
			globalStorageHome: URI.file(join(root, 'globalStorage')),
		}),
	});
}

/** A cache root under tmpdir that no test creates; unique per call. */
function cacheRoot(label: string): string {
	return join(tmpdir(), `positron-llm-docs-${label}-${randomUUID()}`);
}

describe('NodeExtHostDocs construction', () => {
	// Disposed from afterEach rather than at the end of each test: a failing
	// assertion would skip an inline dispose() and leak the scheduler and the
	// config listener into whatever runs next.
	const store = new DisposableStore();
	afterEach(() => store.clear());

	// The one risk specific to hosting this on the extension host is a slow or
	// hung download landing on an activation path. The constructor must only
	// arm a scheduler and start installing a config listener, so with a config
	// provider and a startup signal that never resolve it must still return,
	// having created no cache directory.
	it('performs no filesystem work and does not wait on startup or configuration', async () => {
		const root = cacheRoot('ctor');
		const getConfigProvider = vi.fn(() => new Promise<never>(() => { }));
		store.add(new NodeExtHostDocs(
			initDataAt(root),
			stubInterface<IExtHostConfiguration>({ getConfigProvider }),
			stubInterface<IExtHostExtensionService>({
				// Never resolves: construction must not depend on startup finishing.
				whenStartupFinished: () => new Promise<void>(() => { }),
			}),
			new NullLogService(),
		));

		expect(existsSync(join(root, 'positron-llm-docs'))).toBe(false);
		// Called, but never awaited to completion - the listener install is a
		// detached continuation, not part of construction.
		expect(getConfigProvider).toHaveBeenCalledTimes(1);
	});
});

describe('NodeExtHostDocs launch anchor', () => {
	const store = new DisposableStore();
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => {
		// Before the timers go back to real: the scheduler being disposed is
		// still armed under fake time.
		store.clear();
		vi.useRealTimers();
	});

	function build(startupFinished: Promise<void>) {
		// Spying on the trigger rather than the ports: this asserts *when* the
		// launch fetch fires, and running the real one would reach the network.
		const runBackgroundFetch = vi.spyOn(PositronDocsTriggers.prototype, 'runBackgroundFetch')
			.mockResolvedValue(undefined);
		const service = store.add(new NodeExtHostDocs(
			initDataAt(cacheRoot('anchor')),
			stubInterface<IExtHostConfiguration>({
				getConfigProvider: async () => stubInterface<ExtHostConfigProvider>({
					getConfiguration: () => stubInterface<vscode.WorkspaceConfiguration>({ get: () => true }),
					onDidChangeConfiguration: () => Disposable.None,
				}),
			}),
			stubInterface<IExtHostExtensionService>({ whenStartupFinished: () => startupFinished }),
			new NullLogService(),
		));
		return { service, runBackgroundFetch };
	}

	it('does not fetch while the startup-finished signal is pending', async () => {
		const ctx = build(new Promise<void>(() => { }));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ctx.runBackgroundFetch).not.toHaveBeenCalled();
	});

	it('fetches 5 seconds after the signal resolves', async () => {
		let resolve!: () => void;
		const ctx = build(new Promise<void>(r => { resolve = r; }));
		resolve();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(ctx.runBackgroundFetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(ctx.runBackgroundFetch).toHaveBeenCalledOnce();
	});

	it('does not fetch if disposed between the signal and the delay', async () => {
		let resolve!: () => void;
		const ctx = build(new Promise<void>(r => { resolve = r; }));
		resolve();
		ctx.service.dispose();
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ctx.runBackgroundFetch).not.toHaveBeenCalled();
	});
});

describe('NodeExtHostDocs ai.enabled flip', () => {
	const store = new DisposableStore();
	afterEach(() => store.clear());

	// ai.enabled is WINDOW-scoped and toggles without a reload, so the false-to-true
	// flip is the one in-session re-attempt the design allows. Spying on the trigger
	// rather than the cache: what matters here is which config transitions reach it.
	async function build(initiallyEnabled: boolean) {
		const onAiEnabledFlippedTrue = vi.spyOn(PositronDocsTriggers.prototype, 'onAiEnabledFlippedTrue')
			.mockResolvedValue(undefined);
		const changed = new Emitter<vscode.ConfigurationChangeEvent>();
		const subscribe = vi.fn((listener: (e: vscode.ConfigurationChangeEvent) => unknown) => changed.event(listener));
		let enabled = initiallyEnabled;

		const service = store.add(new NodeExtHostDocs(
			initDataAt(cacheRoot('flip')),
			stubInterface<IExtHostConfiguration>({
				getConfigProvider: async () => stubInterface<ExtHostConfigProvider>({
					getConfiguration: () => stubInterface<vscode.WorkspaceConfiguration>({ get: () => enabled }),
					onDidChangeConfiguration: subscribe,
				}),
			}),
			// Never resolves: the launch fetch must stay out of this test's way.
			stubInterface<IExtHostExtensionService>({ whenStartupFinished: () => new Promise<void>(() => { }) }),
			new NullLogService(),
		));

		// The listener install is a detached continuation off an awaited
		// getConfigProvider(), so it is not in place when the constructor returns.
		// Waiting on the subscription itself beats guessing at a microtask count.
		await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(1));

		return {
			service, onAiEnabledFlippedTrue,
			/** Move ai.enabled and fire the change event the provider would. */
			set: async (next: boolean, affectedKey = AI_ENABLED_KEY) => {
				enabled = next;
				changed.fire({ affectsConfiguration: (section: string) => section === affectedKey });
				await Promise.resolve();
			},
		};
	}

	it('refetches when ai.enabled flips false to true', async () => {
		const ctx = await build(false);

		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).toHaveBeenCalledTimes(1);
	});

	it('does not refetch when ai.enabled flips true to false', async () => {
		const ctx = await build(true);

		await ctx.set(false);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
	});

	it('does not refetch when a change leaves ai.enabled true', async () => {
		// A rewrite of the same value still fires the event. Treating it as a flip
		// would re-download the bundle on every unrelated settings.json save.
		const ctx = await build(true);

		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
	});

	it('ignores a change to an unrelated setting', async () => {
		const ctx = await build(false);

		// The value moved, but this event does not claim to affect ai.enabled.
		await ctx.set(true, 'editor.fontSize');

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
	});

	it('fires once per flip, not once per event', async () => {
		const ctx = await build(false);

		await ctx.set(true);
		await ctx.set(true);
		await ctx.set(false);
		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).toHaveBeenCalledTimes(2);
	});

	it('stops listening once disposed', async () => {
		const ctx = await build(false);
		ctx.service.dispose();

		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
	});
});

describe('NodeDocsHttpClient', () => {
	// Driven against a real http server rather than a mocked `http` module. The
	// byte cap, the redirect cap, and the timeout are enforced by this class and
	// by nothing else - PositronDocsCache's fakes reimplement the cap as a size
	// comparison - so a test that stubs `request` would assert the fake again.
	let server: Server;
	let base: string;
	/** Set per test to decide how the server answers. */
	let handler: (req: IncomingMessage, res: ServerResponse) => void;

	beforeEach(async () => {
		const { createServer } = await import('http');
		// Reset per test so a case that forgets to set one fails loudly instead of
		// silently inheriting the previous test's server behaviour.
		handler = (_req, res) => { res.writeHead(500).end('no handler set for this test'); };
		server = createServer((req, res) => handler(req, res));
		await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});

	afterEach(async () => {
		// The connection-failure test closes the server itself, so this is
		// conditional rather than unconditional.
		if (server.listening) {
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
	});

	it('returns the body and the etag on a 200', async () => {
		handler = (_req, res) => res.writeHead(200, { etag: '"v1"' }).end('hello');

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`);

		expect(response.status).toBe(200);
		expect(response.etag).toBe('"v1"');
		expect(new TextDecoder().decode(response.body)).toBe('hello');
	});

	it('sends If-None-Match and reports a 304 with no body', async () => {
		let seen: string | undefined;
		handler = (req, res) => {
			seen = req.headers['if-none-match'];
			res.writeHead(304, { etag: '"v1"' }).end();
		};

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`, { etag: '"v1"' });

		expect(seen).toBe('"v1"');
		expect(response.status).toBe(304);
		expect(response.body).toBeUndefined();
	});

	it.each([404, 503])('reports HTTP %i without a body', async (status) => {
		handler = (_req, res) => res.writeHead(status).end('an error page');

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`);

		expect(response.status).toBe(status);
		expect(response.body).toBeUndefined();
	});

	it('reports a status and etag for HEAD without reading a body', async () => {
		handler = (_req, res) => res.writeHead(200, { etag: '"v2"', 'content-length': '5' }).end();

		const response = await new NodeDocsHttpClient().head(`${base}/bundle.zip`);

		expect(response.status).toBe(200);
		expect(response.etag).toBe('"v2"');
		expect(response.body).toBeUndefined();
	});

	it('rejects and tears the request down once the response exceeds maxBytes', async () => {
		// 8MB in 64KB chunks, far past what a socket buffer holds, so the server
		// is still mid-stream when the cap trips. A payload small enough to buffer
		// in one go would let the server finish writing either way, and the test
		// would pass without the abort.
		const total = 8 * 1024 * 1024;
		let written = 0;
		/** Resolves with whether the server finished writing before the socket died. */
		let endedBeforeClose: Promise<boolean> | undefined;
		handler = (_req, res) => {
			endedBeforeClose = new Promise<boolean>(resolve => res.on('close', () => resolve(res.writableEnded)));
			res.writeHead(200);
			const pump = () => {
				while (written < total) {
					written += 64 * 1024;
					if (!res.write('x'.repeat(64 * 1024))) {
						res.once('drain', pump);
						return;
					}
				}
				res.end();
			};
			pump();
		};

		await expect(new NodeDocsHttpClient().get(`${base}/bundle.zip`, { maxBytes: 4096 }))
			.rejects.toThrow(/exceeds 4096 bytes/);

		// The abort is the point: without destroy() the client would keep reading
		// and buffering all 8MB behind a rejection that has already been reported.
		assertDefined(endedBeforeClose, 'the request never reached the server');
		expect(await endedBeforeClose).toBe(false);
		expect(written).toBeLessThan(total);
	});

	it('accepts a response of exactly maxBytes', async () => {
		// The cap rejects on `>`, so the boundary itself must be served. Without
		// this, tightening the comparison to `>=` would refuse a bundle that is
		// exactly at the limit and every other test would stay green.
		const body = 'x'.repeat(4096);
		handler = (_req, res) => res.writeHead(200).end(body);

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`, { maxBytes: 4096 });

		expect(response.status).toBe(200);
		expect(new TextDecoder().decode(response.body)).toBe(body);
	});

	it('follows a redirect and returns the final body', async () => {
		handler = (req, res) => {
			if (req.url === '/bundle.zip') {
				res.writeHead(302, { location: '/moved.zip' }).end();
				return;
			}
			res.writeHead(200).end('after the redirect');
		};

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`);

		expect(new TextDecoder().decode(response.body)).toBe('after the redirect');
	});

	it('resolves a relative Location against the URL it came from', async () => {
		handler = (req, res) => {
			if (req.url === '/docs/bundle.zip') {
				res.writeHead(301, { location: 'actual.zip' }).end();
				return;
			}
			res.writeHead(200).end(req.url);
		};

		const response = await new NodeDocsHttpClient().get(`${base}/docs/bundle.zip`);

		expect(new TextDecoder().decode(response.body)).toBe('/docs/actual.zip');
	});

	// This pair pins the redirect cap from both sides. MAX_REDIRECTS is 3, so a
	// chain of three must arrive and a fourth must not be followed. Either test
	// alone would pass with an off-by-one in the comparison.
	it('follows a chain of redirects up to the cap', async () => {
		let served = 0;
		handler = (_req, res) => {
			if (served < 3) {
				served++;
				res.writeHead(302, { location: `/hop${served}` }).end();
				return;
			}
			res.writeHead(200).end('arrived');
		};

		const response = await new NodeDocsHttpClient().get(`${base}/bundle.zip`);

		expect(new TextDecoder().decode(response.body)).toBe('arrived');
		expect(served).toBe(3);
	});

	it('gives up rather than following a redirect loop', async () => {
		let requests = 0;
		handler = (_req, res) => {
			requests++;
			res.writeHead(302, { location: '/again.zip' }).end();
		};

		await expect(new NodeDocsHttpClient().get(`${base}/bundle.zip`)).rejects.toThrow(/too many redirects/);
		// Three redirects are followed; the fourth response is where it stops.
		expect(requests).toBe(4);
	});

	it('rejects when the server never responds', async () => {
		// Accepted and then left hanging, which is the failure a read timeout
		// exists for: a connect timeout would not catch it.
		handler = () => { };

		await expect(new NodeDocsHttpClient(50).get(`${base}/bundle.zip`)).rejects.toThrow(/timed out/);
	});

	it('rejects when the connection fails', async () => {
		// Bound, then closed, so the port is known to be free rather than guessed.
		const port = (server.address() as AddressInfo).port;
		await new Promise<void>(resolve => server.close(() => resolve()));

		await expect(new NodeDocsHttpClient().get(`http://127.0.0.1:${port}/bundle.zip`))
			.rejects.toThrow(/ECONNREFUSED/);
	});
});
