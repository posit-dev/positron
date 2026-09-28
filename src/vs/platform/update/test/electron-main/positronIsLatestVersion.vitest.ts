/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer, bufferToStream } from '../../../../base/common/buffer.js';
import { NullLogService } from '../../../log/common/log.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { IRequestContext } from '../../../../base/parts/request/common/request.js';
import { IRequestService } from '../../../request/common/request.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { IApplicationStorageMainService } from '../../../storage/electron-main/storageMainService.js';
import { IMeteredConnectionService } from '../../../meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../../product/common/productService.js';
import { INativeHostMainService } from '../../../native/electron-main/nativeHostMainService.js';
import { IStateService } from '../../../state/node/state.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { AbstractUpdateService } from '../../electron-main/abstractUpdateService.js';

// See the matching note in positronQuitAndInstall.vitest.ts: these `electron-main` interfaces pull
// the real `electron` package into the import chain, which the unit-test container cannot load.
vi.mock('electron', () => {
	const nodeEventEmitter = () => ({ on: () => { }, removeListener: () => { } });
	return {
		default: { app: nodeEventEmitter(), ipcMain: nodeEventEmitter() },
		app: nodeEventEmitter(),
		ipcMain: nodeEventEmitter(),
		powerMonitor: nodeEventEmitter(),
		screen: nodeEventEmitter(),
		session: {},
		webContents: { fromId: () => undefined },
		BrowserWindow: {},
		Menu: {},
		Notification: class { },
		clipboard: {},
		contentTracing: {},
		dialog: {},
		nativeImage: {},
		powerSaveBlocker: {},
		shell: {},
		systemPreferences: {},
	};
});

/**
 * `isLatestVersion()` decides whether a staged update survives: `checkForOverwriteUpdates()` runs
 * five minutes after every `Ready` state and throws the staged update away when this returns
 * `false`. Two defects here made that fire on every same-month daily, so a "Restart to Update"
 * left sitting for five minutes silently discarded the update and reinstalled the old build
 * (#13988): the comparison dropped the build number, and the result was inverted.
 */
describe('AbstractUpdateService isLatestVersion', () => {

	const FEED_URL = 'https://update.example/feed';

	/** The version the fake update feed advertises. */
	let feedVersion: string | undefined;
	/** When set, the fake feed request rejects with this error instead of answering. */
	let feedError: Error | undefined;

	class TestUpdateService extends AbstractUpdateService {
		protected override doCheckForUpdates(): void { }
		protected override buildUpdateFeedUrl(): string | undefined { return FEED_URL; }

		/**
		 * `initialize()` normally sets `url` from `buildUpdateFeedUrl()`, and it is the guard that
		 * makes `isLatestVersion()` return `undefined` without asking the feed. These tests keep
		 * `initialize()` out of the way, so set it directly.
		 */
		useFeedUrl(): void {
			this.url = FEED_URL;
		}
	}

	function createService(): TestUpdateService {
		const service = new TestUpdateService(
			stubInterface<ILifecycleMainService>({
				// Never resolves, so `initialize()` stays out of these tests.
				when: () => new Promise<void>(() => { })
			}),
			stubInterface<IConfigurationService>({ getValue: () => 'default' }),
			stubInterface<IEnvironmentMainService>({}),
			stubInterface<IRequestService>({
				request: async () => {
					if (feedError) {
						throw feedError;
					}
					return stubInterface<IRequestContext>({
						res: { statusCode: 200, headers: {} },
						stream: bufferToStream(VSBuffer.fromString(
							JSON.stringify(feedVersion ? { version: feedVersion, url: 'https://update.example/setup.exe' } : {})
						))
					});
				}
			}),
			new NullLogService(),
			stubInterface<ITelemetryService>({}),
			stubInterface<IApplicationStorageMainService>({}),
			// `isLatestVersion()` skips the check outright on a metered connection; these tests are
			// about the comparison, so keep the connection unmetered.
			stubInterface<IMeteredConnectionService>({ isConnectionMetered: false }),
			stubInterface<IProductService>({ positronVersion: '2026.10.0', positronBuildNumber: 53 }),
			stubInterface<INativeHostMainService>({}),
			stubInterface<IStateService>({}),
			true /* supportsUpdateOverwrite */
		);

		service.useFeedUrl();
		return service;
	}

	// Must be at describe scope: the helper registers its own beforeEach/afterEach, so calling it
	// from inside a running beforeEach registers them too late to have any effect.
	ensureNoLeakedDisposables();

	beforeEach(() => {
		feedVersion = undefined;
		feedError = undefined;
	});

	it('keeps a staged update that the feed has not moved past', async () => {
		// The regression: running 53, staged 54, feed 54. Comparing the feed against the bare
		// `2026.10.0` reported "same build" and cancelled the staged update every time.
		feedVersion = '2026.10.0-54';
		const service = createService();

		expect(await service.isLatestVersion('2026.10.0-54')).toBe(true);

		service.dispose();
	});

	it('reports a staged update as stale once the feed moves past it', async () => {
		feedVersion = '2026.10.0-55';
		const service = createService();

		expect(await service.isLatestVersion('2026.10.0-54')).toBe(false);

		service.dispose();
	});

	it('compares the running build, including its build number, when given no version', async () => {
		const service = createService();

		feedVersion = '2026.10.0-53';
		expect(await service.isLatestVersion()).toBe(true);

		feedVersion = '2026.10.0-54';
		expect(await service.isLatestVersion()).toBe(false);

		service.dispose();
	});

	it('answers "unknown" rather than "stale" when the feed carries no version', async () => {
		// `undefined` is what keeps an unreadable feed from cancelling a staged update.
		const service = createService();

		expect(await service.isLatestVersion('2026.10.0-54')).toBeUndefined();

		service.dispose();
	});

	it('answers "unknown" when the feed request fails', async () => {
		// Resolves rather than rejects: the failure has to arrive as the documented unknown
		// answer, or `startupTimings` and `timerService` -- neither of which guards its `await`
		// -- propagate the rejection instead of just skipping their reflection.
		feedError = new Error('network down');
		const service = createService();

		await expect(service.isLatestVersion('2026.10.0-54')).resolves.toBeUndefined();

		service.dispose();
	});

	it('answers "unknown" when the feed advertises a malformed version', async () => {
		// `hasUpdate()` throws on anything that is not YYYY.MM.patch[-build].
		feedVersion = 'definitely-not-a-version';
		const service = createService();

		await expect(service.isLatestVersion('2026.10.0-54')).resolves.toBeUndefined();

		service.dispose();
	});
});
