/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../code';

export class PositronQuickInput {

	private static QUICK_INPUT = '.quick-input-widget';
	private static QUICK_INPUT_INPUT = `${PositronQuickInput.QUICK_INPUT} .quick-input-box input`;
	private static QUICK_INPUT_ROW = `${PositronQuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
	private static QUICK_INPUT_FOCUSED_ELEMENT = `${PositronQuickInput.QUICK_INPUT_ROW}.focused .monaco-highlighted-label`;
	// Note: this only grabs the label and not the description or detail
	private static QUICK_INPUT_ENTRY_LABEL = `${this.QUICK_INPUT_ROW} .quick-input-list-row > .monaco-icon-label .label-name`;
	private static QUICK_INPUT_ENTRY_LABEL_SPAN = `${this.QUICK_INPUT_ROW} .monaco-highlighted-label`;
	private static QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';

	constructor(private code: Code) { }

	async waitForQuickInputOpened(): Promise<void> {
		await expect(this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_INPUT)).toBeVisible();
	}

	async type(value: string): Promise<void> {
		await this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_INPUT).fill(value);
	}

	async waitForQuickInputElementFocused(): Promise<void> {
		await expect(this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_FOCUSED_ELEMENT)).toBeFocused();
	}

	async waitForQuickInputElementText(): Promise<string> {
		const quickInput = this.code.driver.page.locator(PositronQuickInput.QUICK_INPUT_ENTRY_LABEL_SPAN);
		await expect(quickInput).not.toHaveText('');
		return await quickInput.textContent() || '';
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
		for (let from = 0; from < index; from++) {
			await this.code.driver.page.keyboard.press('Down');
		}
		await this.code.driver.page.keyboard.press('Enter');
		if (!keepOpen) {
			await this.waitForQuickInputClosed();
		}
	}

	async selectQuickInputElementContaining(text: string): Promise<void> {
		await this.code.driver.page.locator(`${PositronQuickInput.QUICK_INPUT_ROW}[aria-label*="${text}"]`).first().click({ timeout: 10000 });
	}

	async clickOkOnQuickInput(): Promise<void> {
		await this.code.driver.page.locator(PositronQuickInput.QUICKINPUT_OK_BUTTON).click();
	}
}
