/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IUpdate } from '../../../../../platform/update/common/update.js';
import { UpdateNotificationThrottle } from '../../common/positronUpdateNotificationThrottle.js';

describe('UpdateNotificationThrottle', () => {
	function update(version: string, productVersion?: string): IUpdate {
		return { version, productVersion };
	}

	it('suppresses every repeat of the same version at the same stage', () => {
		const throttle = new UpdateNotificationThrottle();
		const pending = update('commit-one', '2026.09.0');

		// A deadlocked installer can drop the state machine back to `ready`
		// indefinitely; only the first pass should reach the user.
		const results = Array.from({ length: 5 }, () => throttle.shouldNotify('ready', pending));

		expect(results).toEqual([true, false, false, false, false]);
	});

	it('notifies again once a newer version becomes pending', () => {
		const throttle = new UpdateNotificationThrottle();
		throttle.shouldNotify('ready', update('commit-one', '2026.09.0'));

		expect(throttle.shouldNotify('ready', update('commit-two', '2026.09.1'))).toBe(true);
	});

	it('tracks stages independently, so the downloaded toast does not swallow the ready toast', () => {
		const throttle = new UpdateNotificationThrottle();
		const pending = update('commit-one', '2026.09.0');
		throttle.shouldNotify('downloaded', pending);

		expect(throttle.shouldNotify('ready', pending)).toBe(true);
	});

	it('keys on productVersion when present, ignoring the raw version', () => {
		const throttle = new UpdateNotificationThrottle();
		throttle.shouldNotify('ready', update('commit-one', '2026.09.0'));

		expect(throttle.shouldNotify('ready', update('commit-two', '2026.09.0'))).toBe(false);
	});

	it('falls back to the raw version when productVersion is absent', () => {
		const throttle = new UpdateNotificationThrottle();
		throttle.shouldNotify('ready', update('commit-one'));

		expect([
			throttle.shouldNotify('ready', update('commit-one')),
			throttle.shouldNotify('ready', update('commit-two')),
		]).toEqual([false, true]);
	});
});
