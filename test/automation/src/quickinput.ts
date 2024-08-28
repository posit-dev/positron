/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { IElement } from './driver';

export class QuickInput {

	private static QUICK_INPUT = '.quick-input-widget';
	private static QUICK_INPUT_INPUT = `${QuickInput.QUICK_INPUT} .quick-input-box input`;
	private static QUICK_INPUT_ROW = `${QuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
	private static QUICK_INPUT_FOCUSED_ELEMENT = `${QuickInput.QUICK_INPUT_ROW}.focused .monaco-highlighted-label`;
	// Note: this only grabs the label and not the description or detail
	private static QUICK_INPUT_ENTRY_LABEL = `${QuickInput.QUICK_INPUT_ROW} .quick-input-list-row > .monaco-icon-label .label-name`;
	private static QUICK_INPUT_ENTRY_LABEL_SPAN = `${QuickInput.QUICK_INPUT_ROW} .monaco-highlighted-label`;

	// --- Start Positron ---
	private static QUICKINPUT_OK_BUTTON = '.quick-input-widget .quick-input-action a:has-text("OK")';
	// --- End Positron ---

	constructor(private code: Code) { }

	async waitForQuickInputOpened(retryCount?: number): Promise<void> {
		await this.code.waitForActiveElement(QuickInput.QUICK_INPUT_INPUT, retryCount);
	}

	async type(value: string): Promise<void> {
		await this.code.waitForSetValue(QuickInput.QUICK_INPUT_INPUT, value);
	}

	async waitForQuickInputElementFocused(): Promise<void> {
		await this.code.waitForTextContent(QuickInput.QUICK_INPUT_FOCUSED_ELEMENT);
	}

	async waitForQuickInputElementText(): Promise<string> {
		return this.code.waitForTextContent(QuickInput.QUICK_INPUT_ENTRY_LABEL_SPAN);
	}

	async closeQuickInput(): Promise<void> {
		await this.code.dispatchKeybinding('escape');
		await this.waitForQuickInputClosed();
	}

	async waitForQuickInputElements(accept: (names: string[]) => boolean): Promise<void> {
		await this.code.waitForElements(QuickInput.QUICK_INPUT_ENTRY_LABEL, false, els => accept(els.map(e => e.textContent)));
	}

	async waitForQuickInputClosed(): Promise<void> {
		await this.code.waitForElement(QuickInput.QUICK_INPUT, r => !!r && r.attributes.style.indexOf('display: none;') !== -1);
	}

	async selectQuickInputElement(index: number, keepOpen?: boolean): Promise<void> {
		await this.waitForQuickInputOpened();
		for (let from = 0; from < index; from++) {
			await this.code.dispatchKeybinding('down');
		}
		await this.code.dispatchKeybinding('enter');
		if (!keepOpen) {
			await this.waitForQuickInputClosed();
		}
	}
	// --- Start Positron ---
	async selectQuickInputElementContaining(contains: string): Promise<IElement | undefined> {
		const selector = `${QuickInput.QUICK_INPUT_ROW}[aria-label*="${contains}"]`;
		try {
			const element = this.code.getElement(selector);
			await this.code.waitAndClick(selector);
			return element;
		} catch (ex) {
			// Show a more helpful error message by clearing the input and logging the list of items
			await this.type('');
			const elements = await this.code.waitForElements(QuickInput.QUICK_INPUT_ROW, false);
			const ariaLabels = elements.map(e => e.attributes['aria-label']);
			throw new Error(`Could not find item containing '${contains}' in list:\n${ariaLabels.join('\n')}`);
		}
	}

	async clickOkOnQuickInput(): Promise<void> {
		await this.code.driver.getLocator(QuickInput.QUICKINPUT_OK_BUTTON).click();
	}
	// --- End Positron ---
}
