/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import * as os from 'os';
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
		await this.code.driver.page.getByRole('tab', { name: 'Output' }).locator('a').click();
	}

	async waitForOutContaining(fragment: string) {
		const outputPane = this.code.driver.page.locator(OUTPUT_PANE);
		const outputLine = outputPane.locator(OUTPUT_LINE);
		await outputLine.getByText(fragment).first().isVisible();
	}

	/**
	 * Scroll to the top of the output pane
	 */
	async scrollToTop(): Promise<void> {
		// First, ensure the output pane is focused
		await this.quickaccess.runCommand('workbench.panel.output.focus');

		// Use platform-specific keyboard shortcuts to scroll to top
		const platform = os.platform();
		if (platform === 'darwin') {
			// On macOS, use Cmd+ArrowUp
			await this.code.driver.page.keyboard.press('Meta+ArrowUp');
		} else {
			// On Windows/Linux, use Ctrl+Home
			await this.code.driver.page.keyboard.press('Control+Home');
		}
	}

	/**
	 * Copy selected text from the output pane and return it
	 */
	async copySelectedText(): Promise<string> {
		const isMac = os.platform() === 'darwin';
		const modifier = isMac ? 'Meta' : 'Control';

		await this.code.driver.page.keyboard.press(`${modifier}+C`);

		// Wait a bit for the copy operation to complete
		await this.code.driver.page.waitForTimeout(100);

		// Grant permissions to read from clipboard
		await this.code.driver.context.grantPermissions(['clipboard-read']);

		// Read the clipboard content
		const clipboardText = await this.code.driver.page.evaluate(async () => {
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
	 * Select the first N lines of output text
	 */
	async selectFirstNLines(lineCount: number): Promise<void> {
		const outputPane = this.code.driver.page.locator(OUTPUT_PANE);
		const outputLines = outputPane.locator('.view-line');
		const totalLines = await outputLines.count();

		if (totalLines === 0) {
			throw new Error('No output lines found in the output pane');
		}

		// Calculate how many lines to select (or all lines if less than N)
		const linesToSelect = Math.min(lineCount, totalLines);
		const endLineIndex = linesToSelect - 1;

		// Click on the first line and then shift+click on the last line of selection
		const startLine = outputLines.nth(0);
		const endLine = outputLines.nth(endLineIndex);

		await startLine.click();
		await endLine.click({ modifiers: ['Shift'] });
	}
}
