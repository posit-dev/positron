/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application } from '../../../infra/index.js';

export async function verifyReticulateFunctionality(
	app: Application,
	rSessionId: string,
	pythonSessionId: string = 'Python (reticulate)',
	value = '200',
	value2 = '400',
	value3 = '6'): Promise<void> {
	// Verify that reticulate is installed
	// Create a variable in Python and expect to be able to access it from R
	await app.positron.sessions.select(pythonSessionId);

	await app.positron.console.pasteCodeToConsole(`x=${value}`);
	await app.positron.console.sendEnterKey();

	await app.positron.console.clearButton.click();

	await app.positron.sessions.select(rSessionId);

	await app.positron.console.pasteCodeToConsole('y<-reticulate::py$x');
	await app.positron.console.sendEnterKey();

	await app.positron.console.clearButton.click();

	await app.positron.layouts.enterLayout('fullSizedAuxBar');

	await expect(async () => {
		const variablesMap = await app.positron.variables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: value, type: 'int' });
	}).toPass({ timeout: 10000 });

	await app.positron.layouts.enterLayout('stacked');

	// Create a variable in R and expect to be able to access it from Python
	await app.positron.console.pasteCodeToConsole(`y <- ${value2}L`);
	await app.positron.console.sendEnterKey();

	// Executing reticulate::repl_python() should not start a new interpreter
	// but should move focus to the reticulate interpreter
	await app.positron.console.pasteCodeToConsole(`reticulate::repl_python(input = "z = ${value3}")`);
	await app.positron.console.sendEnterKey();

	// Expect that focus changed to the reticulate console
	await expect(async () => {
		try {
			await app.positron.sessions.expectSessionPickerToBe(pythonSessionId);
		} catch (e) {
			await app.code.wait(1000); // a little time for session picker to be updated
			throw e;
		}
	}).toPass({ timeout: 20000 });

	await app.positron.console.pasteCodeToConsole('print(r.y)');
	await app.positron.console.sendEnterKey();
	await app.positron.console.waitForConsoleContents(value2);

	await app.positron.console.pasteCodeToConsole('print(z)');
	await app.positron.console.sendEnterKey();
	await app.positron.console.waitForConsoleContents(value3);
}
