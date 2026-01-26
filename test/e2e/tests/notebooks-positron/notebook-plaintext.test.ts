/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { tags } from '../_test.setup';
import { test } from './_test.setup.js';

test.use({
	suiteId: __filename
});

test.describe('Positron Notebooks: Plaintext Notebooks', {
	tag: [tags.QUARTO, tags.WEB, tags.WIN]
}, () => {

	test.beforeAll(async function ({ settings }) {
		// Enable the experimental plaintext notebook setting
		await settings.set({ 'positron.notebook.plainText.enable': true });
	});

	test.skip('plaintext notebooks are disabled when setting is off', async function ({ app, settings }) {
	});

	test('Positron Notebook is not in Open With menu for .qmd files when setting is off', async function ({ app, settings }) {
		const { quickaccess, quickInput } = app.workbench;
		const path = await import('path');

		// First disable the setting
		await settings.set({ 'positron.notebook.plainText.enable': false });

		// Open the .qmd file using quick access
		const qmdFilePath = path.join(app.workspacePathOrFolder, 'workspaces/quarto_basic/quarto_basic.qmd');
		await quickaccess.openFile(qmdFilePath, false);

		// Use the "Reopen Editor With..." command to check available editors
		await quickaccess.runCommand('workbench.action.reopenWithEditor', { keepOpen: true });

		// Wait for the quickpick to open
		await quickInput.waitForQuickInputOpened();

		// Verify "Positron Notebook" is NOT in the list of options
		await quickInput.waitForQuickInputElements((names) => {
			const hasPositronNotebook = names.some(name =>
				name.toLowerCase().includes('positron notebook')
			);
			expect(hasPositronNotebook).toBe(false);
			return true;
		});

		await quickInput.closeQuickInput();

		// Re-enable for other tests
		await settings.set({ 'positron.notebook.plainText.enable': true });
	});

	test('parse .qmd command returns expected result', async function ({ app }) {
		const { clipboard, quickInput } = app.workbench;

		await app.workbench.quickaccess.runCommand('positron-qmd.parseQmd');

		// Type qmd content into the input box
		await quickInput.waitForQuickInputOpened();
		await quickInput.type('---\\ntitle: Test\\n---\\n\\n# Hello');
		await app.code.driver.page.keyboard.press('Enter');

		// Verify clipboard contents
		await expect.poll(async () => {
			const result = await clipboard.getClipboardText();
			if (!result) { return null; }
			try {
				return JSON.parse(result);
			} catch {
				return null;
			}
		}).toEqual({
			astContext: {
				files: [
					{
						line_breaks: [
							3,
							15,
							19,
							20,
							28
						],
						name: '<input>',
						total_length: 29
					}
				],
				metaTopLevelKeySources: {
					title: 6
				},
				sourceInfoPool: [
					{
						d: 0,
						r: [
							0,
							20
						],
						t: 0
					},
					{
						d: 0,
						r: [
							4,
							15
						],
						t: 1
					},
					{
						d: 1,
						r: [
							7,
							11
						],
						t: 1
					},
					{
						d: 2,
						r: [
							0,
							4
						],
						t: 1
					},
					{
						d: 0,
						r: [
							23,
							28
						],
						t: 0
					},
					{
						d: 0,
						r: [
							21,
							29
						],
						t: 0
					},
					{
						d: 1,
						r: [
							0,
							5
						],
						t: 1
					}
				]
			},
			blocks: [
				{
					attrS: {
						classes: [],
						id: null,
						kvs: []
					},
					c: [
						1,
						[
							'hello',
							[],
							[]
						],
						[
							{
								c: 'Hello',
								l: {
									b: { c: 3, l: 5, o: 23 },
									e: { c: 8, l: 5, o: 28 },
									f: 0
								},
								s: 4,
								t: 'Str'
							}
						]
					],
					l: {
						b: { c: 1, l: 5, o: 21 },
						e: { c: 1, l: 6, o: 29 },
						f: 0
					},
					s: 5,
					t: 'Header'
				}
			],
			meta: {
				title: {
					c: [
						{
							c: 'Test',
							l: {
								b: { c: 8, l: 2, o: 11 },
								e: { c: 12, l: 2, o: 15 },
								f: 0
							},
							s: 3,
							t: 'Str'
						}
					],
					s: 2,
					t: 'MetaInlines'
				}
			},
			'pandoc-api-version': [
				1,
				23,
				1
			]
		});
	});
});
