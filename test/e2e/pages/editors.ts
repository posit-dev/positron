/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';


export class Editors {

	get activeEditor(): Locator { return this.code.driver.page.locator('div.tab.tab-actions-right.active.selected'); }
	get editorIcon(): Locator { return this.code.driver.page.locator('.monaco-icon-label.file-icon'); }
	get editorPart(): Locator { return this.code.driver.page.locator('.split-view-view .part.editor'); }
	get suggestionList(): Locator { return this.code.driver.page.locator('.suggest-widget .monaco-list-row'); }

	constructor(private code: Code) { }

	async clickTab(tabName: string): Promise<void> {
		await test.step(`Click tab: ${tabName}`, async () => {
			const tabLocator = this.code.driver.page.getByRole('tab', { name: tabName });
			await expect(tabLocator).toBeVisible();
			await tabLocator.click();
		});
	}

	async verifyTab(
		tabName: string,
		{ isVisible = true, isSelected = true }: { isVisible?: boolean; isSelected?: boolean }
	): Promise<void> {
		await test.step(`Verify tab: ${tabName} is ${isVisible ? '' : 'not'} visible, is ${isSelected ? '' : 'not'} selected`, async () => {
			const tabLocator = this.code.driver.page.getByRole('tab', { name: tabName });

			await (isVisible
				? expect(tabLocator).toBeVisible()
				: expect(tabLocator).not.toBeVisible());

			await (isSelected
				? expect(tabLocator).toHaveClass(/selected/)
				: expect(tabLocator).not.toHaveClass(/selected/));
		});
	}

	escapeRegex(s: string) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	async waitForActiveTab(fileName: string | RegExp, isDirty: boolean = false): Promise<void> {
		const { page } = this.code.driver;
		const base = `.tabs-container div.tab.active${isDirty ? '.dirty' : ''}[aria-selected="true"]`;
		const active = page.locator(base);

		// Ensure we’re looking at exactly one active tab
		await expect(active).toHaveCount(1);
		await expect(active).toBeVisible();

		const attrMatcher =
			fileName instanceof RegExp ? fileName : new RegExp(`${this.escapeRegex(fileName)}$`);

		await expect(active).toHaveAttribute('data-resource-name', attrMatcher);
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

	async waitForTab(fileName: string | RegExp, isDirty: boolean = false): Promise<void> {
		const { page } = this.code.driver;
		const base = `.tabs-container div.tab${isDirty ? '.dirty' : ''}`;

		if (fileName instanceof RegExp) {
			// Find the *exact* data-resource-name of the first tab whose value matches the regex
			const matchedName = await page.locator(`${base}[data-resource-name]`).evaluateAll(
				(els, pattern) => {
					const rx = new RegExp(pattern.source, pattern.flags);
					for (const el of els) {
						const v = el.getAttribute('data-resource-name') || '';
						if (rx.test(v)) { return v; }
					}
					return null;
				},
				{ source: fileName.source, flags: fileName.flags }
			);

			if (!matchedName) {
				throw new Error(`No tab found with data-resource-name matching ${fileName}`);
			}

			await expect(
				page.locator(`${base}[data-resource-name="${matchedName}"]`)
			).toBeVisible();

		} else {
			// Original ends-with behavior for plain strings
			await expect(
				page.locator(`${base}[data-resource-name$="${fileName}"]`)
			).toBeVisible();
		}
	}

	async waitForSCMTab(fileName: string): Promise<void> {
		await expect(this.code.driver.page.locator(`.tabs-container div.tab[aria-label^="${fileName}"]`)).toBeVisible();
	}

	async saveOpenedFile(): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+S');
		} else {
			await this.code.driver.page.keyboard.press('Control+S');
		}
	}

	async expectSuggestionListCount(count: number): Promise<void> {
		await test.step(`Expect editor suggestion list to have ${count} items`, async () => {
			await expect(this.suggestionList).toHaveCount(count);
		});
	}

	/**
	 * Verify: editor contains the specified text
	 * @param text The text to check in the editor
	 */
	async expectEditorToContain(text: string): Promise<void> {
		await test.step(`Verify editor contains: ${text}`, async () => {
			await expect(this.code.driver.page.locator('[id="workbench.parts.editor"]').getByRole('code').getByText(text)).toBeVisible();
		});
	}

	async expectActiveEditorIconClassToMatch(iconClass: RegExp): Promise<void> {
		await test.step(`Expect active editor icon to match: ${iconClass}`, async () => {
			await expect(this.activeEditor.locator(this.editorIcon)).toHaveClass(iconClass);
		});
	}
}
