/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />


import { IPathService } from '../../../../services/path/common/pathService.js';
import { getCodeSettingsPathNative } from "../../browser/helpers.js";
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { URI } from '../../../../../base/common/uri.js';
import { isLinux, isMacintosh, isWindows, OperatingSystem } from '../../../../../base/common/platform.js';
import { env } from '../../../../../base/common/process.js';

describe('Positron - PositronWelcome Contribution Helpers', () => {
	const testPosix = isMacintosh || isLinux ? it : it.skip;
	const testWindows = isWindows ? it : it.skip;
	// const testWeb = isWeb ? it : it.skip;

	createTestContainer().build();

	testPosix('VSCode settings path: ensure correct Linux', async () => {
		const oldXdgConfig = process.env.XDG_CONFIG_HOME;
		delete env.XDG_CONFIG_HOME;

		const pathService: IPathService = new TestPathService(
			URI.parse('/home/test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Linux);
		expect(path).toEqual(URI.parse('/home/test/.config/Code/User/settings.json'));
		env.XDG_CONFIG_HOME = oldXdgConfig;
	});

	testPosix('VSCode settings path: ensure correct MacOS', async () => {
		const pathService: IPathService = new TestPathService(
			URI.parse('/Users/test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Macintosh);
		expect(path).toEqual(URI.parse('/Users/test/Library/Application Support/Code/User/settings.json'));
	});

	testWindows('VSCode settings path: ensure correct Windows', async () => {
		const pathService: IPathService = new TestPathService(
			URI.file('C:\\Users\\test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Windows);
		expect(path).toEqual(URI.file('C:\\Users\\test\\AppData\\Roaming\\Code\\User\\settings.json'));
	});

	// testWeb('VSCode settings path: ensure correct Workbench - with env var', async () => {
	// 	env['RS_VSCODE_USER_DATA_DIR'] = '/workbench/test';

	// 	const pathService: IPathService = new TestPathService(
	// 		URI.parse('/should/not/use')
	// 	);
	// 	const path = await getCodeSettingsPathWeb(pathService, OperatingSystem.Linux);
	// 	expect(path).toEqual(URI.parse('/workbench/test/User/settings.json'));
	// });

	// testWeb('VSCode settings path: ensure correct Workbench - without env var', async () => {
	// 	const pathService: IPathService = new TestPathService(
	// 		URI.parse('/workbench/test-novar')
	// 	);

	// 	const path = await getCodeSettingsPathWeb(pathService, OperatingSystem.Linux);
	// 	expect(path).toEqual(URI.parse('/workbench/test-novar/User/settings.json'));
	// });
});
