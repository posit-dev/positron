/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import path from 'path';
import { UserSettingsFileManager } from '../userSettingsFileManager';

function getVSCodeSettingsPath(): string {
	const home = os.homedir();
	const platform = process.platform;

	if (platform === 'win32') {
		if (process.env.APPDATA) {
			return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
		} else if (process.env.USERPROFILE) {
			return path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
		} else {
			return path.join(home, 'AppData', 'Roaming', 'Code', 'User', 'settings.json');
		}
	} else if (platform === 'darwin') {
		return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
	} else {
		const configHome = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
		return path.join(configHome, 'Code', 'User', 'settings.json');
	}
}

const vscodeSettingsPath = getVSCodeSettingsPath();

export const vsCodeSettings = new UserSettingsFileManager(vscodeSettingsPath, () => ({
	'test': 'vs-code-settings',
	'editor.fontSize': 8,
	'workbench.colorTheme': 'Default Dark',
}));
