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

/**
 * Triggers whose fetch always rejects, over a cold cache. The timeout never
 * fires, so the rejection is what settles the race in `getLocalDocs`.
 */
function rejectingTriggers(logger: ReturnType<typeof recordingLogger>, message: string) {
	return new PositronDocsTriggers({
		cache: {
			ensure: async () => { throw new Error(message); },
			peek: async () => undefined,
			invalidate: vi.fn(),
		},
		request: REQUEST, logger,
		isAiEnabled: async () => true,
		waitMs: 10_000,
		delay: () => new Promise(() => { }),
	});
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
		// Undefined here looks identical to "no docs on disk" from the caller's
		// side, so the reason has to be in the log.
		expect(ctx.logger.infos.join('\n')).toContain('ai.enabled is off; not serving local docs');
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

		await expect(rejectingTriggers(ctx.logger, 'boom').runBackgroundFetch()).resolves.toBeUndefined();

		// The full prefix, not just 'boom': getLocalDocs logs its own rejection
		// with a different one, and the two must stay distinguishable in a log.
		expect(ctx.logger.warns.join('\n')).toContain('[llm-docs] background docs fetch failed: boom');
	});

	it('returns undefined when the fetch rejects rather than propagating to the caller', async () => {
		// getLocalDocs sits on an assistant response path, so a rejected download
		// has to read as "no local docs" and fall back to the web, not throw.
		const ctx = setup();

		expect(await rejectingTriggers(ctx.logger, 'boom').getLocalDocs()).toBeUndefined();

		expect(ctx.logger.warns.join('\n')).toContain('[llm-docs] docs fetch failed: boom');
		expect(ctx.logger.warns.join('\n')).not.toContain('background docs fetch failed');
	});
});
