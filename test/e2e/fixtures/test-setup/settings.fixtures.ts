/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';

/**
 * Settings fixture type for configuring application settings in tests.
 */
export type Settings = ReturnType<typeof SettingsFixture>;

export function SettingsFixture(app: Application) {
	const { userSettings: settings } = app.workbench;

	return {
		set: async (
			newSettings: Record<string, unknown>,
			options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }
		) => {
			const { reload = false, waitMs = 0, waitForReady = true, keepOpen = false } = options || {};

			await settings.set(newSettings, { keepOpen });

			if (reload === true || (reload === 'web' && app.web === true)) {
				// reloadWindow waits deterministically for the new page (navigation +
				// workbench restored), so no fixed sleep is needed here.
				await app.workbench.hotKeys.reloadWindow(false);
			}
			if (waitMs) {
				await app.code.driver.currentPage.waitForTimeout(waitMs); // wait for settings to take effect
			}

			if (waitForReady) {
				await app.workbench.sessions.expectNoStartUpMessaging();
			}
		},
		clear: () => settings.clear(),
		remove: (settingsToRemove: string[]) => settings.remove(settingsToRemove),
	};
}
