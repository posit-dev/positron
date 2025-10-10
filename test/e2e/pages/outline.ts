/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { fail } from 'assert';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import test, { expect, Locator } from '@playwright/test';

const HORIZONTAL_SASH = '.explorer-viewlet .monaco-sash.horizontal';
const FOCUS_OUTLINE_COMMAND = 'outline.focus';
const OUTLINE_TREE = '.outline-tree';
const OUTLINE_ELEMENT = '.outline-element';

/*
 *  Reuseable Positron outline functionality for tests to leverage.
 */
export class Outline {

	get outlineElement(): Locator { return this.code.driver.page.locator(OUTLINE_TREE).locator(OUTLINE_ELEMENT); }

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async focus(): Promise<void> {
		await this.quickaccess.runCommand(FOCUS_OUTLINE_COMMAND);
	}

	async getOutlineData(): Promise<string[]> {

		await this.focus();

		const sashLocator = this.code.driver.page.locator(HORIZONTAL_SASH).nth(1);
		const sashBoundingBox = await sashLocator.boundingBox();

		if (sashBoundingBox) {

			await this.code.driver.clickAndDrag({
				from: {
					x: sashBoundingBox.x + 10,
					y: sashBoundingBox.y
				},
				to: {
					x: sashBoundingBox.x + 10,
					y: sashBoundingBox.y - 150
				}
			});
		} else {
			fail('Bounding box not found');
		}

		const outllineElements = await this.code.driver.page.locator(OUTLINE_ELEMENT).all();

		const outlineData: string[] = [];
		for (const element of outllineElements) {
			// Extract only the symbol name from `.label-name`. We use to extract
			// metadata associated to the symbol, but this is too fragile and
			// dependent on upstream changes. For instance the number of
			// diagnostics/problems may be included there, and other details generated
			// by the LSP backend.
			const labelName = await element.locator('.label-name').textContent();
			if (labelName !== null) {
				outlineData.push(labelName.trim());
			}
		}

		return outlineData;
	}

	async expectOutlineElementToBeVisible(text: string, visible = true): Promise<void> {
		await test.step(`Expect outline element to be ${visible ? 'visible' : 'not visible'}: ${text}`, async () => {
			visible
				? await expect(this.outlineElement.filter({ hasText: text })).toBeVisible()
				: await expect(this.outlineElement.filter({ hasText: text })).not.toBeVisible();
		});
	}

	async expectOutlineToBeEmpty(): Promise<void> {
		await test.step('Expect outline to be empty', async () => {
			await expect(this.code.driver.page.getByText(/^No symbols found in document/)).toBeVisible();
		});
	}

	async expectOutlineElementCountToBe(count: number): Promise<void> {
		await test.step(`Expect outline element count to be ${count}`, async () => {
			if (count === 0) {
				await expect(this.outlineElement).not.toBeVisible();
			}
			await expect(this.outlineElement).toHaveCount(count);
		});
	}

	async expectOutlineToContain(expected: string[]): Promise<void> {
		await expect(async () => {
			const outlineData = await this.getOutlineData();
			const missingFromUI = expected.filter(item => !outlineData.includes(item));
			expect(missingFromUI, `Missing from UI: ${missingFromUI}`).toHaveLength(0);
		}).toPass();
	}
}
