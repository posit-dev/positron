/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';
import { join } from 'path';
import { Application } from '../../infra';

test.use({
	suiteId: __filename
});

test.describe('Python Debugging', {
	tag: [tags.DEBUG, tags.WEB, tags.WIN]
}, () => {

	test('Python - Verify Basic Script Debugging', async function ({ app, python, openFile }) {

		await test.step('Open file, set breakpoint and start debugging', async () => {
			await openFile(join('workspaces', 'chinook-db-py', 'chinook-sqlite.py'));

			await app.positron.debug.setBreakpointOnLine(6);

			await app.positron.debug.startDebugging();
		});

		const requiredStrings = ["conn", "data_file_path", "os", "pd", "sqlite3"];
		await test.step('Validate initial variable set', async () => {

			await validateExpectedVariables(app, requiredStrings);
		});

		requiredStrings.push("cur");
		await test.step('Step over and validate variable set with new member', async () => {
			await app.positron.debug.stepOver();

			await validateExpectedVariables(app, requiredStrings);
		});

		await test.step('Validate current stack', async () => {
			const stack = await app.positron.debug.getStack();

			expect(stack[0]).toMatchObject({
				name: "chinook-sqlite.py",
				lineNumber: 7
			});
		});

		const internalRequiredStrings = ["columns", "copy", "data", "dtype", "index", "self"];
		await test.step('Step over twice, then into and validate internal variables', async () => {
			await app.positron.debug.stepOver();
			await app.positron.debug.stepOver();
			await app.positron.debug.stepInto();

			await validateExpectedVariables(app, internalRequiredStrings);
		});

		await test.step('Validate current internal stack', async () => {
			const stack = await app.positron.debug.getStack();

			expect(stack[0]).toMatchObject({
				name: "frame.py",
				lineNumber: 702
			});

			expect(stack[1]).toMatchObject({
				name: "chinook-sqlite.py",
				lineNumber: 9
			});
		});

		await test.step('Step out, continue and wait completion', async () => {
			await app.positron.debug.stepOut();
			await app.positron.debug.continue();

			await expect(async () => {
				const stack = await app.positron.debug.getStack();
				expect(stack.length).toBe(0);
			}).toPass({ intervals: [1_000], timeout: 60000 });
		});
	});
});

async function validateExpectedVariables(app: Application, expectedVariables: string[]): Promise<void> {
	await expect(async () => {
		const variables = await app.positron.debug.getVariables();
		expectedVariables.forEach(prefix => {
			expect(variables.some(line => line.startsWith(prefix))).toBeTruthy();
		});
	}).toPass({ intervals: [1_000], timeout: 60000 });
}

