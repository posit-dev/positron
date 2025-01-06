/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../code';


export class Editors {

	activeEditor = this.code.driver.page.locator('div.tab.tab-actions-right.active.selected');
	editorIcon = this.code.driver.page.locator('.monaco-icon-label.file-icon');
	editorPart = this.code.driver.page.locator('.split-view-view .part.editor');

	constructor(private code: Code) { }

	async waitForActiveTab(fileName: string, isDirty: boolean = false): Promise<void> {
		await expect(this.code.driver.page.locator(`.tabs-container div.tab.active${isDirty ? '.dirty' : ''}[aria-selected="true"][data-resource-name$="${fileName}"]`)).toBeVisible();
	}

	async waitForActiveTabNotDirty(fileName: string): Promise<void> {
		await expect(
			this.code.driver.page.locator(
				`.tabs-container div.tab.active:not(.dirty)[aria-selected="true"][data-resource-name$="${fileName}"]`
			)
		).toBeVisible();
	}

	async newUntitledFile(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+N');
		} else {
			await this.code.driver.page.keyboard.press('Control+N');
		}

		await this.waitForEditorFocus('Untitled-1');
	}

	async waitForEditorFocus(fileName: string): Promise<void> {
		await this.waitForActiveTab(fileName, undefined);
		await this.waitForActiveEditor(fileName);
	}

	async waitForActiveEditor(fileName: string): Promise<any> {
		const selector = `.editor-instance .monaco-editor[data-uri$="${fileName}"] textarea`;
		await expect(this.code.driver.page.locator(selector)).toBeFocused();
	}

	async selectTab(fileName: string): Promise<void> {

		// Selecting a tab and making an editor have keyboard focus
		// is critical to almost every test. As such, we try our
		// best to retry this task in case some other component steals
		// focus away from the editor while we attempt to get focus

		await expect(async () => {
			await this.code.driver.page.locator(`.tabs-container div.tab[data-resource-name$="${fileName}"]`).click();
			await this.code.driver.page.keyboard.press(process.platform === 'darwin' ? 'Meta+1' : 'Control+1'); // make editor really active if click failed somehow
			await this.waitForEditorFocus(fileName);
		}).toPass();
	}

	async waitForTab(fileName: string, isDirty: boolean = false): Promise<void> {
		await expect(this.code.driver.page.locator(`.tabs-container div.tab${isDirty ? '.dirty' : ''}[data-resource-name$="${fileName}"]`)).toBeVisible();
	}

	async saveOpenedFile(): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+S');
		} else {
			await this.code.driver.page.keyboard.press('Control+S');
		}
	}
}
