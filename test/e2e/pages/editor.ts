/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, FrameLocator, Locator } from '@playwright/test';
import { Code } from '../infra/code';

// currently a dupe of declaration in ../editor.ts but trying not to modify that file
const EDITOR = (filename: string) => `.monaco-editor[data-uri$="${filename}"]`;
const CURRENT_LINE = '.view-overlays .current-line';
const PLAY_BUTTON = '.codicon-play';
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const VIEW_LINES = (filename: string) => `${EDITOR(filename)} .view-lines`;
const LINE_NUMBERS = (filename: string) => `${EDITOR(filename)} .margin .margin-view-overlays .line-numbers`;

export class Editor {

	get viewerFrame(): FrameLocator { return this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME); }
	get playButton(): Locator { return this.code.driver.page.locator(PLAY_BUTTON); }
	get editorPane(): Locator { return this.code.driver.page.locator('[id="workbench.parts.editor"]'); }

	getEditorViewerLocator(locator: string,): Locator {
		return this.viewerFrame.locator(locator);
	}

	getEditorViewerFrame(): FrameLocator {
		return this.viewerFrame;
	}

	constructor(private code: Code) { }

	/**
	 * Action: Enter text in the editor
	 * @param text the text to type into the editor
	 * @param pressEnter whether to press Enter after typing the text
	 */
	async type(text: string, pressEnter = false): Promise<void> {
		await this.editorPane.pressSequentially(text);

		if (pressEnter) {
			await this.editorPane.press('Enter');
		}
	}

	/** Action: Select tab by name
	 * @param filename the name of the tab to select
	 */
	async selectTab(filename: string): Promise<void> {
		await test.step(`Select tab ${filename}`, async () => {
			await this.code.driver.page.getByRole('tab', { name: filename }).click();
		});
	}

	/**
	 * Action: Select a file in the editor and enter text
	 * @param filename the name of the file to select
	 * @param text the text to type into the editor
	 */
	async selectTabAndType(filename: string, text: string): Promise<void> {
		await test.step(`Select tab ${filename} and type text`, async () => {
			await this.selectTab(filename);
			await this.type(text);
		});
	}

	async pressPlay(skipToastVerification: boolean = false): Promise<void> {
		await this.code.driver.page.locator(PLAY_BUTTON).click();

		if (!skipToastVerification) {
			// await appearance and disappearance of the toast
			const appRunningToast = this.code.driver.page.locator('.notifications-toasts').getByText(/Running.*application:/);
			await expect(appRunningToast).toBeVisible({ timeout: 30000 });
			await expect(appRunningToast).not.toBeVisible({ timeout: 45000 });
		}
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

	async clickOnTerm(filename: string, term: string, line: number, doubleClick: boolean = false): Promise<Locator> {
		const selector = await this.getSelector(filename, term, line);
		const locator = this.code.driver.page.locator(selector);
		doubleClick ? await locator.dblclick() : await locator.click();
		return locator;
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

	private async getClassSelectors(filename: string, term: string, viewline: number): Promise<{ classNames: string[]; termIndex: number }> {
		// Locate all spans inside the line
		const allElements = await this.code.driver.page.locator(`${VIEW_LINES(filename)}>:nth-child(${viewline}) span span`).all();

		// Resolve all textContent values before filtering
		const elementsWithText = await Promise.all(allElements.map(async (el, index) => ({
			el,
			text: (await el.textContent())?.trim(),
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

	async getLine(filename: string, line: number): Promise<string> {
		const lineIndex = await this.getViewLineIndex(filename, line);
		const lineContent = await this.editorPane.locator('div.view-line').nth(lineIndex - 1).textContent();
		return lineContent!;
	}

	async replaceTerm(file: string, term: string, line: number, replaceWith: string) {
		await test.step(`Replace "${term}" on line ${line} with "${replaceWith}"`, async () => {
			await this.code.driver.page.getByRole('tab', { name: file }).click();
			await this.clickOnTerm(file, term, line, true);
			await this.code.driver.page.keyboard.type(replaceWith);
		});
	}
}
