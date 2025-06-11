/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '..';

export type Setting = [key: string, value: string];

export class SettingsFixture {

	constructor(private app: Application) { }

	/**
	 * Set a single setting in the settings editor
	 * NOTE: You may need to reload the window or restart the application for the settings to take
	 * effect. Please also remember to unset the setting after to avoid affecting other tests.
	 * @param setting The setting ID to set
	 * @param value The value to set the setting to
	 */
	async set(setting: Setting, restartApp = false) {
		await this.setMultipleUserSettings([setting], restartApp);
	}

	/**
	 * Sets multiple settings in the settings editor
	 * NOTE: You may need to reload the window or restart the application for the settings to take
	 * effect. Please also remember to unset the setting after to avoid affecting other tests.
	 * @param settings Array of key-value pairs to set in the user settings
	 */
	async setMultipleUserSettings(settings: Setting[] = [], restartApp = false) {
		if (settings.length === 0) {
			// No settings were provided
			return;
		}

		// Set the settings
		await this.app.workbench.settings.addUserSettings([
			// Set editor.wordWrap to "on" to avoid issues with long settings.
			// See test/e2e/pages/settings.ts for more explanation.
			['editor.wordWrap', '"on"'],
			...settings
		]);

		// Close the settings editor
		await this.app.workbench.quickaccess.runCommand('workbench.action.closeActiveEditor');

		// Restart the application if requested, to apply the settings
		if (restartApp) {
			await this.app.restart();
		}
	}

	/**
	 * Unset all settings in the settings editor.
	 */
	async unset(restartApp = false) {
		// Clear all user settings
		await this.app.workbench.settings.clearUserSettings();

		// Restart the application if requested, to apply the settings
		if (restartApp) {
			await this.app.restart();
		}
	}
}
