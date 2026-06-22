/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { INotificationService } from '../../../../../../platform/notification/common/notification.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { notifyTagResult } from '../../../browser/notebookCells/cellTagNotifications.js';

describe('notifyTagResult', () => {
	function setup() {
		const info = vi.fn();
		const notificationService = stubInterface<INotificationService>({ info });
		return { notificationService, info };
	}

	it('shows a tag-specific toast for a duplicate', () => {
		const { notificationService, info } = setup();
		notifyTagResult(notificationService, 'duplicate', 'wip');
		expect(info).toHaveBeenCalledWith(expect.stringContaining('wip'));
	});

	it('shows a generic toast for a failed write', () => {
		const { notificationService, info } = setup();
		notifyTagResult(notificationService, 'failed', 'wip');
		// The failure toast is operation-agnostic and omits the tag value.
		expect(info).toHaveBeenCalledWith(expect.stringContaining('Could not update'));
	});

	it('is silent for a successful write', () => {
		const { notificationService, info } = setup();
		notifyTagResult(notificationService, 'ok', 'wip');
		expect(info).not.toHaveBeenCalled();
	});
});
