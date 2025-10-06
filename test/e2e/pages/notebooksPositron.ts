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
import { time } from 'console';

const DEFAULT_TIMEOUT = 10000;

/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	positronNotebook = this.code.driver.page.locator('.positron-notebook').first();
	cell = this.code.driver.page.locator('[data-testid="notebook-cell"]');
	newCellButton = this.code.driver.page.getByLabel(/new code cell/i);
	editorAtIndex = (index: number) => this.cell.nth(index).locator('.positron-cell-editor-monaco-widget textarea');
	runCellAtIndex = (index: number) => this.cell.nth(index).getByLabel(/execute cell/i);
	spinnerAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell is executing/i);
	cellExecutionInfoAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell execution info/i);
	detectingKernelsText = this.code.driver.page.getByText(/detecting kernels/i);
	cellStatusSyncIcon = this.code.driver.page.locator('.cell-status-item-has-runnable .codicon-sync');
	kernelStatusBadge = this.code.driver.page.getByTestId('notebook-kernel-status');
	deleteCellButton = this.cell.getByRole('button', { name: /delete the selected cell/i });


	// Selector constants for Positron notebook elements
	// private static readonly RUN_CELL_LABEL = /execute cell/i;
	// private static readonly NOTEBOOK_CELL_SELECTOR = '[data-testid="notebook-cell"]';
	// private static readonly NEW_CODE_CELL_LABEL = /new code cell/i;
	// private static readonly MONACO_EDITOR_SELECTOR = '.positron-cell-editor-monaco-widget textarea';
	// private static readonly CELL_EXECUTING_LABEL = /cell is executing/i;
	// private static readonly CELL_EXECUTION_INFO_LABEL = /cell execution info/i;
	// private static readonly NOTEBOOK_KERNEL_STATUS_TESTID = 'notebook-kernel-status';
	// private static readonly DELETE_CELL_LABEL = /delete the selected cell/i;
	// private static readonly POSITRON_NOTEBOOK_SELECTOR = '.positron-notebook';
	// private static readonly CELL_STATUS_SYNC_SELECTOR = '.cell-status-item-has-runnable .codicon-sync';
	// private static readonly DETECTING_KERNELS_TEXT = /detecting kernels/i;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		super(code, quickinput, quickaccess, hotKeys);
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
	 * Action: Select a cell at the specified index.
	 */
	async selectCellAtIndex(cellIndex: number): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}`, async () => {
			await this.cell.nth(cellIndex).click();
		});
	}

	/**
	 * Action: Create a new code cell at the END of the notebook.
	 */
	private async createNewCodeCell(): Promise<void> {
		await test.step(`Create new code cell`, async () => {
			const newCellButtonCount = await this.newCellButton.count();

			if (newCellButtonCount === 0) {
				throw new Error('No "New Code Cell" buttons found');
			}

			// Click the last button (which adds a cell at the end)
			// Note: This assumes we're always adding at the end, which matches the validation in addCodeToCellAtIndex
			await this.newCellButton.last().click();

			// Wait for the new cell to appear
			await expect(this.cell).toHaveCount(newCellButtonCount + 1, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Action: Add code to a cell at the specified index.
	 * If the cell does not exist, it creates it at the end of the notebook.
	 * Throws an error if trying to create a cell beyond the next sequential index.
	 *
	 * @param code - The code to add to the cell.
	 * @param cellIndex - The index of the cell to add code to (default: 0).
	 * @param delay - Optional delay between keystrokes for typing simulation (default: 0, meaning no delay).
	 */
	async addCodeToCellAtIndex(code: string, cellIndex = 0, delay = 0): Promise<void> {
		await test.step('Add code to Positron cell', async () => {
			// Check if the cell exists
			const currentCellCount = await this.cell.count();

			if (cellIndex >= currentCellCount) {
				// Cell doesn't exist, need to create it
				// Verify we're only adding one cell at the end
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}

				// Create the new cell
				await this.createNewCodeCell();
			}

			// Now select and fill the cell (existing logic)
			await this.selectCellAtIndex(cellIndex);

			// Ensure editor is focused and type/fill the code
			await this.editorAtIndex(cellIndex).focus();
			if (delay) {
				await this.editorAtIndex(cellIndex).pressSequentially(code, { delay });
			} else {
				await this.editorAtIndex(cellIndex).fill(code);
			}
		});
	}

	/**
	 * Execute code in the current cell by clicking the run button
	 */
	async executeCodeInCell(cellIndex = 0): Promise<void> {
		await test.step('Execute code in Positron notebook cell', async () => {

			await this.selectCellAtIndex(cellIndex);
			await this.runCellAtIndex(cellIndex).click();

			// Wait for execution to complete by checking the execution spinner is gone
			const spinner = this.spinnerAtIndex(cellIndex);

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
			await this.selectCellAtIndex(cellIndex);
			await this.runCellAtIndex(cellIndex).click();
		});
	}

	/**
	 * Add code to a cell and run it - combined operation for efficiency.
	 * This avoids repeatedly finding the same cell and provides better performance.
	 * Returns the cell locator for further operations.
	 */
	async addCodeToCellAndRun(code: string, cellIndex = 0, delay = 0): Promise<Locator> {
		return await test.step(`Add code and run cell ${cellIndex}`, async () => {
			// Check if the cell exists
			const currentCellCount = await this.cell.count();

			if (cellIndex >= currentCellCount) {
				// Cell doesn't exist, need to create it
				// Verify we're only adding one cell at the end
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}

				await this.createNewCodeCell();
			}

			await this.cell.nth(cellIndex).click()

			// Find and fill the Monaco editor
			const editor = this.editorAtIndex(cellIndex);
			await editor.focus();

			if (delay) {
				await editor.pressSequentially(code, { delay });
			} else {
				await editor.fill(code);
			}

			// Find and click the run button
			await this.runCellAtIndex(cellIndex).click();

			// // Wait for execution to complete
			// const spinner = cell.getByLabel('Cell is executing');

			// // Wait for spinner to appear (cell is executing)
			// await expect(spinner).toBeVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => {
			// 	// Spinner might not appear for very fast executions, that's okay
			// });

			// // Wait for spinner to disappear (execution complete)
			// await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
			return this.cell.nth(cellIndex);
		});
	}

	/**
	 * Helper function to copy cells using keyboard shortcut
	 */
	async copyCellsWithKeyboard(): Promise<void> {
		// We need to press escape to get the focus out of the cell editor itself
		await this.code.driver.page.keyboard.press('Escape');
		await this.hotKeys.copy();
	}

	async cutCellsWithKeyboard(): Promise<void> {
		// We need to press escape to get the focus out of the cell editor itself
		await this.code.driver.page.keyboard.press('Escape');
		await this.hotKeys.cut();
	}

	async pasteCellsWithKeyboard(): Promise<void> {
		// We need to press escape to get the focus out of the cell editor itself
		await this.code.driver.page.keyboard.press('Escape');
		await this.hotKeys.paste();
	}

	async expectCellCountToBe(expectedCount: number): Promise<void> {
		await test.step(`Expect cell count to be ${expectedCount}`, async () => {
			await expect(this.cell).toHaveCount(expectedCount, { timeout: DEFAULT_TIMEOUT });
		});
	}

	async expectCellContentAtIndexToBe(cellIndex: number, expectedContent: string): Promise<void> {
		await test.step(`Expect cell ${cellIndex} content to be: ${expectedContent}`, async () => {
			const actualContent = await this.getCellContent(cellIndex);
			await expect(async () => {
				expect(actualContent).toBe(expectedContent);
			}).toPass({ timeout: DEFAULT_TIMEOUT });
		});
	}


	/**
	 * Get execution info icon for a specific cell
	 */
	getExecutionInfoIcon(cellIndex = 0): Locator {
		return this.cellExecutionInfoAtIndex(cellIndex);
		// return this.cell.nth(cellIndex).getByLabel(/cell execution info/i);
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
	async expectExecutionInfoIconToBeVisible(cellIndex = 0, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Wait for execution info icon in cell ${cellIndex}`, async () => {
			const icon = this.getExecutionInfoIcon(cellIndex);
			await expect(icon).toBeVisible({ timeout });
		});
	}

	/**
	 * Select interpreter and wait for the kernel to be ready.
	 * This combines selecting the interpreter with waiting for kernel connection to prevent flakiness.
	 * Directly implements Positron-specific logic without unnecessary notebook type detection.
	 */
	async selectAndWaitForKernel(
		kernelGroup: 'Python' | 'R',
		desiredKernel = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!
	): Promise<void> {
		await test.step(`Select kernel and wait for ready: ${desiredKernel}`, async () => {
			// Ensure notebook is visible
			await this.expectToBeVisible();

			// Wait for kernel detection to complete
			await expect(this.cellStatusSyncIcon).not.toBeVisible({ timeout: 30000 });
			await expect(this.detectingKernelsText).not.toBeVisible({ timeout: 30000 });

			// Get the kernel status badge using data-testid
			await expect(this.kernelStatusBadge).toBeVisible({ timeout: 5000 });

			try {
				// Check if the desired kernel is already selected
				const currentKernelText = await this.kernelStatusBadge.textContent();
				if (currentKernelText && currentKernelText.includes(desiredKernel) && currentKernelText.includes('Connected')) {
					this.code.logger.log(`Kernel already selected and connected: ${desiredKernel}`);
					return;
				}
			} catch (e) {
				this.code.logger.log('Could not check current kernel status');
			}

			// Need to select the kernel
			try {
				// Click on kernel status badge to open selection
				this.code.logger.log(`Clicking kernel status badge to select: ${desiredKernel}`);
				await this.kernelStatusBadge.click();

				// Wait for kernel selection UI to appear
				await this.quickinput.waitForQuickInputOpened();

				// Select the desired kernel
				await this.quickinput.selectQuickInputElementContaining(desiredKernel);
				await this.quickinput.waitForQuickInputClosed();

				this.code.logger.log(`Selected kernel: ${desiredKernel}`);
			} catch (e) {
				this.code.logger.log(`Failed to select kernel: ${e}`);
				throw e;
			}

			// Wait for the kernel status to show "Connected"
			await expect(this.kernelStatusBadge).toContainText('Connected', { timeout: 30000 });
			this.code.logger.log('Kernel is connected and ready');
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


	/**
	 * Helper function to set notebook editor associations
	 * @param settings - The settings fixture
	 * @param editor - 'positron' to use Positron notebook editor, 'default' to clear associations
	 * @param waitMs - The number of milliseconds to wait for the settings to be applied
	 */
	async setNotebookEditor(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		},
		editor: 'positron' | 'default',
		waitMs = 800
	) {
		await settings.set({
			'positron.notebook.enabled': true,
			'workbench.editorAssociations': editor === 'positron'
				? { '*.ipynb': 'workbench.editor.positronNotebook' }
				: {}
		}, { waitMs });
	}

	/**
	 * Helper function to enable Positron notebooks with reload
	 * @param settings - The settings fixture
	 */
	async enablePositronNotebooks(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		}
	) {
		await settings.set({
			'positron.notebook.enabled': true,
		}, { reload: true });
	}

	/**
	 * Helper function to delete cell using action bar delete button
	 */
	async deleteCellWithActionBar(cellIndex = 0): Promise<void> {
		await test.step(`Delete cell ${cellIndex} using action bar`, async () => {
			// Get the current cell count before deletion
			const initialCount = await this.cell.count();

			// Click on the cell to make the action bar visible
			await this.cell.nth(cellIndex).click();

			// Click the delete button
			await this.deleteCellButton.click();

			// Wait for the deletion to complete by checking cell count decreased
			await expect(this.cell).toHaveCount(initialCount - 1, { timeout: DEFAULT_TIMEOUT });

			// Give a small delay for focus to settle
			await this.code.driver.page.waitForTimeout(100);
		});
	}

	/**
	 * Get cell content for identification
	 */
	async getCellContent(cellIndex: number): Promise<string> {
		const cell = this.code.driver.page.locator('[data-testid="notebook-cell"]').nth(cellIndex);
		const editor = cell.locator('.positron-cell-editor-monaco-widget .view-lines');
		const content = await editor.textContent() ?? '';
		// Replace the weird ascii space with a proper space
		return content.replace(/\u00a0/g, ' ');
	}
}
