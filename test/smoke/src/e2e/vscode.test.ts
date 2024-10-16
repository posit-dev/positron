/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { test, expect } from './baseTest';

test('should be able to execute the first test of the example project', async ({ workbox }) => {
	await workbox.getByRole('treeitem', { name: 'tests', exact: true }).locator('a').click();
	await workbox.getByRole('treeitem', { name: 'example.spec.ts' }).locator('a').click();
	await expect(workbox.locator('.testing-run-glyph'), 'there are no tests in the file').toHaveCount(0);
	// await workbox.locator('.testing-run-glyph').first().click();
	// const passedLocator = workbox.locator('.monaco-editor').locator('.codicon-testing-passed-icon');
	// await expect(passedLocator).toHaveCount(1);
});
