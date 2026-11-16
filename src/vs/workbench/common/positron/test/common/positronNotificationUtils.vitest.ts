/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IProgressOptions, IProgressService, ProgressLocation } from '../../../../../platform/progress/common/progress.js';
import { DELAYED_NOTIFICATION_PROGRESS_DELAY_MS, withDelayedNotificationProgress } from '../../positronNotificationUtils.js';

function createProgressService() {
	const calls: { options: IProgressOptions; onDidCancel: unknown }[] = [];
	const service = {
		withProgress: vi.fn((options: IProgressOptions, task: (p: { report(): void }) => Promise<unknown>, onDidCancel?: unknown) => {
			calls.push({ options, onDidCancel });
			return task({ report: () => { } });
		}),
	} as unknown as IProgressService;
	return { service, calls };
}

describe('withDelayedNotificationProgress', () => {
	it('shows a cancellable status bar entry immediately and a cancellable notification after the default delay', async () => {
		const { service, calls } = createProgressService();
		await withDelayedNotificationProgress(service, { title: 'Updating' }, async () => { });

		expect(calls.map(c => c.options)).toEqual([
			{ location: ProgressLocation.Window, title: 'Updating', cancellable: true },
			{ location: ProgressLocation.Notification, title: 'Updating', cancellable: true, delay: DELAYED_NOTIFICATION_PROGRESS_DELAY_MS },
		]);
		expect(DELAYED_NOTIFICATION_PROGRESS_DELAY_MS).toBe(10_000);
	});

	it('honours cancellable and notificationDelay overrides', async () => {
		const { service, calls } = createProgressService();
		await withDelayedNotificationProgress(service, { title: 'T', cancellable: false, notificationDelay: 1234 }, async () => { });

		expect(calls[0].options).toMatchObject({ cancellable: false });
		expect(calls[1].options).toMatchObject({ cancellable: false, delay: 1234 });
	});

	it('returns the task result and passes onDidCancel to both the status bar entry and the notification', async () => {
		const { service, calls } = createProgressService();
		const onDidCancel = vi.fn();
		const result = await withDelayedNotificationProgress(service, { title: 'T' }, async () => 42, onDidCancel);

		expect(result).toBe(42);
		expect(calls[0].onDidCancel).toBe(onDidCancel);
		expect(calls[1].onDidCancel).toBe(onDidCancel);
	});

	it('propagates task errors', async () => {
		const { service } = createProgressService();
		await expect(withDelayedNotificationProgress(service, { title: 'T' }, async () => { throw new Error('boom'); }))
			.rejects.toThrow('boom');
	});
});
