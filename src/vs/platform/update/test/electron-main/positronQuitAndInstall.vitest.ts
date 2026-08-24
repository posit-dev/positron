/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { bufferToStream, VSBuffer } from '../../../../base/common/buffer.js';
import { TestConfigurationService } from '../../../configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../log/common/log.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
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
import { State, StateType } from '../../common/update.js';

// The interfaces above come from `electron-main` files whose import chain pulls in the real
// `electron` package, and requiring that package runs a postinstall shim that downloads the
// Electron binary (and throws when it cannot). The unit-test CI container has no binary and no
// download, so without this mock the whole file fails to load there. Nothing in these tests
// reaches electron -- every collaborator is a stub -- so inert placeholders are enough. Match
// the other `electron-main` vitest files and keep the mock.
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
 * The Windows installer reads the update flag file as soon as the app mutex clears, and that mutex
 * is released during `onWillShutdown`, i.e. before `lifecycleMainService.quit()` resolves. So
 * `prepareForQuitAndInstall()` has to run before the quit, not after it. These tests pin that
 * ordering, which is easy to lose in an upstream merge.
 */
describe('AbstractUpdateService quit-and-install hooks', () => {

	/** Records the order of the interesting calls so a test can assert on the whole sequence. */
	let calls: string[];
	/** Whether the fake lifecycle service reports the quit as vetoed. */
	let veto: boolean;

	class TestUpdateService extends AbstractUpdateService {
		protected override doCheckForUpdates(): void { }
		protected override buildUpdateFeedUrl(): string | undefined { return undefined; }

		protected override async prepareForQuitAndInstall(): Promise<void> {
			// Yield before recording, so that these tests pin *completion* before the quit rather
			// than merely the call order. Without this, dropping the `await` in `quitAndInstall()`
			// would reintroduce the race the hook exists to prevent and the tests would stay green.
			// Do not simplify this away.
			await new Promise<void>(resolve => setTimeout(resolve, 0));
			calls.push('prepare');
		}

		protected override async undoPrepareForQuitAndInstall(): Promise<void> {
			calls.push('undo');
		}

		protected override doQuitAndInstall(): void {
			calls.push('doQuitAndInstall');
		}

		/** The real service reaches Ready through the download/apply chain, which needs a network. */
		becomeReady(): void {
			this.setState(State.Ready({ version: '2026.09.0-1' }, false, false));
		}
	}

	function createService(): TestUpdateService {
		const lifecycleMainService = stubInterface<ILifecycleMainService>({
			// Never resolves, so `initialize()` stays out of these tests.
			when: () => new Promise<void>(() => { }),
			quit: async () => {
				calls.push('quit');
				return veto;
			}
		});

		return new TestUpdateService(
			lifecycleMainService,
			stubInterface<IConfigurationService>({}),
			stubInterface<IEnvironmentMainService>({}),
			stubInterface<IRequestService>({}),
			new NullLogService(),
			stubInterface<ITelemetryService>({}),
			stubInterface<IApplicationStorageMainService>({}),
			stubInterface<IMeteredConnectionService>({}),
			stubInterface<IProductService>({}),
			stubInterface<INativeHostMainService>({}),
			stubInterface<IStateService>({}),
			false /* supportsUpdateOverwrite */
		);
	}

	// Must be at describe scope: the helper registers its own beforeEach/afterEach, so calling it
	// from inside a running beforeEach registers them too late to have any effect.
	ensureNoLeakedDisposables();

	beforeEach(() => {
		calls = [];
		veto = false;
	});

	it('prepares for the install before the shutdown starts', async () => {
		const service = createService();
		service.becomeReady();

		await service.quitAndInstall();
		await vi.waitFor(() => expect(calls).toContain('doQuitAndInstall'));

		expect(calls).toEqual(['prepare', 'quit', 'doQuitAndInstall']);
		service.dispose();
	});

	it('undoes the preparation and restores Ready when the quit is vetoed', async () => {
		veto = true;
		const service = createService();
		service.becomeReady();

		await service.quitAndInstall();
		await vi.waitFor(() => expect(calls).toContain('undo'));

		expect(calls).toEqual(['prepare', 'quit', 'undo']);
		expect(service.state.type).toBe(StateType.Ready);
		service.dispose();
	});

	it('does nothing at all when there is no update ready', async () => {
		const service = createService();

		await service.quitAndInstall();

		expect(calls).toEqual([]);
		service.dispose();
	});
});

