/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Variables - Filters', { tag: [tags.WEB, tags.VARIABLES] }, () => {

	test.afterEach(async function ({ app }) {
		await app.workbench.layouts.enterLayout('stacked');
	});

	test('Setting filter text is reflected in the variables pane', async function ({ app, sessions }) {

		await sessions.start('r');
		await app.workbench.layouts.enterLayout('fullSizedAuxBar');
		await app.workbench.console.pasteCodeToConsole('hello <- 1; foo <- 2', true);

		const variables = app.workbench.variables;
		await expect(async () => {
			const vars = await variables.getFlatVariables();
			expect(vars.has('hello')).toBe(true);
			expect(vars.has('foo')).toBe(true);
		}).toPass({ timeout: 20000 });

		await variables.setFilterText('hello');
		await expect(async () => {
			const vars = await variables.getFlatVariables();
			expect(vars.has('hello')).toBe(true);
			expect(vars.has('foo')).toBe(false);
		}).toPass({ timeout: 20000 });

		await sessions.start('python');
		await app.workbench.console.pasteCodeToConsole('hello = 1; foo = 2', true);
		await expect(async () => {
			const vars = await variables.getFlatVariables();
			expect(vars.has('hello')).toBe(true);
			expect(vars.has('foo')).toBe(true);
		}).toPass({ timeout: 20000 });

		await variables.setFilterText('foo');
		await expect(async () => {
			const vars = await variables.getFlatVariables();
			expect(vars.has('hello')).toBe(false);
			expect(vars.has('foo')).toBe(true);
		}).toPass({ timeout: 20000 });

	});
});
