/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'path';
import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

const FILENAME = 'fast-execution.r';

test.describe('R Fast Execution', { tag: [tags.WEB, tags.EDITOR, tags.WIN] }, () => {
	test('Verify fast execution is not out of order', {
		tag: [tags.ARK]
	}, async function ({ app, r }) {
		await app.positron.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'fast-statement-execution', FILENAME));

		let previousTop = -1;

		// Note that this outer loop iterates 10 times.  This is because the length of the
		// file fast-execution.r is 10 lines.  We want to be sure to send a Control+Enter
		// for every line of the file
		for (let i = 0; i < 10; i++) {
			let currentTop = await app.positron.editor.getCurrentLineTop();
			let retries = 20;

			// Note that top is a measurement of the distance from the top of the editor
			// to the top of the current line.  By monitoring the top value, we can determine
			// if the editor is advancing to the next line.  Without this check, the test
			// would send Control+Enter many times to the first line of the file and not
			// perform the desired test.
			while (currentTop === previousTop && retries > 0) {
				currentTop = await app.positron.editor.getCurrentLineTop();
				retries--;
			}

			previousTop = currentTop;

			await app.code.driver.page.keyboard.press('Control+Enter');
		}

		await app.positron.variables.waitForVariableRow('c');
		await app.positron.layouts.enterLayout('fullSizedAuxBar');
		const variablesMap = await app.positron.variables.getFlatVariables();

		expect(variablesMap.get('x')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('y')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('z')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('a')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('b')).toStrictEqual({ value: '1', type: 'dbl' });
		expect(variablesMap.get('c')).toStrictEqual({ value: '1', type: 'dbl' });
	});
});