/**
 * The overwrite flow is what makes "Restart to Update" install the version that is latest *at
 * restart time* (posit-dev/positron#8284): `quitAndInstall()` re-checks the feed against the
 * pending update, and when something newer exists it cancels the pending update, re-downloads,
 * and postpones the quit. These tests pin that decision logic; the platform download pipelines
 * are exercised manually.
 */
describe('AbstractUpdateService overwrite updates', () => {

	const PENDING_VERSION = '2026.09.0-1';

	/** Records the order of the interesting calls so a test can assert on the whole sequence. */
	let calls: string[];
	/** The version the fake release feed advertises. */
	let feedVersion: string;
	/** When true, `cancelPendingUpdate()` throws, simulating an installer that cannot be torn down. */
	let cancelFails: boolean;
	/** Whether the fake connection reports itself as metered. */
	let metered: boolean;

	class TestUpdateService extends AbstractUpdateService {
		protected override doCheckForUpdates(_explicit: boolean, pendingCommit?: string): void {
			calls.push(`doCheckForUpdates(${pendingCommit})`);
		}

		protected override buildUpdateFeedUrl(): string | undefined { return undefined; }

		protected override doQuitAndInstall(): void {
			calls.push('doQuitAndInstall');
		}

		protected override async cancelPendingUpdate(): Promise<void> {
			calls.push('cancelPendingUpdate');
			if (cancelFails) {
				throw new Error('another instance is still running setup');
			}
		}

		/** Points `isLatestVersion()` at the fake feed without running `initialize()`. */
		setFeed(): void {
			this.url = 'https://positron.example.com/releases.json';
		}

		/** The real service reaches Ready through the download/apply chain, which needs a network. */
		becomeReady(): void {
			this.setFeed();
			this.setState(State.Ready({ version: PENDING_VERSION }, false, false));
		}
	}

	function createService(options?: { updateMode?: string; positronVersion?: string; positronBuildNumber?: number }): TestUpdateService {
		const lifecycleMainService = stubInterface<ILifecycleMainService>({
			// Never resolves, so `initialize()` stays out of these tests.
			when: () => new Promise<void>(() => { }),
			quit: async () => {
				calls.push('quit');
				return false;
			}
		});

		const requestService = stubInterface<IRequestService>({
			request: async () => ({
				res: { statusCode: 200, headers: {} },
				stream: bufferToStream(VSBuffer.fromString(JSON.stringify({
					version: feedVersion,
					url: 'https://positron.example.com/download'
				})))
			})
		});

		return new TestUpdateService(
			lifecycleMainService,
			new TestConfigurationService({ 'update.mode': options?.updateMode ?? 'default' }),
			stubInterface<IEnvironmentMainService>({}),
			requestService,
			new NullLogService(),
			stubInterface<ITelemetryService>({}),
			stubInterface<IApplicationStorageMainService>({}),
			stubInterface<IMeteredConnectionService>({
				// A getter, so a test can flip `metered` after the service is built.
				get isConnectionMetered() { return metered; }
			}),
			stubInterface<IProductService>({
				positronVersion: options?.positronVersion ?? '2026.09.0',
				positronBuildNumber: options?.positronBuildNumber ?? 1
			}),
			stubInterface<INativeHostMainService>({}),
			stubInterface<IStateService>({}),
			true /* supportsUpdateOverwrite */
		);
	}

	ensureNoLeakedDisposables();

	beforeEach(() => {
		calls = [];
		feedVersion = PENDING_VERSION;
		cancelFails = false;
		metered = false;
	});

	describe('quitAndInstall', () => {

		it('postpones the quit and restarts the update machinery when a newer version exists', async () => {
			feedVersion = '2026.09.0-2';
			const service = createService();
			service.becomeReady();

			await service.quitAndInstall();

			expect(calls).toEqual(['cancelPendingUpdate', `doCheckForUpdates(${PENDING_VERSION})`]);
			expect(service.state.type).toBe(StateType.Overwriting);
			service.dispose();
		});

		it('proceeds with the restart when the pending update is still the latest', async () => {
			const service = createService();
			service.becomeReady();

			await service.quitAndInstall();
			await vi.waitFor(() => expect(calls).toContain('doQuitAndInstall'));

			expect(calls).toEqual(['quit', 'doQuitAndInstall']);
			service.dispose();
		});

		it('only checks for an overwrite once, so the second restart request goes through', async () => {
			feedVersion = '2026.09.0-2';
			const service = createService();
			service.becomeReady();

			// First click: postponed while the newer version is fetched.
			await service.quitAndInstall();
			expect(calls).toContain(`doCheckForUpdates(${PENDING_VERSION})`);

			// The newer version reaches Ready; second click must restart, not re-check.
			calls = [];
			service.becomeReady();
			await service.quitAndInstall();
			await vi.waitFor(() => expect(calls).toContain('doQuitAndInstall'));

			expect(calls).toEqual(['quit', 'doQuitAndInstall']);
			service.dispose();
		});

		it('still overwrites on a metered connection, because the restart is an explicit action', async () => {
			// Upstream defers the *automatic* overwrite check on a metered connection, but a user
			// asking to restart is explicit and must still land on the latest version.
			feedVersion = '2026.09.0-2';
			metered = true;
			const service = createService();
			service.becomeReady();

			await service.quitAndInstall();

			expect(calls).toEqual(['cancelPendingUpdate', `doCheckForUpdates(${PENDING_VERSION})`]);
			expect(service.state.type).toBe(StateType.Overwriting);
			service.dispose();
		});

		it('proceeds with the restart of the pending update when the cancel fails', async () => {
			feedVersion = '2026.09.0-2';
			cancelFails = true;
			const service = createService();
			service.becomeReady();

			await service.quitAndInstall();
			await vi.waitFor(() => expect(calls).toContain('doQuitAndInstall'));

			expect(calls).toEqual(['cancelPendingUpdate', 'quit', 'doQuitAndInstall']);
			service.dispose();
		});
	});

	describe('isLatestVersion', () => {

		it('reports not latest when the feed is newer than the given version', async () => {
			feedVersion = '2026.09.0-2';
			const service = createService();
			service.setFeed();

			expect(await service.isLatestVersion(PENDING_VERSION)).toBe(false);
			service.dispose();
		});

		it('reports latest when the feed matches the given version', async () => {
			const service = createService();
			service.setFeed();

			expect(await service.isLatestVersion(PENDING_VERSION)).toBe(true);
			service.dispose();
		});

		it('reports latest when the feed is older than the given version', async () => {
			feedVersion = '2026.08.0-9';
			const service = createService();
			service.setFeed();

			expect(await service.isLatestVersion(PENDING_VERSION)).toBe(true);
			service.dispose();
		});

		it('compares against the installed version including the build number when no version is given', async () => {
			// Same calver as the installed build, newer build number: exactly the daily-channel case.
			feedVersion = '2026.09.0-2';
			const service = createService({ positronVersion: '2026.09.0', positronBuildNumber: 1 });
			service.setFeed();

			expect(await service.isLatestVersion()).toBe(false);
			service.dispose();
		});

		it('reports latest when the feed matches the installed version and build number', async () => {
			feedVersion = '2026.09.0-1';
			const service = createService({ positronVersion: '2026.09.0', positronBuildNumber: 1 });
			service.setFeed();

			expect(await service.isLatestVersion()).toBe(true);
			service.dispose();
		});

		it('cannot answer when updates are disabled or the feed URL is not configured', async () => {
			const disabled = createService({ updateMode: 'none' });
			disabled.setFeed();
			expect(await disabled.isLatestVersion(PENDING_VERSION)).toBeUndefined();
			disabled.dispose();

			const noFeed = createService();
			expect(await noFeed.isLatestVersion(PENDING_VERSION)).toBeUndefined();
			noFeed.dispose();
		});

		it('cannot answer on a metered connection, so no automatic check hits the network', async () => {
			feedVersion = '2026.09.0-2';
			metered = true;
			const service = createService();
			service.setFeed();

			expect(await service.isLatestVersion(PENDING_VERSION)).toBeUndefined();
			service.dispose();
		});

		it('cannot answer when the feed advertises an unparseable version', async () => {
			feedVersion = 'not-a-version';
			const service = createService();
			service.setFeed();

			expect(await service.isLatestVersion(PENDING_VERSION)).toBeUndefined();
			service.dispose();
		});
	});
});
