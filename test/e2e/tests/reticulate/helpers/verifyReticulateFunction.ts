/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Application } from '../../../infra/index.js';

export const RETICULATE_START_MSG = 'Creating the Reticulate Python session';

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
	await runCodeExpectVariable(app, `x=${xValue}`, { name: 'x', value: xValue });

	// Switch to the R session and create an R variable `y` by accessing the Python
	// variable `x` through reticulate.
	await console.clearButton.click();
	await sessions.select(rSessionId);
	await runCodeExpectVariable(app, 'y<-reticulate::py$x', { name: 'y', value: xValue });

	// Clear the console again and re-check to ensure the R-side variable persists.
	await console.clearButton.click();
	await variables.expectVariableToBe('y', xValue);

	// Verify able to overwrite the R variable `y` with an integer literal on the R side.
	await runCodeExpectVariable(app, `y <- ${yValue}L`, { name: 'y', value: yValue });

	// Verify executing reticulate::repl_python() moves focus to the reticulate session
	await console.pasteCodeToConsole(`reticulate::repl_python(input = "z = ${zValue}")`, true);
	await sessions.expectSessionPickerToBe(pythonSessionId, 20000);
	await console.clearButton.click();

	// Print the R variable r.y (should reflect the R-side value) and ensure it appears in the console
	await runCodeExpectOutput(app, 'print(r.y)', yValue);

	// Print the Python variable z (created via repl_python) and ensure it appears as well
	await runCodeExpectOutput(app, 'print(z)', zValue);
}

async function runCodeExpectVariable(app: Application, code: string, variable: { name: string; value: string } = { name: '', value: '' }) {
	const { console, variables } = app.workbench;
	await expect(async () => {
		await console.sendInterrupt();
		await console.pasteCodeToConsole(code, true);
		await variables.expectVariableToBe(variable.name, variable.value, 2000);
	}, 'wait for variable to be present').toPass({ timeout: 10000 });
}

async function runCodeExpectOutput(app: Application, commmand: string, value: string) {
	const { console } = app.workbench;

	await expect(async () => {
		await console.sendInterrupt();
		await console.pasteCodeToConsole(commmand, true);
		await console.waitForConsoleContents(value, { timeout: 2000 });
	}, 'run code and expect console output').toPass({ timeout: 10000 });
}
