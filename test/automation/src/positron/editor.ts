/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator } from '@playwright/test';
import { Code } from '../code';

// currently a dupe of declaration in ../editor.ts but trying not to modifiy that file
const EDITOR = (filename: string) => `.monaco-editor[data-uri$="${filename}"]`;
const CURRENT_LINE = '.view-overlays .current-line';
const PLAY_BUTTON = '.codicon-play';

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';

export class Editor {

	viewerFrame = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);

	getEditorViewerLocator(locator: string,): Locator {
		return this.viewerFrame.locator(locator);
	}

	getEditorViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	constructor(private code: Code) { }

	async pressPlay(): Promise<void> {
		await this.code.driver.getLocator(PLAY_BUTTON).click();

		// await appearance and disappearance of the toast
		await expect(this.code.driver.page.locator('.notifications-toasts')).toBeVisible({ timeout: 30000 });
		await expect(this.code.driver.page.locator('.notifications-toasts')).not.toBeVisible({ timeout: 50000 });
	}

	async pressToLine(filename: string, lineNumber: number, press: string): Promise<void> {
		const editor = EDITOR(filename);
		const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;

		const lineLocator = this.code.driver.getLocator(line);

		await lineLocator.press(press);
	}

	/**
	 * This function returns the top value of the style attribute for the editor's current-line div
	 * parent (the current-line div is a child of the div that has the top attribute). It retries up
	 * to 10 times to get the value. Retries are necessary because the value is not always
	 * immediately available (presumably due to the change from one current line to another).
	 * @returns Promise that resolves to top value of the style attribute for the editor's
	 * current-line div parent.
	 */
	async getCurrentLineTop(): Promise<number> {
		let retries = 20;
		let topValue: number = NaN;

		const currentLine = this.code.driver.getLocator(CURRENT_LINE);
		// Note that '..' is used to get the parent of the current-line div
		const currentLineParent = currentLine.locator('..');

		// Note that this retry loop does not sleep.  This is because the
		// test that uses this function needs to run as quickly as possible
		// in order to verify that the editor is not executing code out of order.
		while (retries > 0) {

			const boundingBox = await currentLineParent.boundingBox();
			topValue = boundingBox?.y || NaN;

			if (!isNaN(topValue)) {
				break;
			}

			retries--;
		}

		return topValue;
	}

	async waitForTypeInEditor(filename: string, text: string, selectorPrefix = ''): Promise<any> {
		if (text.includes('\n')) {
			throw new Error('waitForTypeInEditor does not support new lines, use either a long single line or dispatchKeybinding(\'Enter\')');
		}
		const editor = [selectorPrefix || '', EDITOR(filename)].join(' ');

		await expect(this.code.driver.page.locator(editor)).toBeVisible();

		const textarea = `${editor} textarea`;
		await expect(this.code.driver.page.locator(textarea)).toBeFocused();

		await this.code.driver.page.locator(textarea).evaluate((textarea, text) => {
			const input = textarea as HTMLTextAreaElement;
			const start = input.selectionStart || 0;
			const value = input.value;
			const newValue = value.substring(0, start) + text + value.substring(start);

			input.value = newValue;
			input.setSelectionRange(start + text.length, start + text.length);

			const event = new Event('input', { bubbles: true, cancelable: true });
			input.dispatchEvent(event);
		}, text);

		await this.waitForEditorContents(filename, c => c.indexOf(text) > -1, selectorPrefix);
	}

	async waitForEditorContents(filename: string, accept: (contents: string) => boolean, selectorPrefix = ''): Promise<any> {
		const selector = [selectorPrefix || '', `${EDITOR(filename)} .view-lines`].join(' ');
		const locator = this.code.driver.page.locator(selector);

		let content = '';
		await expect(async () => {
			content = (await locator.textContent())?.replace(/\u00a0/g, ' ') || '';
			if (!accept(content)) {
				throw new Error(`Content did not match condition: ${content}`);
			}
		}).toPass();

		return content;
	}

	async waitForEditorFocus(filename: string, lineNumber: number, selectorPrefix = ''): Promise<void> {
		const editor = [selectorPrefix || '', EDITOR(filename)].join(' ');
		const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;
		const textarea = `${editor} textarea`;

		await this.code.driver.page.locator(line).click();

		await expect(async () => {
			await expect(this.code.driver.page.locator(textarea)).toBeFocused();
		}).toPass();
	}

}
