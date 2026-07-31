/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import type * as vscode from 'vscode';
import { tmpdir } from 'os';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { join } from '../../../../../base/common/path.js';
import { URI } from '../../../../../base/common/uri.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { PositronDocsTriggers } from '../../../../../platform/positronDocs/common/positronDocsTriggers.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AI_ENABLED_KEY } from '../../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';
import { ExtHostConfigProvider, IExtHostConfiguration } from '../../../common/extHostConfiguration.js';
import { IExtHostExtensionService } from '../../../common/extHostExtensionService.js';
import { IExtHostInitDataService } from '../../../common/extHostInitDataService.js';
import { deriveBundleRequest, NodeExtHostDocs } from '../../../node/positron/extHostDocsNode.js';

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
	// The one risk specific to hosting this on the extension host is a slow or
	// hung download landing on an activation path. The constructor must only
	// arm a scheduler and start installing a config listener, so with a config
	// provider and a startup signal that never resolve it must still return,
	// having created no cache directory.
	it('performs no filesystem work and does not wait on startup or configuration', async () => {
		const root = cacheRoot('ctor');
		const getConfigProvider = vi.fn(() => new Promise<never>(() => { }));
		const service = new NodeExtHostDocs(
			initDataAt(root),
			stubInterface<IExtHostConfiguration>({ getConfigProvider }),
			stubInterface<IExtHostExtensionService>({
				// Never resolves: construction must not depend on startup finishing.
				whenStartupFinished: () => new Promise<void>(() => { }),
			}),
			new NullLogService(),
		);

		expect(existsSync(join(root, 'positron-llm-docs'))).toBe(false);
		// Called, but never awaited to completion - the listener install is a
		// detached continuation, not part of construction.
		expect(getConfigProvider).toHaveBeenCalledTimes(1);
		service.dispose();
	});
});

describe('NodeExtHostDocs launch anchor', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	function build(startupFinished: Promise<void>) {
		// Spying on the trigger rather than the ports: this asserts *when* the
		// launch fetch fires, and running the real one would reach the network.
		const runBackgroundFetch = vi.spyOn(PositronDocsTriggers.prototype, 'runBackgroundFetch')
			.mockResolvedValue(undefined);
		const service = new NodeExtHostDocs(
			initDataAt(cacheRoot('anchor')),
			stubInterface<IExtHostConfiguration>({
				getConfigProvider: async () => stubInterface<ExtHostConfigProvider>({
					getConfiguration: () => stubInterface<vscode.WorkspaceConfiguration>({ get: () => true }),
					onDidChangeConfiguration: () => Disposable.None,
				}),
			}),
			stubInterface<IExtHostExtensionService>({ whenStartupFinished: () => startupFinished }),
			new NullLogService(),
		);
		return { service, runBackgroundFetch };
	}

	it('does not fetch while the startup-finished signal is pending', async () => {
		const ctx = build(new Promise<void>(() => { }));
		await vi.advanceTimersByTimeAsync(60_000);
		expect(ctx.runBackgroundFetch).not.toHaveBeenCalled();
		ctx.service.dispose();
	});

	it('fetches 5 seconds after the signal resolves', async () => {
		let resolve!: () => void;
		const ctx = build(new Promise<void>(r => { resolve = r; }));
		resolve();
		await vi.advanceTimersByTimeAsync(4_000);
		expect(ctx.runBackgroundFetch).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(ctx.runBackgroundFetch).toHaveBeenCalledOnce();
		ctx.service.dispose();
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
	// ai.enabled is WINDOW-scoped and toggles without a reload, so the false-to-true
	// flip is the one in-session re-attempt the design allows. Spying on the trigger
	// rather than the cache: what matters here is which config transitions reach it.
	async function build(initiallyEnabled: boolean) {
		const onAiEnabledFlippedTrue = vi.spyOn(PositronDocsTriggers.prototype, 'onAiEnabledFlippedTrue')
			.mockResolvedValue(undefined);
		const changed = new Emitter<vscode.ConfigurationChangeEvent>();
		const subscribe = vi.fn((listener: (e: vscode.ConfigurationChangeEvent) => unknown) => changed.event(listener));
		let enabled = initiallyEnabled;

		const service = new NodeExtHostDocs(
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
		);

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
		ctx.service.dispose();
	});

	it('does not refetch when ai.enabled flips true to false', async () => {
		const ctx = await build(true);

		await ctx.set(false);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
		ctx.service.dispose();
	});

	it('does not refetch when a change leaves ai.enabled true', async () => {
		// A rewrite of the same value still fires the event. Treating it as a flip
		// would re-download the bundle on every unrelated settings.json save.
		const ctx = await build(true);

		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
		ctx.service.dispose();
	});

	it('ignores a change to an unrelated setting', async () => {
		const ctx = await build(false);

		// The value moved, but this event does not claim to affect ai.enabled.
		await ctx.set(true, 'editor.fontSize');

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
		ctx.service.dispose();
	});

	it('fires once per flip, not once per event', async () => {
		const ctx = await build(false);

		await ctx.set(true);
		await ctx.set(true);
		await ctx.set(false);
		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).toHaveBeenCalledTimes(2);
		ctx.service.dispose();
	});

	it('stops listening once disposed', async () => {
		const ctx = await build(false);
		ctx.service.dispose();

		await ctx.set(true);

		expect(ctx.onAiEnabledFlippedTrue).not.toHaveBeenCalled();
	});
});
