/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../infra';

export function SettingsFixture(app: Application) {
	const { settings } = app.workbench;

	return {
		set: async (
			newSettings: Record<string, unknown>,
			options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }
		) => {
			const { reload = false, waitMs = 0, waitForReady = false, keepOpen = false } = options || {};

			await settings.set(newSettings, { keepOpen });

			if (reload === true || (reload === 'web' && app.web === true)) {
				await app.workbench.hotKeys.reloadWindow(false);
			}
			if (waitMs) {
				await app.code.driver.page.waitForTimeout(waitMs); // wait for settings to take effect
			}

			if (waitForReady || reload) {
				await app.code.driver.page.waitForTimeout(3000);
				await app.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
				await app.workbench.sessions.expectNoStartUpMessaging();
			}
		},
		clear: () => settings.clear(),
		remove: (settingsToRemove: string[]) => settings.remove(settingsToRemove),
	};
}
