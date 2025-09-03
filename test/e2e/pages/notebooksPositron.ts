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

	// Selector constants for Positron notebook elements
	private static readonly RUN_CELL_LABEL = /execute cell/i;
	private static readonly NOTEBOOK_CELL_SELECTOR = '[data-testid="notebook-cell"]';
	private static readonly NEW_CODE_CELL_LABEL = /new code cell/i;
	private static readonly MONACO_EDITOR_SELECTOR = '.positron-cell-editor-monaco-widget textarea';
	private static readonly CELL_EXECUTING_LABEL = /cell is executing/i;
	private static readonly CELL_EXECUTION_INFO_LABEL = /cell execution info/i;
	private static readonly NOTEBOOK_KERNEL_STATUS_LABEL = /notebook kernel status/i;
	private static readonly DELETE_CELL_LABEL = /delete the selected cell/i;
	private static readonly POSITRON_NOTEBOOK_SELECTOR = '.positron-notebook';
	private static readonly CELL_STATUS_SYNC_SELECTOR = '.cell-status-item-has-runnable .codicon-sync';
	private static readonly DETECTING_KERNELS_TEXT = /detecting kernels/i;

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		super(code, quickinput, quickaccess, hotKeys);

		this.positronNotebook = this.code.driver.page.locator(PositronNotebooks.POSITRON_NOTEBOOK_SELECTOR).first();
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
			await this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex).click();
		});
	}

	/**
	 * Get the current number of cells in the notebook
	 */
	private async getCellCount(): Promise<number> {
		return await this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).count();
	}

	/**
	 * Create a new code cell at the specified index
	 */
	private async createNewCodeCell(index: number): Promise<void> {
		await test.step(`Create new code cell at index ${index}`, async () => {
			// Find all "New Code Cell" buttons - they appear between cells
			const addCellButtons = this.code.driver.page.getByLabel(PositronNotebooks.NEW_CODE_CELL_LABEL);
			const buttonCount = await addCellButtons.count();

			if (buttonCount === 0) {
				throw new Error('No "New Code Cell" buttons found');
			}

			// Click the last button (which adds a cell at the end)
			// Note: This assumes we're always adding at the end, which matches the validation in addCodeToCellAtIndex
			await addCellButtons.last().click();

			// Wait for the new cell to appear
			await expect(this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(index)).toBeVisible({ timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Override addCodeToCellAtIndex to use Positron-specific selectors and Monaco editor
	 */
	async addCodeToCellAtIndex(code: string, cellIndex = 0, delay = 0): Promise<void> {
		await test.step('Add code to Positron cell', async () => {
			// Check if the cell exists
			const currentCellCount = await this.getCellCount();

			if (cellIndex >= currentCellCount) {
				// Cell doesn't exist, need to create it
				// Verify we're only adding one cell at the end
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}

				// Create the new cell
				await this.createNewCodeCell(cellIndex);
			}

			// Now select and fill the cell (existing logic)
			await this.selectCellAtIndex(cellIndex);

			// Get the specific cell's editor
			const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);
			const editor = cell.locator(PositronNotebooks.MONACO_EDITOR_SELECTOR);

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
			const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);
			const runButton = cell.getByLabel(PositronNotebooks.RUN_CELL_LABEL);

			await runButton.click();

			// Wait for execution to complete by checking the execution spinner is gone
			const spinner = cell.getByLabel(PositronNotebooks.CELL_EXECUTING_LABEL);

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
			const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);
			const runButton = cell.getByLabel(PositronNotebooks.RUN_CELL_LABEL);

			await runButton.click();
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
			const currentCellCount = await this.getCellCount();

			if (cellIndex >= currentCellCount) {
				// Cell doesn't exist, need to create it
				// Verify we're only adding one cell at the end
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}

				// Create the new cell
				await this.createNewCodeCell(cellIndex);
			}

			// Get the cell once and reuse the reference
			const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);

			// Select the cell
			await cell.click();

			// Find and fill the Monaco editor
			const editor = cell.locator(PositronNotebooks.MONACO_EDITOR_SELECTOR);
			await editor.focus();

			if (delay) {
				await editor.pressSequentially(code, { delay });
			} else {
				await editor.fill(code);
			}

			// Find and click the run button
			const runButton = cell.getByLabel(PositronNotebooks.RUN_CELL_LABEL);
			await runButton.click();

			// // Wait for execution to complete
			// const spinner = cell.getByLabel('Cell is executing');

			// // Wait for spinner to appear (cell is executing)
			// await expect(spinner).toBeVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => {
			// 	// Spinner might not appear for very fast executions, that's okay
			// });

			// // Wait for spinner to disappear (execution complete)
			// await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
			return cell;
		});
	}

	/**
	 * Get execution info icon for a specific cell
	 */
	getExecutionInfoIcon(cellIndex = 0): Locator {
		const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);
		return cell.getByLabel(PositronNotebooks.CELL_EXECUTION_INFO_LABEL);
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
			await expect(this.code.driver.page.locator(PositronNotebooks.CELL_STATUS_SYNC_SELECTOR)).not.toBeVisible({ timeout: 30000 });
			await expect(this.code.driver.page.getByText(PositronNotebooks.DETECTING_KERNELS_TEXT)).not.toBeVisible({ timeout: 30000 });

			// Get the kernel status badge using aria-label
			const kernelStatusBadge = this.code.driver.page.getByLabel(PositronNotebooks.NOTEBOOK_KERNEL_STATUS_LABEL);
			await expect(kernelStatusBadge).toBeVisible({ timeout: 5000 });

			try {
				// Check if the desired kernel is already selected
				const currentKernelText = await kernelStatusBadge.textContent();
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
				await kernelStatusBadge.click();

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
			await expect(kernelStatusBadge).toContainText('Connected', { timeout: 30000 });
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
			const initialCount = await this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).count();

			// Get the specific cell
			const cell = this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR).nth(cellIndex);

			// Hover over the cell to make the action bar visible
			await cell.hover();

			// Find and click the delete button in the action bar
			const deleteButton = cell.getByLabel(PositronNotebooks.DELETE_CELL_LABEL);

			// Wait for the delete button to be visible
			await expect(deleteButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });

			// Click the delete button
			await deleteButton.click();

			// Wait for the deletion to complete by checking cell count decreased
			await expect(this.code.driver.page.locator(PositronNotebooks.NOTEBOOK_CELL_SELECTOR)).toHaveCount(initialCount - 1, { timeout: DEFAULT_TIMEOUT });

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
		const content = await editor.textContent();
		return content ?? '';
	}
}
