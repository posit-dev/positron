/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../application';

export type UserSetting = [key: string, value: string];

export class PositronUserSettingsFixtures {

	constructor(private app: Application) { }

	/**
	 * Set a single user setting in the settings editor
	 * NOTE: You may need to reload the window or restart the application for the settings to take
	 * effect. Please also remember to unset the setting after to avoid affecting other tests.
	 * @param setting The setting ID to set
	 * @param value The value to set the setting to
	 */
	async setUserSetting(setting: UserSetting, restartApp = false) {
		await this.setUserSettings([setting], restartApp);
	}

	/**
	 * Sets user settings in the settings editor
	 * NOTE: You may need to reload the window or restart the application for the settings to take
	 * effect. Please also remember to unset the setting after to avoid affecting other tests.
	 * @param settings Array of key-value pairs to set in the user settings
	 */
	async setUserSettings(settings: UserSetting[] = [], restartApp = false) {
		if (settings.length === 0) {
			// No settings were provided
			return;
		}

		// Set the user settings
		await this.app.workbench.settingsEditor.addUserSettings([
			// Set editor.wordWrap to "on" to avoid issues with long settings.
			// See test/automation/src/settings.ts for more explanation.
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
	 * Unset all user settings in the settings editor.
	 */
	async unsetUserSettings(restartApp = false) {
		// Clear all user settings
		await this.app.workbench.settingsEditor.clearUserSettings();

		// Restart the application if requested, to apply the settings
		if (restartApp) {
			await this.app.restart();
		}
	}
}
