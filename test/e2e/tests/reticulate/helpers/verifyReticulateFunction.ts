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
	xValue = '200',
	yValue = '400',
	zValue = '6'): Promise<void> {
	const { console, sessions, variables } = app.workbench;

	// Create a variable x in Python session
	await sessions.select(pythonSessionId, true);
	await app.code.wait(2000); // give ipykernel time to startup
	await console.pasteCodeToConsole(`x=${xValue}`, true);
	await variables.expectVariableToBe('x', xValue);

	// Switch to the R session and create an R variable `y` by accessing the Python
	// variable `x` through reticulate.
	await console.clearButton.click();
	await sessions.select(rSessionId);
	await app.code.wait(2000); // wait a little for python var to get to R
	await console.pasteCodeToConsole('y<-reticulate::py$x', true);
	await variables.expectVariableToBe('y', xValue);

	// Clear the console again and re-check to ensure the R-side variable persists.
	await console.clearButton.click();
	await variables.expectVariableToBe('y', xValue);

	// Verify able to overwrite the R variable `y` with an integer literal on the R side.
	await console.pasteCodeToConsole(`y <- ${yValue}L`, true);
	await variables.expectVariableToBe('y', yValue);

	// Verify executing reticulate::repl_python() moves focus to the reticulate session
	await console.pasteCodeToConsole(`reticulate::repl_python(input = "z = ${zValue}")`, true);
	await sessions.expectSessionPickerToBe(pythonSessionId, 20000);

	// Print the R variable r.y (should reflect the R-side value) and ensure it appears in the console
	await console.pasteCodeToConsole('print(r.y)', true);
	await ensureConsoleDataPresent(app, yValue);

	// Print the Python variable z (created via repl_python) and ensure it appears as well
	await console.pasteCodeToConsole('print(z)', true);
	await ensureConsoleDataPresent(app, zValue);
}

async function ensureConsoleDataPresent(app: Application, value: string) {

	await expect(async () => {
		try {
			await app.workbench.console.waitForConsoleContents(value);
		} catch (e) {
			console.log('Resending enter key');
			await app.workbench.console.sendEnterKey();
			throw e;
		}
	}).toPass({ timeout: 10000 });
}
