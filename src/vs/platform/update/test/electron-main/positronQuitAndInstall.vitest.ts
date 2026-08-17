/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

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
