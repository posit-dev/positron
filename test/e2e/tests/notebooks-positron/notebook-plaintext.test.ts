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
								s: 4,
								t: 'Str'
							}
						]
					],
					s: 5,
					t: 'Header'
				}
			],
			meta: {
				title: {
					c: [
						{
							c: 'Test',
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
