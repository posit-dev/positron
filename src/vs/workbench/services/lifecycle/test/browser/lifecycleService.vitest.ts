/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { NullLogService } from '../../../../../platform/log/common/log.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { ShutdownReason } from '../../common/lifecycle.js';
import { BrowserLifecycleService } from '../../browser/lifecycleService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';

describe('BrowserLifecycleService', () => {
	const disposables = ensureNoLeakedDisposables();

	function createService() {
		const storage = disposables.add(new InMemoryStorageService());
		return disposables.add(new BrowserLifecycleService(new NullLogService(), storage));
	}

	it('onWillShutdown forwards the reason recorded by withExpectedShutdown', async () => {
		const service = createService();
		const observed: ShutdownReason[] = [];
		disposables.add(service.onWillShutdown(e => observed.push(e.reason)));

		await service.withExpectedShutdown(ShutdownReason.RELOAD);
		await service.shutdown();

		expect(observed).toEqual([ShutdownReason.RELOAD]);
	});

	it('onBeforeShutdown forwards the reason recorded by withExpectedShutdown', async () => {
		const service = createService();
		const observed: ShutdownReason[] = [];
		disposables.add(service.onBeforeShutdown(e => observed.push(e.reason)));

		await service.withExpectedShutdown(ShutdownReason.CLOSE);
		await service.shutdown();

		expect(observed).toEqual([ShutdownReason.CLOSE]);
	});

	it('falls back to QUIT when no reason was recorded', async () => {
		const service = createService();
		const observed: ShutdownReason[] = [];
		disposables.add(service.onWillShutdown(e => observed.push(e.reason)));

		await service.shutdown();

		expect(observed).toEqual([ShutdownReason.QUIT]);
	});
});
