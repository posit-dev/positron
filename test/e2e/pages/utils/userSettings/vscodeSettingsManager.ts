/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import os from 'os';
import path from 'path';
import { UserSettingsFileManager } from '../userSettingsFileManager';

const home = os.homedir();
const vscodeSettingsPath =
	process.platform === 'win32'
		? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'settings.json')
		: process.platform === 'darwin'
			? path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json')
			: path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Code', 'User', 'settings.json');

export const vsCodeSettings = new UserSettingsFileManager(vscodeSettingsPath, () => ({
	'test': 'vs-code-settings',
	'editor.fontSize': 8,
	'workbench.colorTheme': 'Default Dark',
}));
