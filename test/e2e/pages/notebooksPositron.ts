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
import { app } from 'electron';

type SettingsFixture = {
	set: (
		settings: Record<string, unknown>,
		options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }
	) => Promise<void>;
};

type ConfigureNotebookEditorOptions = {
	editor: 'positron' | 'default';
	reload?: boolean | 'web';
	waitMs?: number;
};


const DEFAULT_TIMEOUT = 10000;

/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	positronNotebook = this.code.driver.page.locator('.positron-notebook').first();
	cell = this.code.driver.page.locator('[data-testid="notebook-cell"]');
	newCellButton = this.code.driver.page.getByLabel(/new code cell/i);
	editorAtIndex = (index: number) => this.cell.nth(index).locator('.positron-cell-editor-monaco-widget textarea');
	runCellButtonAtIndex = (index: number) => this.cell.nth(index).getByLabel(/execute cell/i);
	spinner = this.code.driver.page.getByLabel(/cell is executing/i);
	spinnerAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell is executing/i);
	cellExecutionInfoAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell execution info/i);
	executionStatusAtIndex = (index: number) => this.cell.nth(index).locator('[data-execution-status]');
	detectingKernelsText = this.code.driver.page.getByText(/detecting kernels/i);
	cellStatusSyncIcon = this.code.driver.page.locator('.cell-status-item-has-runnable .codicon-sync');
	kernelStatusBadge = this.code.driver.page.getByTestId('notebook-kernel-status');
	deleteCellButton = this.cell.getByRole('button', { name: /delete the selected cell/i });
	cellInfoToolTip = this.code.driver.page.getByRole('tooltip', { name: /cell execution details/i });
	cellInfoToolTipStatus = this.cellInfoToolTip.getByLabel('Execution status');
	cellInfoToolTipDuration = this.cellInfoToolTip.getByLabel('Execution duration');
	cellInfoToolTipOrder = this.cellInfoToolTip.getByLabel('Execution order');
	cellInfoToolTipCompleted = this.cellInfoToolTip.getByLabel('Execution completed');

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys) {
		super(code, quickinput, quickaccess, hotKeys);
	}

	// -- Actions --

	/**
	 * Action: Enable the Positron Notebooks feature
	 * @param settings - The settings fixture.
	 * @param options - Configuration options for enabling the feature.
	 */
	async enableFeature(
		settings: SettingsFixture,
		{ editor, reload = false, waitMs = 800 }: ConfigureNotebookEditorOptions
	): Promise<void> {
		const associations = editor === 'positron'
			? { '*.ipynb': 'workbench.editor.positronNotebook' }
			: {};

		await settings.set(
			{
				'positron.notebook.enabled': true,
				'workbench.editorAssociations': associations,
			},
			{ reload, waitMs, waitForReady: true }
		);
	}

	/**
	 * Action: Open a Positron notebook.
	 * @param path - The path to the notebook to open.
	 */
	async openNotebook(path: string): Promise<void> {
		await super.openNotebook(path, false);
		await this.expectToBeVisible();
	}

	/**
	 * @override
	 * Action: Select a cell at the specified index.
	 * @param cellIndex - The index of the cell to select.
	 */
	async selectCellAtIndex(cellIndex: number, { exitEditMode = false }: { exitEditMode?: boolean } = {}): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}`, async () => {
			await this.cell.nth(cellIndex).click();

			await this.expectCellIndexToBeSelected(cellIndex, { isSelected: true, inEditMode: true });

			if (exitEditMode) {
				await this.code.driver.page.keyboard.press('Escape');
				await this.expectCellIndexToBeSelected(cellIndex, { isSelected: true, inEditMode: false });
			}
		});
	}

	/**
	 * Action: Create a new code cell at the END of the notebook.
	 */
	private async addCodeCellToEnd(): Promise<void> {
		await test.step(`Create new code cell at end:`, async () => {
			const newCellButtonCount = await this.newCellButton.count();

			if (newCellButtonCount === 0) {
				throw new Error('No "New Code Cell" buttons found');
			}

			// Click the last "New Code Cell" button to add a cell at the end
			await this.newCellButton.last().click();
			await expect(this.cell).toHaveCount(newCellButtonCount + 1, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Action: Run the code in the cell at the specified index.
	 */
	async runCodeAtIndex(cellIndex = 0): Promise<void> {
		await test.step('Execute code in Positron notebook cell', async () => {

			await this.selectCellAtIndex(cellIndex);
			await this.runCellButtonAtIndex(cellIndex).click();

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
	 * Action: Move the mouse away from the notebook area to close any open tooltips/popups.
	 */
	async moveMouseAway(): Promise<void> {
		await this.code.driver.page.mouse.move(0, 0);
	};

	/**
	 * Action: Add code to a cell at the specified index and run it.
	 *
	 * @param code - The code to add to the cell.
	 * @param cellIndex - The index of the cell to add code to (default: 0).
	 * @param options - Options to control behavior:
	 * delay: Optional delay between keystrokes for typing simulation (default: 0, meaning no delay).
	 * run: Whether to run the cell after adding code (default: false).
	 * waitForSpinner: Whether to wait for the execution spinner to appear and disappear (default: false).
	 * waitForPopup: Whether to wait for the execution info popup to appear after running (default: false).
	 */
	async addCodeToCell(
		cellIndex: number,
		code: string,
		options?: { delay?: number; run?: boolean; waitForSpinner?: boolean; waitForPopup?: boolean }
	): Promise<Locator> {
		const { delay = 0, run = false, waitForSpinner = false, waitForPopup = false } = options ?? {};
		return await test.step(`Add code and run cell ${cellIndex}`, async () => {
			const currentCellCount = await this.cell.count();

			if (cellIndex >= currentCellCount) {
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}
				await this.addCodeCellToEnd();
			}

			await this.cell.nth(cellIndex).click();

			const editor = this.editorAtIndex(cellIndex);
			await editor.focus();

			if (delay) {
				await editor.pressSequentially(code, { delay });
			} else {
				await editor.fill(code);
			}

			if (run) {
				await this.runCellButtonAtIndex(cellIndex).click();

				if (waitForSpinner) {
					const spinner = this.spinnerAtIndex(cellIndex);
					await expect(spinner).toBeVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => {
						// Spinner might not appear for very fast executions, that's okay
					});
					await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
				}

				if (waitForPopup) {
					// const infoPopup = this.cell.nth(cellIndex).getByRole('tooltip', { name: /cell execution details/i });
					await expect(this.cellInfoToolTip).toBeVisible();
				}
			}

			return this.cell.nth(cellIndex);
		});
	}

	/**
	 * Action: Perform a cell action using keyboard shortcuts.
	 * @param action - The action to perform: 'copy', 'cut', 'paste', 'undo', 'redo', 'addCellBelow'.
	 */
	async performCellAction(action: 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'delete' | 'addCellBelow'): Promise<void> {
		// Press escape to ensure focus is out of the cell editor
		await this.code.driver.page.keyboard.press('Escape');

		switch (action) {
			case 'copy':
				await this.hotKeys.copy();
				break;
			case 'cut':
				await this.hotKeys.cut();
				break;
			case 'paste':
				await this.hotKeys.paste();
				break;
			case 'undo':
				await this.hotKeys.undo();
				break;
			case 'redo':
				await this.hotKeys.redo();
				break;
			case 'delete':
				await this.code.driver.page.keyboard.press('Backspace');
				break;
			case 'addCellBelow':
				await this.code.driver.page.keyboard.press('KeyB');
				break;
			default:
				throw new Error(`Unknown cell action: ${action}`);
		}
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
 * Verify: Cell count matches expected count.
 * @param expectedCount - The expected number of cells.
 */
	async expectCellCountToBe(expectedCount: number): Promise<void> {
		await test.step(`Expect cell count to be ${expectedCount}`, async () => {
			await expect(this.cell).toHaveCount(expectedCount, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Verify: Cell content at specified index matches expected content.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedContent - The expected content of the cell.
	 */
	async expectCellContentAtIndexToBe(cellIndex: number, expectedContent: string): Promise<void> {
		await test.step(`Expect cell ${cellIndex} content to be: ${expectedContent}`, async () => {
			const actualContent = await this.getCellContent(cellIndex);
			await expect(async () => {
				expect(actualContent).toBe(expectedContent);
			}).toPass({ timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Verify: Cell content at specified index contains expected substring.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedSubstring - The substring expected to be contained in the cell content.
	 */
	/**
	 * Verify: Cell content at specified index contains expected substring or matches RegExp.
	 * @param cellIndex - The index of the cell to check.
	 * @param expected - The substring or RegExp expected to be contained in the cell content.
	 */
	async expectCellContentAtIndexToContain(cellIndex: number, expected: string | RegExp): Promise<void> {
		await test.step(
			`Expect cell ${cellIndex} content to contain: ${expected instanceof RegExp ? expected.toString() : expected}`,
			async () => {
				const actualContent = await this.getCellContent(cellIndex);
				await expect(async () => {
					if (expected instanceof RegExp) {
						expect(actualContent).toMatch(expected);
					} else {
						expect(actualContent).toContain(expected);
					}
				}).toPass({ timeout: DEFAULT_TIMEOUT });
			}
		);
	}

	/**
	 * Verify: Cell info tooltip contains expected content.
	 * @param expectedContent - Object with expected content to verify.
	 *                          Use RegExp for fields where exact match is not feasible (e.g., duration, completed time).
	 */
	async expectToolTipToContain(expectedContent: { order?: number; duration?: RegExp; status?: 'Success' | 'Failed' | 'Currently running...'; completed?: RegExp }): Promise<void> {
		await test.step(`Expect cell info tooltip to contain: ${JSON.stringify(expectedContent)}`, async () => {
			await expect(this.cellInfoToolTip).toBeVisible({ timeout: DEFAULT_TIMEOUT });

			const labelMap: Record<keyof typeof expectedContent, string> = {
				order: 'Execution Order',
				duration: 'Duration',
				status: 'Status',
				completed: 'Completed'
			};

			const getValueLocator = (label: string) =>
				this.code.driver.page
					.locator('.popup-label-text', { hasText: label })
					.locator('..')
					.locator('.popup-value-text');

			for (const key of Object.keys(expectedContent) as (keyof typeof expectedContent)[]) {
				const expectedValue = expectedContent[key];
				if (expectedValue !== undefined) {
					if (key === 'status' && expectedValue === 'Currently running...') {
						// Special case when cell is actively running: check for label, not value
						const labelLocator = this.code.driver.page.locator('.popup-label', { hasText: 'Currently running...' });
						await expect(labelLocator).toBeVisible({ timeout: DEFAULT_TIMEOUT });
					} else {
						const valueLocator = getValueLocator(labelMap[key]);
						const expectedText = expectedValue instanceof RegExp ? expectedValue : expectedValue.toString();
						await expect(valueLocator).toContainText(expectedText, { timeout: DEFAULT_TIMEOUT });
					}
				}
			}
		});
	}


	/**
	 * Verify: Cell execution status matches expected status.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedStatus - The expected execution status of the cell.
	 * @param timeout - The timeout for the expectation.
	 */
	async expectExecutionStatusToBe(cellIndex: number, expectedStatus: 'running' | 'idle' | 'failed' | 'success', timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect execution status to be: ${expectedStatus}`, async () => {
			await expect(this.executionStatusAtIndex(cellIndex)).toHaveAttribute('data-execution-status', expectedStatus, { timeout });
		});
	}


	async expectSpinnerAtIndex(cellIndex: number, visible = true, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect spinner to be ${visible ? 'visible' : 'hidden'} in cell ${cellIndex}`, async () => {
			if (visible) {
				await expect(this.spinnerAtIndex(cellIndex)).toBeVisible({ timeout });
			} else {
				await expect(this.spinnerAtIndex(cellIndex)).toHaveCount(0, { timeout });
			}
		});
	}

	async expectNoActiveSpinners(timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step('Expect no active spinners in notebook', async () => {
			await expect(this.spinner).toHaveCount(0, { timeout });
		});
	}

	/**
	 * Verify: Cell info tooltip visibility.
	 * @param visible - Whether the tooltip should be visible.
	 * @param timeout - Timeout for the expectation.
	 */
	async expectToolTipVisible(visible: boolean, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect cell info tooltip to be ${visible ? 'visible' : 'hidden'}`, async () => {
			const assertion = expect(this.cellInfoToolTip);
			if (visible) {
				await assertion.toBeVisible({ timeout });
			} else {
				await assertion.not.toBeVisible({ timeout });
			}
		});
	}

	/**
	 * Get the index of the currently focused cell.
	 * @returns The index of the focused cell, or null if no cell is focused.
	 */
	async getFocusedCellIndex(): Promise<number | null> {
		const cells = this.cell;
		const cellCount = await cells.count();

		for (let i = 0; i < cellCount; i++) {
			const cell = cells.nth(i);
			const isFocused = await cell.evaluate((element) => {
				// Check if this cell or any descendant has focus
				return element.contains(document.activeElement) ||
					element === document.activeElement;
			});

			if (isFocused) {
				return i;
			}
		}
		return null;
	}

	// /**
	//  * Verify: the focused cell index is (or is not) the expected index.
	//  * @param expectedIndex - The expected index of the focused cell, or null if no cell should be focused.
	//  * @param timeout - Timeout for the expectation.
	//  * @param shouldBeFocused - If true, checks that the cell is focused; if false, checks that it is not focused.
	//  */
	// async expectCellIndexToBeFocused(
	// 	expectedIndex: number | null,
	// 	shouldBeFocused = true,
	// 	timeout = 1000000,
	// ): Promise<void> {
	// 	await test.step(
	// 		`Expect focused cell index to be${shouldBeFocused ? '' : ' not'}: ${expectedIndex}`,
	// 		async () => {
	// 			await expect(async () => {
	// 				const actualIndex = await this.getFocusedCellIndex();
	// 				shouldBeFocused
	// 					? expect(actualIndex).toBe(expectedIndex)
	// 					: expect(actualIndex).not.toBe(expectedIndex);
	// 			}).toPass({ timeout });
	// 		}
	// 	);
	// }

	/**
	 * Verify: the cell at the specified index is (or is not) selected,
	 * and optionally, whether it is in edit mode.
	 * @param expectedIndex - The index of the cell to check.
	 * @param options - Options to specify selection and edit mode expectations.
	 */
	async expectCellIndexToBeSelected(
		expectedIndex: number,
		options?: { isSelected?: boolean; inEditMode?: boolean; timeout?: number }
	): Promise<void> {
		const {
			isSelected = true,
			inEditMode = undefined,
			timeout = DEFAULT_TIMEOUT
		} = options ?? {};

		await test.step(
			`Expect cell at index ${expectedIndex} to be${isSelected ? '' : ' not'} selected`
			+ (inEditMode !== undefined ? ` and${inEditMode ? '' : ' not'} in edit mode` : ''),
			async () => {
				await expect(async () => {
					const cells = this.cell;
					const cellCount = await cells.count();
					const selectedIndices: number[] = [];

					for (let i = 0; i < cellCount; i++) {
						const cell = cells.nth(i);
						const isSelected = (await cell.getAttribute('aria-selected')) === 'true';
						if (isSelected) {
							selectedIndices.push(i);
						}
					}

					isSelected
						? expect(selectedIndices).toContain(expectedIndex)
						: expect(selectedIndices).not.toContain(expectedIndex);

					if (inEditMode !== undefined) {
						const ta = this.editorAtIndex(expectedIndex);
						const isEditing = await ta.evaluate(el => el === document.activeElement);
						inEditMode
							? expect(isEditing).toBe(true)
							: expect(isEditing).toBe(false);
					}
				}).toPass({ timeout });
			}
		);
	}

	// 	/**
	//  * Return the index of the cell that is in EDIT MODE (i.e., Monaco textarea is focused).
	//  * @returns index or null if none are in edit mode.
	//  */
	// 	async getEditingCellIndex(): Promise<number | null> {
	// 		const cells = this.cell;
	// 		const count = await cells.count();

	// 		for (let i = 0; i < count; i++) {
	// 			const ta = this.editorAtIndex(i); // '.positron-cell-editor-monaco-widget textarea'
	// 			// Check the textarea is the active element (edit mode).
	// 			const isEditing = await ta.evaluate((el) => el === document.activeElement);
	// 			if (isEditing) return i;
	// 		}
	// 		return null;
	// 	}

	// /**
	//  * Verify a specific cell IS / IS NOT in edit mode.
	//  * Edit mode is defined as the Monaco textarea being focused.
	//  */
	// async expectCellEditModeAtIndex(
	// 	index: number,
	// 	shouldBeEditing = true,
	// 	timeout = DEFAULT_TIMEOUT
	// ): Promise<void> {
	// 	await test.step(`Expect cell ${index} to be${shouldBeEditing ? '' : ' not'} in edit mode`, async () => {
	// 		const ta = this.editorAtIndex(index);
	// 		if (shouldBeEditing) {
	// 			await expect(ta).toBeFocused({ timeout });
	// 		} else {
	// 			await expect(ta).not.toBeFocused({ timeout });
	// 		}
	// 	});
	// }
}


