/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { IPathService } from '../../../../services/path/common/pathService.js';
import { getCodeSettingsPathNative } from "../../browser/helpers.js";
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TestPathService } from '../../../../test/browser/workbenchTestServices.js';
import { URI } from '../../../../../base/common/uri.js';
import assert from 'assert';
import { isLinux, isMacintosh, isWindows, OperatingSystem } from '../../../../../base/common/platform.js';

suite('Positron - PositronWelcome Contribution Helpers', () => {
	const testPosix = isMacintosh || isLinux ? test : test.skip;
	const testWindows = isWindows ? test : test.skip;
	// const testWeb = isWeb ? test : test.skip;

	ensureNoDisposablesAreLeakedInTestSuite();

	testPosix('VSCode settings path: ensure correct Linux', async () => {
		const pathService: IPathService = new TestPathService(
			URI.parse('/home/test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Linux);
		assert.deepEqual(path, URI.parse('/home/test/.config/Code/User/settings.json'));
	});

	testPosix('VSCode settings path: ensure correct MacOS', async () => {
		const pathService: IPathService = new TestPathService(
			URI.parse('/Users/test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Macintosh);
		assert.deepEqual(path, URI.parse('/Users/test/Library/Application Support/Code/User/settings.json'));
	});

	testWindows('VSCode settings path: ensure correct Windows', async () => {
		const pathService: IPathService = new TestPathService(
			URI.file('C:\\Users\\test')
		);
		const path = await getCodeSettingsPathNative(pathService, OperatingSystem.Windows);
		assert.deepEqual(path, URI.file('C:\\Users\\test\\AppData\\Roaming\\Code\\User\\settings.json'));
	});

	// testWeb('VSCode settings path: ensure correct Workbench - with env var', async () => {
	// 	env['RS_VSCODE_USER_DATA_DIR'] = '/workbench/test';

	// 	const pathService: IPathService = new TestPathService(
	// 		URI.parse('/should/not/use')
	// 	);
	// 	const path = await getCodeSettingsPathWeb(pathService, OperatingSystem.Linux);
	// 	assert.deepEqual(path, URI.parse('/workbench/test/User/settings.json'));
	// });

	// testWeb('VSCode settings path: ensure correct Workbench - without env var', async () => {
	// 	const pathService: IPathService = new TestPathService(
	// 		URI.parse('/workbench/test-novar')
	// 	);

	// 	const path = await getCodeSettingsPathWeb(pathService, OperatingSystem.Linux);
	// 	assert.deepEqual(path, URI.parse('/workbench/test-novar/User/settings.json'));
	// });
});
