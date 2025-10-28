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
	await app.workbench.sessions.select(pythonSessionId);

	await app.code.wait(2000); // give ipykernel time to startup

	await app.workbench.console.pasteCodeToConsole(`x=${value}`);
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.clearButton.click();

	await app.workbench.sessions.select(rSessionId);

	await app.code.wait(2000); // wait a little for python var to get to R

	await app.workbench.console.pasteCodeToConsole('y<-reticulate::py$x');
	await app.workbench.console.sendEnterKey();

	await app.workbench.console.clearButton.click();

	await app.workbench.layouts.enterLayout('fullSizedAuxBar');

	await expect(async () => {
		const variablesMap = await app.workbench.variables.getFlatVariables();
		expect(variablesMap.get('y')).toStrictEqual({ value: value, type: 'int' });
	}).toPass({ timeout: 10000 });

	await app.workbench.layouts.enterLayout('stacked');

	// Create a variable in R and expect to be able to access it from Python
	await app.workbench.console.pasteCodeToConsole(`y <- ${value2}L`);
	await app.workbench.console.sendEnterKey();

	// Executing reticulate::repl_python() should not start a new interpreter
	// but should move focus to the reticulate interpreter
	await app.workbench.console.pasteCodeToConsole(`reticulate::repl_python(input = "z = ${value3}")`);
	await app.workbench.console.sendEnterKey();

	// Expect that focus changed to the reticulate console
	await expect(async () => {
		try {
			await app.workbench.sessions.expectSessionPickerToBe(pythonSessionId);
		} catch (e) {
			await app.code.wait(1000); // a little time for session picker to be updated
			throw e;
		}
	}).toPass({ timeout: 20000 });

	await app.workbench.console.pasteCodeToConsole('print(r.y)');
	await app.workbench.console.sendEnterKey();
	await app.workbench.console.waitForConsoleContents(value2);

	await app.workbench.console.pasteCodeToConsole('print(z)');
	await app.workbench.console.sendEnterKey();
	await app.workbench.console.waitForConsoleContents(value3);
}
