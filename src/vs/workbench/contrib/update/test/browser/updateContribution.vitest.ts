/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUpdateService, State, StateType, UpdateType } from '../../../../../platform/update/common/update.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IActivityService } from '../../../../services/activity/common/activity.js';
import { TestProductService } from '../../../../test/common/workbenchTestServices.js';
import { UpdateContribution } from '../../browser/update.js';

describe('UpdateContribution update notifications', () => {
	const COMMIT = 'a1b2c3d4e5f6';
	const DAY_MILLIS = 1000 * 60 * 60 * 24;

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.build();

	const prompt = vi.fn<INotificationService['prompt']>();
	const onStateChange = new Emitter<State>();

	let contribution: IDisposable | undefined;

	/** A `ready` state for a pending update, as the update service would emit it. */
	function ready(productVersion: string): State {
		return {
			type: StateType.Ready,
			update: { version: `commit-${productVersion}`, productVersion },
			explicit: false,
			overwrite: false,
		};
	}

	/** An `available for download` state, the notifying stage on Linux. */
	function availableForDownload(productVersion: string): State {
		return {
			type: StateType.AvailableForDownload,
			update: { version: `commit-${productVersion}`, productVersion },
		};
	}

	/** Opens or closes upstream's staleness gate by backdating the notification clock. */
	function seedStalenessGate(daysSinceLastNotification: number): void {
		const storageService = ctx.get(IStorageService);
		storageService.store('update/lastKnownVersion', COMMIT, StorageScope.APPLICATION, StorageTarget.MACHINE);
		storageService.store('update/updateNotificationTime', Date.now() - daysSinceLastNotification * DAY_MILLIS, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	/** The state handler is `async`; let any pending work settle before asserting. */
	function settle(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 0));
	}

	function createContribution(): void {
		contribution = new UpdateContribution(
			ctx.get(IStorageService),
			stubInterface<IInstantiationService>({}),
			stubInterface<IUpdateService>({
				onStateChange: onStateChange.event,
				state: { type: StateType.Idle, updateType: UpdateType.Setup },
			}),
			stubInterface<IActivityService>({ showGlobalActivity: () => Disposable.None }),
			ctx.get(IContextKeyService),
			// `target: 'user'` keeps the Windows system-wide bypass out of play, so
			// these tests exercise the same path on every platform.
			{ ...TestProductService, commit: COMMIT, target: 'user' },
			stubInterface<INotificationService>({ prompt }),
			ctx.get(IConfigurationService),
		);
	}

	beforeEach(() => {
		// Six days stale, so upstream's `shouldShowNotification()` gate is open and
		// the session cap is the only thing left standing between the update
		// service and the user.
		seedStalenessGate(6);
	});

	afterEach(() => {
		contribution?.dispose();
		contribution = undefined;
	});

	it('shows one prompt when the same update repeatedly re-enters the ready state', async () => {
		createContribution();

		// A deadlocked Windows installer drops the state machine back to `ready`
		// over and over for one pending update. See #15031.
		for (let i = 0; i < 5; i++) {
			onStateChange.fire(ready('2026.09.0'));
		}
		await settle();

		expect(prompt).toHaveBeenCalledOnce();
	});

	it('shows a new prompt once a newer version becomes ready', async () => {
		createContribution();

		onStateChange.fire(ready('2026.09.0'));
		onStateChange.fire(ready('2026.09.1'));
		await settle();

		expect(prompt.mock.calls.map(call => call[1])).toEqual([
			expect.stringContaining('2026.09.0'),
			expect.stringContaining('2026.09.1'),
		]);
	});

	it('shows a prompt every time when the user explicitly checks for updates', async () => {
		createContribution();

		for (let i = 0; i < 3; i++) {
			onStateChange.fire({ type: StateType.CheckingForUpdates, explicit: true });
			onStateChange.fire(ready('2026.09.0'));
		}
		await settle();

		expect(prompt).toHaveBeenCalledTimes(3);
	});

	it('shows one prompt when the same download stays available', async () => {
		createContribution();

		for (let i = 0; i < 5; i++) {
			onStateChange.fire(availableForDownload('2026.09.0'));
		}
		await settle();

		expect(prompt).toHaveBeenCalledOnce();
	});

	it('shows a prompt every time an explicit check finds a download available', async () => {
		createContribution();

		// The Linux stage has no staleness bypass for explicit checks upstream,
		// but the session cap must never swallow a check the user just asked for.
		onStateChange.fire({ type: StateType.CheckingForUpdates, explicit: true });
		onStateChange.fire(availableForDownload('2026.09.0'));
		onStateChange.fire(availableForDownload('2026.09.0'));
		await settle();

		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it('shows no prompt within five days of the installed build', async () => {
		seedStalenessGate(2);

		createContribution();
		onStateChange.fire(ready('2026.09.0'));
		await settle();

		expect(prompt).not.toHaveBeenCalled();
	});

	it('does not spend the session cap on a prompt the staleness gate suppressed', async () => {
		seedStalenessGate(2);
		createContribution();

		onStateChange.fire(ready('2026.09.0'));
		// The same pending update, now that the installed build has gone stale.
		seedStalenessGate(6);
		onStateChange.fire(ready('2026.09.0'));
		onStateChange.fire(ready('2026.09.0'));
		await settle();

		expect(prompt).toHaveBeenCalledOnce();
	});
});
