/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

// WEB and WIN padd in CI but not locally
test.describe('Tasks', {
	tag: [tags.TASKS]
}, () => {

	test('Python: Verify Basic Tasks Functionality', async function ({ app, python, openFile }) {

		await openFile(join('workspaces', 'nyc-flights-data-py', 'flights-data-frame.py'));

		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+B' : 'Control+Shift+B');

		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.selectQuickInputElementContaining('Run Python File');
		await app.workbench.quickInput.waitForQuickInputClosed();

		await app.workbench.terminal.waitForTerminalText('336776');

		await app.workbench.terminal.sendKeysToTerminal('Enter');
	});

	test('R: Verify Basic Tasks Functionality', async function ({ app, r, openFile }) {

		await openFile(join('workspaces', 'nyc-flights-data-r', 'flights-data-frame.r'));

		await app.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+B' : 'Control+Shift+B');

		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.selectQuickInputElementContaining('Run R File');
		await app.workbench.quickInput.waitForQuickInputClosed();

		await app.workbench.terminal.waitForTerminalText('336776');

		await app.workbench.terminal.sendKeysToTerminal('Enter');
	});
});
