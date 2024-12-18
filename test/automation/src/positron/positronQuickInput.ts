/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../code';

export class PositronQuickInput {

	private static QUICK_INPUT = '.quick-input-widget';
	private static QUICK_INPUT_INPUT = `${PositronQuickInput.QUICK_INPUT} .quick-input-box input`;
	private static QUICK_INPUT_RESULT = `${PositronQuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
	// Note: this only grabs the label and not the description or detail
	private static QUICK_INPUT_ENTRY_LABEL = `${this.QUICK_INPUT_RESULT} .quick-input-list-row > .monaco-icon-label .label-name`;
	private static QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';

	constructor(private code: Code) { }

	async waitForQuickInputOpened({ timeout = 10000 }: { timeout?: number } = {}): Promise<void> {
		await expect(this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_INPUT)).toBeVisible({ timeout });
	}

	async type(value: string): Promise<void> {
		await this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_INPUT).fill(value);
	}

	async waitForQuickInputElementText(): Promise<string> {
		const quickInputResult = this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_RESULT);

		// Wait for at least one matching element with non-empty text
		await expect(async () => {
			const texts = await quickInputResult.allTextContents();
			return texts.some(text => text.trim() !== '');
		}).toPass();

		// Retrieve the text content of the first matching element
		const text = await quickInputResult.first().textContent();
		return text?.trim() || '';

	}

	async closeQuickInput(): Promise<void> {
		await this.code.driver.page.keyboard.press('Escape');
		await this.waitForQuickInputClosed();
	}

	async waitForQuickInputElements(accept: (names: string[]) => boolean): Promise<void> {
		const locator = this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_ENTRY_LABEL);

		await expect(async () => {
			const names = await locator.allTextContents();
			return accept(names);
		}).toPass();
	}

	async waitForQuickInputClosed(): Promise<void> {
		await expect(this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_INPUT)).not.toBeVisible();
	}

	async selectQuickInputElement(index: number, keepOpen?: boolean): Promise<void> {
		await this.waitForQuickInputOpened();
		await this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_RESULT).nth(index).click();

		if (!keepOpen) {
			await this.waitForQuickInputClosed();
		}
	}

	async selectQuickInputElementContaining(text: string): Promise<void> {
		await this.code.driver.page.locator(`${PositronQuickInput.QUICK_INPUT_RESULT}[aria-label*="${text}"]`).first().click({ timeout: 10000 });
	}

	async clickOkOnQuickInput(): Promise<void> {
		await this.code.driver.page.locator(PositronQuickInput.QUICKINPUT_OK_BUTTON).click();
	}
}
