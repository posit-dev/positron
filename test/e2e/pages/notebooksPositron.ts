/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Notebooks } from './notebooks';
import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import test, { expect, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';

const DEFAULT_TIMEOUT = 10000;
/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	positronNotebook: Locator;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		super(code, quickinput, quickaccess, hotKeys);

		this.positronNotebook = this.code.driver.page.locator('.positron-notebook').first();
	}

	// -- Actions --

	/**
	 * Action: Open a Positron notebook.
	 * It does not check for an active cell, as Positron notebooks do not have the same cell structure as VS Code notebooks.
	 *
	 * @param path - The path to the notebook to open.
	 */
	async openNotebook(path: string): Promise<void> {
		await super.openNotebook(path, false);
		await this.expectToBeVisible();
	}

	/**
	 * Override selectCellAtIndex to use Positron-specific selectors
	 */
	async selectCellAtIndex(cellIndex: number): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}`, async () => {
			// Use semantic selector
			await this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex).click();
		});
	}

	/**
	 * Override addCodeToCellAtIndex to use Positron-specific selectors and Monaco editor
	 */
	async addCodeToCellAtIndex(code: string, cellIndex = 0, delay = 0): Promise<void> {
		await test.step('Add code to Positron cell', async () => {
			// Select the cell first
			await this.selectCellAtIndex(cellIndex);

			// Find the Monaco editor within the Positron cell
			const editorSelector = '.positron-cell-editor-monaco-widget textarea';

			// Get the specific cell's editor
			const cell = this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
			const editor = cell.locator(editorSelector);

			// Ensure editor is focused and type/fill the code
			await editor.focus();
			if (delay) {
				await editor.pressSequentially(code, { delay });
			} else {
				await editor.fill(code);
			}
		});
	}

	/**
	 * Execute code in the current cell by clicking the run button
	 */
	async executeCodeInCell(cellIndex = 0): Promise<void> {
		await test.step('Execute code in Positron notebook cell', async () => {
			// Select the cell first
			await this.selectCellAtIndex(cellIndex);

			// Find and click the run button for this specific cell
			const cell = this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
			const runButton = cell.getByLabel('Run cell');

			await runButton.click();

			// Wait for execution to complete by checking the execution spinner is gone
			const spinner = cell.getByLabel('Cell is executing');

			// Wait for spinner to appear (cell is executing)
			await expect(spinner).toBeVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => {
				// Spinner might not appear for very fast executions, that's okay
			});

			// Wait for spinner to disappear (execution complete)
			await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Start executing code in the current cell by clicking the run button without waiting for completion
	 */
	async startExecutingCodeInCell(cellIndex = 0): Promise<void> {
		await test.step('Start executing code in Positron notebook cell', async () => {
			// Select the cell first
			await this.selectCellAtIndex(cellIndex);

			// Find and click the run button for this specific cell
			const cell = this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
			const runButton = cell.getByLabel('Run cell');

			await runButton.click();
		});
	}

	/**
	 * Get execution info icon for a specific cell
	 */
	getExecutionInfoIcon(cellIndex = 0): Locator {
		const cell = this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
		return cell.getByLabel('Cell execution info');
	}

	/**
	 * Get the execution info popup
	 */
	getExecutionInfoPopup(): Locator {
		return this.code.driver.page.getByRole('tooltip', { name: 'Cell execution details' });
	}

	/**
	 * Get the execution status for a specific cell
	 */
	async getExecutionStatus(cellIndex = 0): Promise<string | null> {
		const icon = this.getExecutionInfoIcon(cellIndex);
		return await icon.getAttribute('data-execution-status');
	}

	/**
	 * Wait for execution info icon to be visible after cell execution
	 */
	async waitForExecutionInfoIcon(cellIndex = 0, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Wait for execution info icon in cell ${cellIndex}`, async () => {
			const icon = this.getExecutionInfoIcon(cellIndex);
			await expect(icon).toBeVisible({ timeout });
		});
	}

	// -- Verifications --

	/**
	 * Verify: a Positron notebook is visible on the page.
	 */
	async expectToBeVisible(timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step('Verify Positron notebook is visible', async () => {
			await expect(this.positronNotebook).toBeVisible({ timeout });
		});
	}


}
