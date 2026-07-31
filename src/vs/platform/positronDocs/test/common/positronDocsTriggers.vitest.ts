/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { IDocsBundleRequest } from '../../common/positronDocsBundle.js';
import { ILocalDocs } from '../../common/positronDocsIO.js';
import { IDocsCacheLike, PositronDocsTriggers } from '../../common/positronDocsTriggers.js';
import { recordingLogger } from './fakes.js';

const REQUEST: IDocsBundleRequest = {
	quality: 'dailies', positronVersion: '2026.05.0', positronBuildNumber: 179,
	profile: 'positron', baseUrl: 'https://cdn.posit.co/positron/releases/docs',
};

const DOCS: ILocalDocs = {
	path: '/cache/2026.05.0-179', schema: 1, version: '2026.05.0-179',
	profile: 'positron', docsBaseUrl: 'https://positron.posit.co/', isExactMatch: true,
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve };
}

function setup(options: { aiEnabled?: boolean; peeked?: ILocalDocs } = {}) {
	const ensureGate = deferred<ILocalDocs | undefined>();
	const timeoutGate = deferred<void>();
	const ensure = vi.fn(() => ensureGate.promise);
	const peek = vi.fn(async () => options.peeked);
	const invalidate = vi.fn();
	const cache: IDocsCacheLike = { ensure, peek, invalidate };
	const logger = recordingLogger();
	const triggers = new PositronDocsTriggers({
		cache, request: REQUEST, logger,
		isAiEnabled: async () => options.aiEnabled ?? true,
		waitMs: 10_000,
		delay: () => timeoutGate.promise,
	});
	return { triggers, ensure, peek, invalidate, logger, ensureGate, timeoutGate };
}

describe('PositronDocsTriggers: ai.enabled gating', () => {
	it('does not fetch on launch when ai.enabled is false', async () => {
		const ctx = setup({ aiEnabled: false });
		await ctx.triggers.runBackgroundFetch();
		expect(ctx.ensure).not.toHaveBeenCalled();
	});

	it('returns undefined from getLocalDocs without touching the cache when ai.enabled is false', async () => {
		const ctx = setup({ aiEnabled: false });
		expect(await ctx.triggers.getLocalDocs()).toBeUndefined();
		expect(ctx.ensure).not.toHaveBeenCalled();
		expect(ctx.peek).not.toHaveBeenCalled();
	});

	it('fetches on launch when ai.enabled is true', async () => {
		const ctx = setup();
		const running = ctx.triggers.runBackgroundFetch();
		ctx.ensureGate.resolve(DOCS);
		await running;
		expect(ctx.ensure).toHaveBeenCalledTimes(1);
	});

	it('invalidates and refetches when ai.enabled flips true', async () => {
		const ctx = setup();
		const running = ctx.triggers.onAiEnabledFlippedTrue();
		ctx.ensureGate.resolve(DOCS);
		await running;
		expect(ctx.invalidate).toHaveBeenCalledTimes(1);
		expect(ctx.ensure).toHaveBeenCalledTimes(1);
	});
});

describe('PositronDocsTriggers: joining and the bounded wait', () => {
	// The single-flight itself lives in PositronDocsCache (covered by
	// positronDocsCache.vitest.ts). What matters here is that the triggers
	// delegate every caller to it rather than keeping their own state.
	it('serves every concurrent caller from the same delegated fetch', async () => {
		const ctx = setup();
		const background = ctx.triggers.runBackgroundFetch();
		const first = ctx.triggers.getLocalDocs();
		const second = ctx.triggers.getLocalDocs();
		ctx.ensureGate.resolve(DOCS);

		expect(await first).toEqual(DOCS);
		expect(await second).toEqual(DOCS);
		await background;
		// Each caller went straight to the cache with the same request, and none
		// of them short-circuited or held a private copy of the result.
		expect(ctx.ensure.mock.calls).toEqual([[REQUEST], [REQUEST], [REQUEST]]);
	});

	it('returns the existing cached bundle on timeout, and does not cancel the fetch', async () => {
		const ctx = setup({ peeked: DOCS });
		const pending = ctx.triggers.getLocalDocs();
		ctx.timeoutGate.resolve();

		expect(await pending).toEqual(DOCS);
		expect(ctx.peek).toHaveBeenCalledTimes(1);
		expect(ctx.logger.infos.join('\n')).toContain('continuing in the background');

		// The download was never cancelled; only the caller stopped waiting.
		ctx.ensureGate.resolve(DOCS);
		expect(await ctx.triggers.getLocalDocs()).toEqual(DOCS);
	});

	it('returns undefined on timeout with a cold cache', async () => {
		const ctx = setup({ peeked: undefined });
		const pending = ctx.triggers.getLocalDocs();
		ctx.timeoutGate.resolve();
		expect(await pending).toBeUndefined();
	});

	it('swallows a fetch rejection so a background trigger never throws', async () => {
		const ctx = setup();
		const ensure = vi.fn(async () => { throw new Error('boom'); });
		const triggers = new PositronDocsTriggers({
			cache: { ensure, peek: async () => undefined, invalidate: vi.fn() },
			request: REQUEST, logger: ctx.logger,
			isAiEnabled: async () => true, waitMs: 10_000, delay: () => new Promise(() => { }),
		});

		await expect(triggers.runBackgroundFetch()).resolves.toBeUndefined();
		expect(ctx.logger.warns.join('\n')).toContain('boom');
	});
});
