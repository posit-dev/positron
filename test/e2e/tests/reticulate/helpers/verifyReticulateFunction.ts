/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application } from '../../../infra/index.js';
import { expect } from '../../_test.setup.js';

export const RETICULATE_SESSION = 'Python (reticulate)';

export async function verifyReticulateFunctionality(
	app: Application,
	rSessionId: string,
	pythonSessionId: string = 'Python (reticulate)',
	xValue = '200',
	yValue = '400',
	zValue = '6'): Promise<void> {
	const { console, sessions, variables } = app.workbench;

	await app.code.driver.page.waitForTimeout(20000);

	// Create a variable x in Python session
	await expect(async () => {
		await console.executeCode('Python', `x = ${xValue}`);
		await variables.expectVariableToBe('x', xValue, 2000);
	}, 'Can create variable in Python session').toPass();

	// Switch to the R session and create an R variable `y` by accessing the Python
	// variable `x` through reticulate.
	await expect(async () => {
		await console.executeCode('R', 'y<-reticulate::py$x');
		await variables.expectVariableToBe('y', xValue, 2000);
	}, 'Can access Python variable x from R').toPass();

	// Clear the console again and re-check to ensure the R-side variable persists.
	await console.clearButton.click();
	await variables.expectVariableToBe('y', xValue);

	// Verify able to overwrite the R variable `y` with an integer literal on the R side.
	await expect(async () => {
		await console.executeCode('R', `y <- ${yValue}L`);
		await variables.expectVariableToBe('y', yValue, 2000);
	}, 'Can overwrite the R variable').toPass();

	// Verify executing reticulate::repl_python() moves focus to the reticulate session
	await console.pasteCodeToConsole(`reticulate::repl_python(input = "z = ${zValue}")`, true);
	await sessions.expectSessionPickerToBe(pythonSessionId, 20000);
	await console.clearButton.click();

	// Print the R variable r.y (should reflect the R-side value) and ensure it appears in the console
	await expect(async () => {
		await console.executeCode('Python', 'print(r.y)');
		await console.waitForConsoleContents(yValue, { timeout: 5000 });
	}, 'Can print the R variable r.y from Python').toPass();

	// Print the Python variable z (created via repl_python) and ensure it appears as well
	await expect(async () => {
		await console.executeCode('Python', 'print(z)');
		await console.waitForConsoleContents(zValue, { timeout: 5000 });
	}, 'Can print the Python variable z from Python').toPass();
}
