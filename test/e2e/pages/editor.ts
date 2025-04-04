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

export class Editor {

	viewerFrame = this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	playButton = this.code.driver.page.locator(PLAY_BUTTON);
	editorPane = this.code.driver.page.locator('[id="workbench.parts.editor"]');

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
	 */
	async type(text: string): Promise<void> {
		await this.editorPane.pressSequentially(text);
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
		await test.step(`Click on term "${term}" in file "${filename}"`, async () => {
			const termLocator = this.editorPane.locator('div.view-line').nth(line - 1).getByText(term);
			doubleClick ? await termLocator.dblclick() : await termLocator.click();
		});
	}

	async replaceTerm(file: string, term: string, line: number, replaceWith: string) {
		await test.step(`Replace "${term}" on line ${line} with "${replaceWith}"`, async () => {
			await this.code.driver.page.getByRole('tab', { name: file }).click();
			await this.clickOnTerm(file, term, line, true);
			await this.code.driver.page.keyboard.type(replaceWith);
		});
	}
}
