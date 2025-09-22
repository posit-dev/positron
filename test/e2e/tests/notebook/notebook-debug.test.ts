/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test Cases
 *
 * | Test Name                                      | Debugging Features                     | Python concept to be debuggged           | Expected Output                     |
 * |------------------------------------------------|----------------------------------------|------------------------------------------|-------------------------------------|
 * Simple breakpoint and variable inspection        | Single breakpoint, continue            | Variable assignment, arithmetic          | 30                                  |
 * Multiple breakpoints with step controls          | Multiple breakpoints, continue         | Arithmetic with multiple vars            | 6                                   |
 * Function debugging with step over                | Breakpoint, step over, continue        | Arithmetic sequence                      | 13                                  |
 * Variable inspection with simple calculations     | Breakpoint, continue                   | Sum and difference                       | 15, 5                               |
 * Stack frame navigation with nested calls         | Breakpoint, inspect variables          | Arithmetic, frame vars                   | 6                                   |
 * String operations and concatenation debugging    | Breakpoint, step over, continue        | String concatenation                     | "Hello, Chris Mead"                 |
 * List operations and indexing debugging           | Breakpoint, continue                   | List indexing, sum                       | 6                                   |
 * Boolean logic and conditional expressions        | Breakpoint, step over, continue        | Comparison operators, boolean logic      | True                                |
 * Dictionary operations and key access             | Breakpoint, continue                   | Dict key access, string formatting       | "Alice is 30 years old"             |
 * Mathematical operations with multiple steps      | Breakpoint, step over (x2), continue   | Exponentiation, multistep arithmetic     | 60                                  |
 * Type conversion and string formatting            | Breakpoint, continue                   | str() conversion, string concatenation   | "The answer is 42 and pi is 3.14"   |
 *
 * NOT Covered:
 * Step Into / Step Out (issue with indentation is persisting)
 * Call stack navigation UI assertions (beyond grabbing variables)
 * Watch expressions / hover inspect
 * Breakpoint enable/disable, conditional breakpoints
 * Exceptions / error break behavior
 * Multi-cell debugging, re-run on edit, or stopping debug session
 *
 * PROBLEM to be addressed: even tests are always failing when suite is run at once, but they pass individually
 */


import { Application } from '../../infra/application.js';
import { test, tags } from '../_test.setup';
import { expect } from '@playwright/test';

test.use({ suiteId: __filename });

test.describe('Comprehensive Notebook Debugging Tests', {
	tag: [tags.DEBUG, tags.NOTEBOOKS, tags.WEB]
}, () => {

	test.beforeEach(async ({ app }) => {
		await app.workbench.notebooks.createNewNotebook();
		await app.workbench.notebooks.selectInterpreter('Python');
	});

	test.afterEach(async ({ app }) => {
		await app.workbench.notebooks.closeNotebookWithoutSaving();
	});

	test('Python - Simple breakpoint and variable inspection', async ({ app }) => {
		const code = [
			'x = 10',
			'y = 20',
			'result = x + y',
			'print(result)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(3);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await app.code.wait(3000);
		await expect(app.workbench.notebooks.frameLocator.locator('text=30')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(3);
	});

	test('Python - Multiple breakpoints with step controls', async ({ app }) => {
		const code = [
			'a = 1',
			'b = 2',
			'c = 3',
			'd = a + b + c',
			'print(d)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(2);
		await app.workbench.debug.setBreakpointOnLine(4, 1);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await app.workbench.debug.expectCurrentLineIndicatorVisible();
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=6')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(2);
		await app.workbench.debug.unSetBreakpointOnLine(4);
	});

	test('Python - Function debugging with step over', async ({ app }) => {
		const code = [
			'x = 5',
			'y = x * 2',
			'z = y + 3',
			'print(z)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(2);
		await debugNotebook(app);
		await app.workbench.debug.stepOver();
		await app.code.wait(1000);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=13')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(2);
	});

	test('Python - Variable inspection with simple calculations', async ({ app }) => {
		const code = [
			'num1 = 10',
			'num2 = 5',
			'sum_val = num1 + num2',
			'diff_val = num1 - num2',
			'print(sum_val)',
			'print(diff_val)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(3);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=15')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(3);
	});

	test('Python - Stack frame navigation with nested calls', async ({ app }) => {
		const code = [
			'a = 1',
			'b = 2',
			'c = a + b',
			'd = c * 2',
			'print(d)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(3);
		await debugNotebook(app);
		const vars = await app.workbench.debug.getVariables();
		console.log('Variables:', vars);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=6')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(3);
	});

	test('Python - String operations and concatenation debugging', async ({ app }) => {
		const code = [
			'first_name = "Chris"',
			'last_name = "Mead"',
			'full_name = first_name + " " + last_name',
			'greeting = "Hello, " + full_name',
			'print(greeting)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(3);
		await debugNotebook(app);
		await app.workbench.debug.stepOver();
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=Hello, Chris Mead')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(3);
	});

	test('Python - List operations and indexing debugging', async ({ app }) => {
		const code = [
			'numbers = [1, 2, 3, 4, 5]',
			'first = numbers[0]',
			'last = numbers[-1]',
			'sum_result = first + last',
			'print(sum_result)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(2);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=6')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(2);
	});

	test('Python - Boolean logic and conditional expressions', async ({ app }) => {
		const code = [
			'x = 15',
			'y = 10',
			'is_greater = x > y',
			'is_equal = x == y',
			'result = is_greater and not is_equal',
			'print(result)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(5);
		await debugNotebook(app);
		await app.workbench.debug.stepOver();
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=True')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(5);
	});

	test('Python - Dictionary operations and key access', async ({ app }) => {
		const code = [
			'person = {"name": "Alice", "age": 30}',
			'name = person["name"]',
			'age = person["age"]',
			'info = name + " is " + str(age) + " years old"',
			'print(info)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(2);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=Alice is 30 years old')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(2);
	});

	test('Python - Mathematical operations with multiple steps', async ({ app }) => {
		const code = [
			'base = 5',
			'power = 2',
			'squared = base ** power',
			'doubled = squared * 2',
			'final = doubled + 10',
			'print(final)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(3);
		await debugNotebook(app);
		await app.workbench.debug.stepOver();
		await app.workbench.debug.stepOver();
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=60')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(3);
	});

	test('Python - Type conversion and string formatting', async ({ app }) => {
		const code = [
			'number = 42',
			'float_num = 3.14',
			'text = "The answer is"',
			'formatted = text + " " + str(number) + " and pi is " + str(float_num)',
			'print(formatted)'
		].join('\n');

		await app.workbench.notebooks.addCodeToCellAtIndex(code, 0);
		await app.workbench.debug.setBreakpointOnLine(4);
		await debugNotebook(app);
		await app.workbench.debug.continue();
		await expect(app.workbench.notebooks.frameLocator.locator('text=The answer is 42 and pi is 3.14')).toBeVisible();
		await app.workbench.debug.unSetBreakpointOnLine(4);
	});
});

async function debugNotebook(app: Application): Promise<void> {
	await test.step('Debug notebook', async () => {

		await expect(app.code.driver.page.locator('.positron-variables-container').locator('text=No Variables have been created')).toBeVisible();
		await app.workbench.quickaccess.runCommand('notebook.debugCell');
		await app.workbench.debug.expectCurrentLineIndicatorVisible(2000);
	});
}
