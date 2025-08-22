/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path, { join } from 'path';
import * as fs from 'fs';

import { ApplicationOptions, copyFixtureFile } from '../../infra';
import { ROOT_PATH } from './constants';

export function UserDataDirFixture() {
	return async (options: ApplicationOptions) => {
		const userDir = options.web ? join(options.userDataDir, 'data', 'User') : join(options.userDataDir, 'User');
		process.env.PLAYWRIGHT_USER_DATA_DIR = userDir;

		// Copy keybindings and settings fixtures to the user data directory
		await copyFixtureFile('keybindings.json', userDir, true);

		const settingsFileName = 'settings.json';
		if (fs.existsSync('/.dockerenv')) {

			const fixturesDir = path.join(ROOT_PATH, 'test/e2e/fixtures');
			const settingsFile = path.join(fixturesDir, 'settings.json');

			const mergedSettings = {
				...JSON.parse(fs.readFileSync(settingsFile, 'utf8')),
				...JSON.parse(fs.readFileSync(path.join(fixturesDir, 'settingsDocker.json'), 'utf8')),
			};

			// Overwrite file
			fs.writeFileSync(settingsFile, JSON.stringify(mergedSettings, null, 2));
		}

		await copyFixtureFile(settingsFileName, userDir);

		return userDir;
	};
}
