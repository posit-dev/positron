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
	get editorGroups(): Locator { return this.code.driver.page.locator('.part.editor .editor-group-container'); }

	constructor(private code: Code) { }

	/**
	 * Get a specific editor group by index.
	 * Useful for side-by-side notebook testing where you need to scope actions to a specific editor.
	 * @param index - 0-based index (0 = leftmost/first group)
	 */
	editorGroup(index: number): Locator {
		return this.editorGroups.nth(index);
	}

	/**
	 * Verify: the expected number of editor groups are visible.
	 * @param count - Expected number of editor groups
	 * @param timeout - Timeout for the expectation (default: 5000ms)
	 */
	async expectEditorGroupCount(count: number, timeout = 5000): Promise<void> {
		await test.step(`Expect ${count} editor group(s)`, async () => {
			await expect(this.editorGroups).toHaveCount(count, { timeout });
		});
	}

	/**
	 * Action: click a tab by name without ensuring keyboard focus lands in the editor.
	 * Use this when you only need the tab to be active (e.g. to close it or inspect its state)
	 * and do not need the editor to have keyboard focus.
	 * @see {@link selectTab} to click a tab AND guarantee editor keyboard focus
	 */
	async clickTab(tabName: string): Promise<void> {
		await test.step(`Click tab: ${tabName}`, async () => {
			const tabLocator = this.code.driver.page.getByRole('tab', { name: tabName });
			await expect(tabLocator).toBeVisible();
			await tabLocator.click();
		});
	}

	/**
	 * Action: click the "Run in Console" or "Source R File" toolbar button to execute the
	 * currently active editor file in the console.
	 */
	async runCurrentFile(): Promise<void> {
		await test.step('Run current file in console', async () => {
			await this.code.driver.page.getByRole('button', { name: /Run.*Console|Source R File/ }).click();
		});
	};

	/**
	 * Verify: a tab exists (or does not exist) and is selected (or is not selected).
	 * Checks both visibility and the `selected` CSS class on the tab element.
	 * @param tabName - Tab label to locate, as a plain string or regex
	 * @param isVisible - Whether the tab should be visible (default: `true`)
	 * @param isSelected - Whether the tab should have the `selected` class (default: `true`)
	 */
	async verifyTab(
		tabName: string | RegExp,
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

	/**
	 * Utility: escape a plain string so it can be used safely inside a `RegExp` constructor
	 * without any characters being treated as regex metacharacters.
	 */
	escapeRegex(s: string) {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	/**
	 * Verify: the currently active (focused) tab matches the given file name and dirty state.
	 * Asserts that exactly one active tab exists, that it is visible, and that its
	 * `data-resource-name` attribute ends with (or matches) `fileName`.
	 * @param isDirty - When `true`, also requires the tab to have the `dirty` CSS class
	 * @see {@link waitForActiveEditor} to additionally assert the editor textarea has focus
	 * @see {@link waitForEditorFocus} to assert both the active tab and editor focus together
	 */
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
	/**
	 * Verify: the active tab for `fileName` is visible and does NOT have the `dirty` CSS class.
	 * Useful after saving to confirm the unsaved-changes indicator has cleared.
	 * @see {@link waitForActiveTab} for the general-purpose variant
	 */
	async waitForActiveTabNotDirty(fileName: string): Promise<void> {
		await expect(
			this.code.driver.page.locator(
				`.tabs-container div.tab.active:not(.dirty)[aria-selected="true"][data-resource-name$="${fileName}"]`
			)
		).toBeVisible();
	}

	/**
	 * Action: open a new untitled file via the platform keyboard shortcut (Cmd+N / Ctrl+N)
	 * and wait for its editor to receive focus.
	 */
	async newUntitledFile(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+N');
		} else {
			await this.code.driver.page.keyboard.press('Control+N');
		}

		await this.waitForEditorFocus('Untitled-1');
	}

	/**
	 * Verify: the tab for `fileName` is active AND the Monaco editor textarea for that file
	 * has keyboard focus. Combines {@link waitForActiveTab} and {@link waitForActiveEditor}.
	 * @see {@link waitForActiveTab} to check only the active tab
	 * @see {@link waitForActiveEditor} to check only the editor focus
	 */
	async waitForEditorFocus(fileName: string): Promise<void> {
		await this.waitForActiveTab(fileName, undefined);
		await this.waitForActiveEditor(fileName);
	}

	/**
	 * Verify: the Monaco editor instance for `fileName` has keyboard focus (its native edit
	 * context is focused). Does not check the tab state.
	 * @see {@link waitForActiveTab} to check the active tab instead
	 * @see {@link waitForEditorFocus} to assert both the tab and editor focus together
	 */
	async waitForActiveEditor(fileName: string): Promise<any> {
		const selector = `.editor-instance .monaco-editor[data-uri$="${fileName}"] .native-edit-context`;
		await expect(this.code.driver.page.locator(selector)).toBeFocused();
	}

	/**
	 * Action: click a tab by file name and retry until the editor has keyboard focus.
	 * More robust than {@link clickTab}: retries the click and uses Cmd/Ctrl+1 to recover
	 * if another component steals focus before the editor is ready.
	 * @see {@link clickTab} for a single click without focus guarantee
	 */
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

	/**
	 * Verify: a tab with the given file name is visible in the tab bar (not necessarily active).
	 * Supports both plain string (ends-with match on `data-resource-name`) and `RegExp`.
	 * @param isDirty - When `true`, also requires the tab to have the `dirty` CSS class
	 * @see {@link waitForSCMTab} to locate a tab by its `aria-label` prefix instead
	 * @see {@link waitForActiveTab} to assert the tab is also the currently active one
	 */
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

	/**
	 * Verify: an SCM-managed tab whose `aria-label` starts with `fileName` is visible.
	 * Use this instead of {@link waitForTab} when the resource name is not available as a
	 * `data-resource-name` attribute (e.g. diff editor tabs opened by the SCM view).
	 * @see {@link waitForTab} to locate a tab by its `data-resource-name` attribute
	 */
	async waitForSCMTab(fileName: string): Promise<void> {
		await expect(this.code.driver.page.locator(`.tabs-container div.tab[aria-label^="${fileName}"]`)).toBeVisible();
	}

	/**
	 * Action: save the currently focused editor via the platform keyboard shortcut (Cmd+S / Ctrl+S).
	 */
	async saveOpenedFile(): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.driver.page.keyboard.press('Meta+S');
		} else {
			await this.code.driver.page.keyboard.press('Control+S');
		}
	}

	/**
	 * Verify: the autocomplete suggestion widget contains exactly `count` visible items.
	 */
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

	/**
	 * Verify: editor group at `index` has the `active` CSS class.
	 */
	async expectEditorGroupActive(index: number, timeout?: number): Promise<void> {
		await test.step(`Expect editor group ${index} to be active`, async () => {
			await expect(this.editorGroup(index)).toHaveClass(/\bactive\b/, { timeout });
		});
	}

	/**
	 * Verify: editor group at `index` has the `inactive` CSS class.
	 */
	async expectEditorGroupInactive(index: number): Promise<void> {
		await test.step(`Expect editor group ${index} to be inactive`, async () => {
			await expect(this.editorGroup(index)).toHaveClass(/\binactive\b/);
		});
	}

	/**
	 * Verify: the file-type icon in the active editor tab has a CSS class matching `iconClass`.
	 * Useful for confirming the correct language icon is shown for a given file type.
	 * @param iconClass - Regex to match against the full class string of the icon element
	 */
	async expectActiveEditorIconClassToMatch(iconClass: RegExp): Promise<void> {
		await test.step(`Expect active editor icon to match: ${iconClass}`, async () => {
			await expect(this.activeEditor.locator(this.editorIcon)).toHaveClass(iconClass);
		});
	}
}
