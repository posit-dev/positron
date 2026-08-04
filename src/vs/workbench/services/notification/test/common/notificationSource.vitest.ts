/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { InMemoryStorageService } from '../../../../../platform/storage/common/storage.js';
import { INotificationSource, NotificationPriority, NotificationsFilter, Severity } from '../../../../../platform/notification/common/notification.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { NotificationService } from '../../common/notificationService.js';

/**
 * Covers Positron's change to forward `source` from `IPromptOptions` through
 * `NotificationService.prompt()`. Without it, prompts could not participate in
 * do-not-disturb-by-source filtering, so a caller had no way to let users mute
 * a category of notifications.
 *
 * The two tests below exercise the two distinct paths that a forwarded source
 * feeds: the filter check when a notification is created, and the automatic
 * source registration that populates the do-not-disturb picker.
 */
describe('NotificationService.prompt source forwarding', () => {
	const store = ensureNoLeakedDisposables();

	const source: INotificationSource = { id: 'test.source', label: 'Test Source' };

	function createService() {
		return store.add(new NotificationService(store.add(new InMemoryStorageService())));
	}

	function prompt(service: NotificationService, priority: NotificationPriority) {
		const handle = service.prompt(
			Severity.Info,
			'A message with a mutable source.',
			[{ label: 'Do Something', run: () => { } }],
			{ priority, sticky: true, source }
		);

		// Read the view item before closing; closing removes it from the model.
		const item = service.model.notifications[0];
		store.add(toDisposable(() => handle.close()));

		return item;
	}

	it('silences a prompt when its source is filtered', () => {
		const service = createService();
		service.setFilter({ ...source, filter: NotificationsFilter.ERROR });

		// SILENT keeps the notification in the notifications center but suppresses the
		// toast, and wins over `sticky`.
		expect(prompt(service, NotificationPriority.OPTIONAL).priority).toBe(NotificationPriority.SILENT);
	});

	it('registers the source so it appears in the do-not-disturb filter list', () => {
		const service = createService();
		prompt(service, NotificationPriority.OPTIONAL);

		expect(service.getFilters()).toEqual([
			{ id: 'test.source', label: 'Test Source', filter: NotificationsFilter.OFF }
		]);
	});
});
