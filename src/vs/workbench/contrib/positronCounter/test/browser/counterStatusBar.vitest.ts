/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { InMemoryStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { createLightTestContainer } from '../../../../../test/vitest/lightTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IStatusbarEntry, IStatusbarService } from '../../../../services/statusbar/browser/statusbar.js';
import { CounterStatusBarContribution } from '../../browser/counterStatusBar.js';
import { CounterService } from '../../browser/counterService.js';
import { COUNTER_STORAGE_KEY } from '../../common/counter.js';

describe('CounterStatusBarContribution', () => {
	const ctx = createLightTestContainer().build();

	function setup() {
		const storage = ctx.disposables.add(new InMemoryStorageService());
		storage.store(
			COUNTER_STORAGE_KEY,
			JSON.stringify({ state: { value: 4, stats: { min: 0, max: 4, counts: { increment: 4, decrement: 0, reset: 0 } } }, version: 1 }),
			StorageScope.PROFILE,
			StorageTarget.MACHINE
		);
		const service = ctx.disposables.add(new CounterService(storage, new TestConfigurationService()));

		const added: IStatusbarEntry[] = [];
		const update = vi.fn<(entry: IStatusbarEntry) => void>();
		const statusbarService = stubInterface<IStatusbarService>({
			addEntry: entry => {
				added.push(entry);
				return { update, dispose: () => { } };
			},
		});

		const contribution = new CounterStatusBarContribution(service, statusbarService);
		return { service, contribution, added, update };
	}

	it('shows the hydrated value at startup', () => {
		const { contribution, added } = setup();
		ctx.disposables.add(contribution);
		expect(added).toHaveLength(1);
		expect(added[0].text).toContain('4');
		expect(added[0].command).toBe('positron.counter.open');
	});

	it('updates when the service changes', () => {
		const { service, contribution, update } = setup();
		ctx.disposables.add(contribution);
		service.increment();
		expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ text: expect.stringContaining('5') }));
	});

	it('stops updating after dispose', () => {
		const { service, contribution, update } = setup();
		contribution.dispose();
		service.increment();
		expect(update).not.toHaveBeenCalled();
	});
});
