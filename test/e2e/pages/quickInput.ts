/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const QUICK_INPUT_LIST = '.quick-input-widget .quick-input-list';

export class QuickInput {

	private static QUICK_INPUT = '.quick-input-widget';
	private static QUICK_INPUT_INPUT = `${QuickInput.QUICK_INPUT} .quick-input-box input`;
	private static QUICK_INPUT_RESULT = `${QuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
	// Note: this only grabs the label and not the description or detail
	private static QUICK_INPUT_ENTRY_LABEL = `${this.QUICK_INPUT_RESULT} .quick-input-list-row > .monaco-icon-label .label-name`;
	private static QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';
	quickInputList: Locator;
	quickInput: Locator;
	quickInputTitleBar: Locator;
	quickInputResult: Locator;

	constructor(private code: Code) {
		this.quickInputList = this.code.driver.page.locator(QUICK_INPUT_LIST);
		this.quickInput = this.code.driver.page.locator(QuickInput.QUICK_INPUT_INPUT);
		this.quickInputTitleBar = this.code.driver.page.locator(`.quick-input-title`);
		this.quickInputResult = this.code.driver.page.locator(QuickInput.QUICK_INPUT_RESULT);
	}

	async expectTitleBarToHaveText(text: string): Promise<void> {
		await expect(this.quickInputTitleBar).toHaveText(text);
	}

	async expectQuickInputResultsToContain(titles: string[]): Promise<void> {
		await test.step('Verify Quick Input results contain expected title', async () => {
			for (let i = 0; i < titles.length; i++) {
				await expect(this.quickInputResult.filter({ hasText: titles[i] })).toBeVisible();
			}
		});
	}

	async waitForQuickInputOpened({ timeout = 10000 }: { timeout?: number } = {}): Promise<void> {
		await expect(this.code.driver.page.locator(QuickInput.QUICK_INPUT_INPUT)).toBeVisible({ timeout });
	}

	async type(value: string): Promise<void> {
		await this.code.driver.page.locator(QuickInput.QUICK_INPUT_INPUT).selectText();
		await this.code.driver.page.keyboard.press('Backspace');
		await this.code.driver.page.locator(QuickInput.QUICK_INPUT_INPUT).fill(value);
	}

	async waitForQuickInputElementText(): Promise<string> {
		const quickInputResult = this.code.driver.page.locator(QuickInput.QUICK_INPUT_RESULT);

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
		const locator = this.code.driver.page.locator(QuickInput.QUICK_INPUT_ENTRY_LABEL);

		await expect(async () => {
			const names = await locator.allTextContents();
			return accept(names);
		}).toPass();
	}

	async waitForQuickInputClosed(): Promise<void> {
		await expect(this.code.driver.page.locator(QuickInput.QUICK_INPUT_INPUT)).not.toBeVisible();
	}

	async selectQuickInputElement(index: number, keepOpen?: boolean): Promise<void> {
		await this.waitForQuickInputOpened();
		await this.code.driver.page.locator(QuickInput.QUICK_INPUT_RESULT).nth(index).click();

		if (!keepOpen) {
			await this.waitForQuickInputClosed();
		}
	}

	async selectQuickInputElementContaining(text: string, { timeout, force = true }: { timeout?: number; force?: boolean } = {}): Promise<string> {
		const firstMatch = this.code.driver.page.locator(`${QuickInput.QUICK_INPUT_RESULT}[aria-label*="${text}"]`).first();

		const firstMatchResult = await firstMatch.locator('.quick-input-list-row').nth(0).textContent() || '';
		await firstMatch.click({ force, timeout });
		await this.code.driver.page.mouse.move(0, 0);

		return firstMatchResult.trim();
	}

	async clickOkButton(): Promise<void> {
		await this.code.driver.page.locator(QuickInput.QUICKINPUT_OK_BUTTON).click();
	}
}
