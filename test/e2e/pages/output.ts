/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import * as os from 'os';
import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';
import { QuickInput } from './quickInput';

const OUTPUT_LINE = '.view-line';
const OUTPUT_PANE = 'div[id="workbench.panel.output"]';

/*
 *  Reuseable Positron output functionality for tests to leverage.
 */
export class Output {

	constructor(private code: Code, private quickaccess: QuickAccess, private quickinput: QuickInput) { }

	async openOutputPane(outputPaneNameContains: string) {
		await this.quickaccess.runCommand('workbench.action.showOutputChannels', { keepOpen: true });

		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(outputPaneNameContains);

		await this.quickinput.selectQuickInputElementContaining(outputPaneNameContains);
		await this.quickinput.waitForQuickInputClosed();
	}

	async clickOutputTab() {
		await this.code.driver.currentPage.getByRole('tab', { name: 'Output' }).locator('a').click();
	}

	async waitForOutContaining(fragment: string) {
		const outputPane = this.code.driver.currentPage.locator(OUTPUT_PANE);
		const outputLine = outputPane.locator(OUTPUT_LINE);
		await outputLine.getByText(fragment).first().isVisible();
	}

	/**
	 * Verify the output pane renders a line containing the given text. Unlike
	 * `waitForOutContaining`, this retries until the text appears (or the timeout elapses), so it
	 * is safe to call on output that is still streaming in.
	 */
	async expectOutputToContain(fragment: string, timeout = 15000): Promise<void> {
		const outputLine = this.code.driver.currentPage.locator(OUTPUT_PANE).locator(OUTPUT_LINE);
		await expect(outputLine.getByText(fragment).first()).toBeVisible({ timeout });
	}

	/**
	 * Scroll to the top of the output pane and leave the cursor on its first line.
	 */
	async scrollToTop(): Promise<void> {
		await this.quickaccess.runCommand('workbench.panel.output.focus');
		// The view focuses its editor only after the channel model loads, so a key sent
		// before then is dropped and the pane stays pinned to the streaming tail.
		await expect(this.editTarget).toBeFocused();
		await this.pressCursorTop();
		// Monaco drops this class once scrollTop reaches 0.
		await expect(this.outputPane.locator('.scroll-decoration')).toHaveCount(0);
	}

	/**
	 * Copy selected text from the output pane and return it
	 */
	async copySelectedText(): Promise<string> {
		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.currentPage.keyboard.press(`${modifier}+C`);

		// Wait a bit for the copy operation to complete
		await this.code.driver.currentPage.waitForTimeout(100);

		// Grant permissions to read from clipboard
		await this.code.driver.browserContext.grantPermissions(['clipboard-read']);

		// Read the clipboard content
		const clipboardText = await this.code.driver.currentPage.evaluate(async () => {
			try {
				return await navigator.clipboard.readText();
			} catch (error) {
				console.error('Failed to read clipboard text:', error);
				return '';
			}
		});

		return clipboardText;
	}

	/**
	 * Select the first N lines of output text (fewer when the channel is shorter).
	 */
	async selectFirstNLines(lineCount: number): Promise<void> {
		// Extend the selection from the keyboard: the Window log streams while the test
		// runs, so clicking a view line races a re-render and the top scroll shadow
		// intercepts the pointer.
		await expect(this.editTarget).toBeFocused();
		await this.pressCursorTop();
		for (let i = 0; i < lineCount; i++) {
			await this.code.driver.currentPage.keyboard.press('Shift+ArrowDown');
		}
	}

	private get outputPane() {
		return this.code.driver.currentPage.locator(OUTPUT_PANE);
	}

	private get editTarget() {
		return this.outputPane.locator('.monaco-editor textarea, .monaco-editor .native-edit-context').first();
	}

	private async pressCursorTop(): Promise<void> {
		await this.code.driver.currentPage.keyboard.press(os.platform() === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
	}

	/**
	 * Returns the names of the output channels whose label contains the given text, by opening the
	 * channel picker, typing the filter, and reading the visible rows. Closes the picker before
	 * returning so the workbench is left as it was found.
	 *
	 * Reads only the row's label (`.monaco-icon-label .label-name`), not the whole row's text: the
	 * output channel picker can render a description or a "recently used" separator alongside a row,
	 * and `allTextContents()` on the whole row would fold that extra text into the label, breaking
	 * an exact-match comparison against the channel name.
	 */
	async getChannelNamesContaining(filter: string): Promise<string[]> {
		await this.quickaccess.runCommand('workbench.action.showOutputChannels', { keepOpen: true });
		await this.quickinput.waitForQuickInputOpened();
		await this.quickinput.type(filter);

		const labels = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_ENTRY_LABEL);
		await labels.first().waitFor({ state: 'attached', timeout: 2000 }).catch(() => { /* no matches is a valid result */ });
		const names = await labels.allTextContents();

		await this.quickinput.closeQuickInput();
		return names.filter(name => name.includes(filter));
	}
}
