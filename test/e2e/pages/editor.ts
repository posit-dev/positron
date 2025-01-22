/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator } from '@playwright/test';
import { Code } from '../infra/code';

// currently a dupe of declaration in ../editor.ts but trying not to modify that file
const EDITOR = (filename: string) => `.monaco-editor[data-uri$="${filename}"]`;
const CURRENT_LINE = '.view-overlays .current-line';
const PLAY_BUTTON = '.codicon-play';
const VIEW_LINES = (filename: string) => `${EDITOR(filename)} .view-lines`;
const LINE_NUMBERS = (filename: string) => `${EDITOR(filename)} .margin .margin-view-overlays .line-numbers`;

const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';

export class Editor {

	viewerFrame = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	playButton = this.code.driver.page.locator(PLAY_BUTTON);

	getEditorViewerLocator(locator: string,): Locator {
		return this.viewerFrame.locator(locator);
	}

	getEditorViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	constructor(private code: Code) { }

	async pressPlay(): Promise<void> {
		await this.code.driver.page.locator(PLAY_BUTTON).click();

		// await appearance and disappearance of the toast
		await expect(this.code.driver.page.locator('.notifications-toasts')).toBeVisible({ timeout: 30000 });
		await expect(this.code.driver.page.locator('.notifications-toasts')).not.toBeVisible({ timeout: 50000 });
	}

	async pressToLine(filename: string, lineNumber: number, press: string): Promise<void> {
		const editor = EDITOR(filename);
		const line = `${editor} .view-lines > .view-line:nth-child(${lineNumber})`;

		const lineLocator = this.code.driver.page.locator(line);

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

		const currentLine = this.code.driver.page.locator(CURRENT_LINE);
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

	async clickOnTerm(filename: string, term: string, line: number, doubleClick: boolean = false): Promise<void> {
		const selector = await this.getSelector(filename, term, line);
		if (doubleClick) {
			await this.code.driver.page.locator(selector).dblclick();
		} else {
			await this.code.driver.page.locator(selector).click();
		}
	}

	private async getSelector(filename: string, term: string, line: number): Promise<string> {
		const lineIndex = await this.getViewLineIndex(filename, line);

		// Get class names and the correct term index
		const { classNames, termIndex } = await this.getClassSelectors(filename, term, lineIndex);

		return `${VIEW_LINES(filename)}>:nth-child(${lineIndex}) span span.${classNames[0]}:nth-of-type(${termIndex + 1})`;
	}

	private async getViewLineIndex(filename: string, line: number): Promise<number> {
		const allElements = await this.code.driver.page.locator(LINE_NUMBERS(filename)).all();

		// Resolve textContent for all elements first
		const elementsWithText = await Promise.all(allElements.map(async (el, index) => ({
			el,
			text: await el.textContent(),
			index
		})));

		// Find the first element matching the line number
		const matchingElement = elementsWithText.find(({ text }) => text === `${line}`);

		if (!matchingElement) {
			throw new Error(`Line ${line} not found in file ${filename}`);
		}

		// Return the 1-based index
		return matchingElement.index + 1;
	}

	private async getClassSelectors(filename: string, term: string, viewline: number): Promise<{ classNames: string[], termIndex: number }> {
		// Locate all spans inside the line
		const allElements = await this.code.driver.page.locator(`${VIEW_LINES(filename)}>:nth-child(${viewline}) span span`).all();

		// Resolve all textContent values before filtering
		const elementsWithText = await Promise.all(allElements.map(async (el, index) => ({
			el,
			text: await el.textContent(),
			index
		})));

		// Find the first element that contains the term
		const matchingElement = elementsWithText.find(({ text }) => text === term);

		if (!matchingElement) {
			throw new Error(`No elements found with term "${term}" in file "${filename}"`);
		}

		// Get the class names of the matching span
		const className = await matchingElement.el.evaluate(el => (el as HTMLElement).className) as string;
		const classNames = className.split(/\s+/);

		// Find the index of this span among all spans
		const termIndex = elementsWithText.filter(({ text }) => text !== null).map(({ el }) => el).indexOf(matchingElement.el);

		return { classNames, termIndex };
	}
}
