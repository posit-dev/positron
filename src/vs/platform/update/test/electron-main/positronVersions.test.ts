/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { IUpdate } from '../../common/update.js';
import * as positronVersion from '../../electron-main/positronVersion.js';

suite('Positron Version', function () {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('UpdateService - compare update with build number to version without build number', () => {
		const update: IUpdate = { version: '2024.11.0-111' };
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.0'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.09.0'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.12.0'), false, 'update is older');

		const updateNoBuild: IUpdate = { version: '2024.11.0' };
		assert.strictEqual(positronVersion.hasUpdate(updateNoBuild, '2024.11.0-111'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(updateNoBuild, '2024.09.0-111'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(updateNoBuild, '2024.12.0-111'), false, 'update is older');
	});

	test('UpdateService - compare year version', () => {
		const update: IUpdate = { version: '2024.12.0-111' };
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.12.0-111'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(update, '2023.12.0-111'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(update, '2025.12.0-111'), false, 'update is older');
	});

	test('UpdateService - compare month version', () => {
		const update: IUpdate = { version: '2024.05.0-111' };
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.05.0-111'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.02.0-111'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.12.0-111'), false, 'update is older');
	});

	test('UpdateService - compare patch version', () => {
		const update: IUpdate = { version: '2024.11.10-18' };
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.10-18'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.0-18'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.12-18'), false, 'update is older');
	});

	test('UpdateService - compare build number', () => {
		const update: IUpdate = { version: '2024.11.1-18' };
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.1-18'), false, 'same version');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.1-10'), true, 'update is newer');
		assert.strictEqual(positronVersion.hasUpdate(update, '2024.11.1-20'), false, 'update is older');
	});

});
