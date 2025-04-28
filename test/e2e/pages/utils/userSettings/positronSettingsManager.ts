/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// utils/settings-managers/positronSettingsManager.ts
import path from 'path';
import { UserSettingsFileManager } from '../userSettingsFileManager';

export function createPositronSettingsManager(userDataDir: string): UserSettingsFileManager {
	const settingsPath = path.join(userDataDir, 'User', 'settings.json');

	return new UserSettingsFileManager(settingsPath, () => ({
		'test': 'positron-settings',
		'editor.fontSize': 16,
		'workbench.colorTheme': 'Default Light+',
	}));
}
