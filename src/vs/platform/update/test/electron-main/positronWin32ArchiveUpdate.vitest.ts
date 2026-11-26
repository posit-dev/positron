/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IConfigurationService } from '../../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../../files/common/files.js';
import { ILifecycleMainService } from '../../../lifecycle/electron-main/lifecycleMainService.js';
import { NullLogService } from '../../../log/common/log.js';
import { IMeteredConnectionService } from '../../../meteredConnection/common/meteredConnection.js';
import { INativeHostMainService } from '../../../native/electron-main/nativeHostMainService.js';
import { IProductService } from '../../../product/common/productService.js';
import { IRequestService } from '../../../request/common/request.js';
import { IStateService } from '../../../state/node/state.js';
import { IApplicationStorageMainService } from '../../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../../telemetry/common/telemetry.js';
import { IWindowsMainService } from '../../../windows/electron-main/windows.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { ensureNoLeakedDisposables } from '../../../../test/vitest/vitestUtils.js';
import { StateType } from '../../common/update.js';
import { Win32UpdateService } from '../../electron-main/updateService.win32.js';

// The `electron-main` imports pull in the real `electron` package, whose postinstall shim throws
// when the Electron binary is missing (as in the unit-test CI container). Nothing here reaches
// electron, so inert placeholders are enough. Matches the other `electron-main` vitest files.
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
 * A zip install of Positron for Windows (the portable build, issue #3932) has no `target` in
 * product.json; only the installer's copy gets one. Its update check has to read the archive
 * feed, and it must only ever offer a download link: the feed advertises the next zip, which
 * is not an installer the update service can run.
 */
describe('Win32UpdateService for a zip install', () => {

	class TestWin32UpdateService extends Win32UpdateService {
		feedUrl(channel: string): string | undefined {
			return this.buildUpdateFeedUrl(channel);
		}

		/** Reports an update the way the regular check does, with `update.autoUpdate` on (its default). */
		reportUpdate(): void {
			this.enableAutoUpdate = true;
			this.updateAvailable({ version: '2026.12.0-1', url: 'https://cdn.example/Positron-win32-2026.12.0-1-x64.zip' });
		}
	}

	function createService(target: string | undefined): TestWin32UpdateService {
		return new TestWin32UpdateService(
			stubInterface<ILifecycleMainService>({
				// Never resolves, so `initialize()` stays out of these tests.
				when: () => new Promise<void>(() => { }),
				setRelaunchHandler: () => { },
			}),
			stubInterface<IConfigurationService>({}),
			stubInterface<ITelemetryService>({}),
			stubInterface<IEnvironmentMainService>({ isBuilt: true }),
			stubInterface<IRequestService>({}),
			new NullLogService(),
			stubInterface<IFileService>({}),
			stubInterface<INativeHostMainService>({}),
			stubInterface<IProductService>({ target, updateUrl: 'https://cdn.example/positron', win32MutexName: 'positron' }),
			stubInterface<IApplicationStorageMainService>({}),
			stubInterface<IMeteredConnectionService>({ onDidChangeIsConnectionMetered: Event.None }),
			stubInterface<IStateService>({}),
			stubInterface<IWindowsMainService>({}),
		);
	}

	ensureNoLeakedDisposables();

	it('reads the archive feed published next to the zip', () => {
		const service = createService(undefined);

		expect(service.feedUrl('releases')).toMatch(/^https:\/\/cdn\.example\/positron\/releases\/win\/(x86_64|arm64)\/releases\.json$/);

		service.dispose();
	});

	it('still reads the installer feed for its own target', () => {
		const service = createService('user');

		expect(service.feedUrl('releases')).toMatch(/\/win\/(x86_64|arm64)\/user-releases\.json$/);

		service.dispose();
	});

	it('offers the new zip as a download instead of staging it as an installer', () => {
		const service = createService(undefined);

		service.reportUpdate();

		// The feed carries no `productVersion`, and the workbench shows no notification without one.
		const state = service.state;
		expect({
			type: state.type,
			productVersion: state.type === StateType.AvailableForDownload ? state.update.productVersion : undefined,
		}).toEqual({ type: StateType.AvailableForDownload, productVersion: '2026.12.0-1' });

		service.dispose();
	});
});
