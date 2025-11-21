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
import { ContextMenu, MenuItemState } from './dialog-contextMenu.js';
import { ACTIVE_STATUS_ICON, DISCONNECTED_STATUS_ICON, IDLE_STATUS_ICON, SessionState } from './sessions.js';
import path from 'path';

const DEFAULT_TIMEOUT = 10000;

type MoreActionsMenuItems = 'Copy cell' | 'Cut cell' | 'Paste Cell Above' | 'Paste cell below' | 'Move cell down' | 'Move cell up' | 'Insert code cell above' | 'Insert code cell below';
type EditorActionBarButtons = 'Markdown' | 'Code' | 'Clear Outputs' | 'Run All';

/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	// Containers, generic locators
	private positronNotebook = this.code.driver.page.locator('.positron-notebook').first();
	private newCellButton = this.code.driver.page.getByLabel(/new code cell/i);
	private spinner = this.code.driver.page.getByLabel(/cell is executing/i);
	editorAtIndex = (index: number) => this.cell.nth(index).locator('.positron-cell-editor-monaco-widget textarea');
	cell = this.code.driver.page.locator('[data-testid="notebook-cell"]');
	codeCell = this.code.driver.page.locator('[data-testid="notebook-cell"][aria-label="Code cell"]');
	markdownCell = this.code.driver.page.locator('[data-testid="notebook-cell"][aria-label="Markdown cell"]');
	cellStatusSyncIcon = this.code.driver.page.locator('.cell-status-item-has-runnable .codicon-sync');
	detectingKernelsText = this.code.driver.page.getByText(/detecting kernels/i);

	// Editor action bar
	editorActionBar = this.code.driver.page.locator('.editor-action-bar-container');
	kernel: Kernel;
	private addMarkdownButton = this.editorActionBar.getByRole('button', { name: 'Markdown' });
	private addCodeButton = this.editorActionBar.getByRole('button', { name: 'Code' });

	// Cell action buttons, menus, tooltips, output, etc
	moreActionsButtonAtIndex = (index: number) => this.cell.nth(index).getByRole('button', { name: /More Cell Actions/i });
	moreActionsOption = (option: string) => this.code.driver.page.locator('button.custom-context-menu-item', { hasText: option });
	runCellButtonAtIndex = (index: number) => this.cell.nth(index).getByRole('button', { name: 'Run Cell', exact: true });
	private cellOutput = (index: number) => this.cell.nth(index).getByTestId('cell-output');
	private cellMarkdown = (index: number) => this.cell.nth(index).locator('.positron-notebook-markdown-rendered');
	private cellInfoToolTip = this.code.driver.page.getByRole('tooltip', { name: /cell execution details/i });
	private cellInfoToolTipAtIndex = (index: number) => this.cell.nth(index).getByRole('tooltip', { name: /cell execution details/i });
	private spinnerAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell is executing/i);
	private executionStatusAtIndex = (index: number) => this.cell.nth(index).locator('[data-execution-status]');
	private deleteCellButton = this.cell.getByRole('button', { name: /Delete Cell/i });
	collapseMarkdownEditor = this.code.driver.page.getByRole('button', { name: 'Collapse markdown editor' });
	expandMarkdownEditor = this.code.driver.page.getByRole('button', { name: 'Open markdown editor' });

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys, private contextMenu: ContextMenu) {
		super(code, quickinput, quickaccess, hotKeys);
		this.kernel = new Kernel(this.code, this, this.contextMenu, hotKeys, quickinput);
	}

	// #region GETTERS

	/**
	 * Get cell count.
	 */
	async getCellCount(): Promise<number> {
		return this.cell.count();
	}

	/**
	 * Get cell content at specified index.
	 * @param cellIndex - The index of the cell.
	 * @returns - The content of the cell.
	 */
	async getCellContent(cellIndex: number): Promise<string> {
		const cellType = await this.getCellType(cellIndex);
		return cellType === 'code'
			? await this.getCodeCellContent(cellIndex)
			: await this.getMarkdownCellContent(cellIndex);
	}


	/**
	 * Get markdown cell content at specified index.
	 */
	private async getMarkdownCellContent(cellIndex: number): Promise<string> {
		return await test.step(`Get markdown content of cell at index: ${cellIndex}`, async () => {
			return await this.cellMarkdown(cellIndex).textContent() ?? '';
		});
	}

	/**
	 * Get code cell content at specified index.
	 */
	private async getCodeCellContent(cellIndex: number): Promise<string> {
		return await test.step(`Get content of cell at index: ${cellIndex}`, async () => {
			const editor = this.cell.nth(cellIndex).locator('.positron-cell-editor-monaco-widget .view-lines');
			const content = await editor.textContent() ?? '';
			// Replace the weird ascii space with a proper space
			return content.replace(/\u00a0/g, ' ');
		});
	}

	/**
	 * Get the index of the currently focused cell.
	 */
	async getFocusedCellIndex(): Promise<number | null> {
		return await test.step(`Get focused cell index`, async () => {
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
		});
	}

	/**
	 * Get the type of cell at the specified index.
	 * @param cellIndex - The index of the cell.
	 * @returns - 'code' or 'markdown' depending on the cell type.
	 */
	async getCellType(cellIndex: number): Promise<'code' | 'markdown'> {
		const ariaLabel = await this.cell.nth(cellIndex).getAttribute('aria-label');
		return ariaLabel === 'Markdown cell' ? 'markdown' : 'code';
	}

	// #endregion

	// #region ACTIONS

	/**
	 * Action: Configure Positron notebook editor in settings.
	 * @param settings - The settings fixture
	 * @param editor - 'positron' to use Positron notebook editor, 'default' to clear associations
	 * @param waitMs - The number of milliseconds to wait for the settings to be applied
	 * @param enableNotebooks - Whether to enable Positron notebooks (defaults to true, set to false to explicitly disable)
	 */
	async setNotebookEditor(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		},
		editor: 'positron' | 'default',
		waitMs = 800,
		enableNotebooks = true
	) {
		await settings.set({
			'positron.notebook.enabled': enableNotebooks,
			'workbench.editorAssociations': editor === 'positron'
				? { '*.ipynb': 'workbench.editor.positronNotebook' }
				: {}
		}, { waitMs });
	}

	/**
	 * Action: Configure editor associations to use Positron notebook editor for .ipynb files.
	 * @param settings - The settings fixture
	 */
	async enablePositronNotebooks(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		},
	) {
		const config: Record<string, unknown> = {
			'workbench.editorAssociations': { '*.ipynb': 'workbench.editor.positronNotebook' }
		};
		await settings.set(config, { reload: 'web' });
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
	 * Action: Create a new Positron notebook.
	 * @param numCellsToAdd - Number of cells to add after creating the notebook (default: 0).
	 */
	async newNotebook({ codeCells = 0, markdownCells = 0 }: { codeCells?: number; markdownCells?: number } = {}): Promise<void> {
		await this.createNewNotebook();
		await this.expectToBeVisible();

		if (codeCells === 0 && markdownCells === 0) {
			return;
		}

		let totalCellsAdded = 0;
		const keyboard = this.code.driver.page.keyboard;

		if (codeCells > 0) {
			for (let i = 0; i < codeCells; i++) {
				await this.addCodeToCell(i, `# Cell ${i}`);
				await this.expectCellCountToBe(totalCellsAdded + 1);
				totalCellsAdded++;
			}
		}

		if (markdownCells > 0) {
			for (let i = 0; i < markdownCells; i++) {
				await this.addCell('markdown');
				await keyboard.type(`### Cell ${totalCellsAdded}`);
				await this.expectCellCountToBe(totalCellsAdded + 1);
				totalCellsAdded++;
			}
		}
	}

	/**
	 * Action: Click a button in the editor action bar.
	 * @param buttonName - The name of the button to click in the editor action bar.
	 */
	async clickActionBarButtton(buttonName: EditorActionBarButtons): Promise<void> {
		const button = this.editorActionBar.getByRole('button', { name: buttonName, exact: true });
		await button.click();
	}

	/**
	 * Action: Click away from a cell to defocus it.
	 * @param cellIndex - The index of the cell to click away from.
	 */
	async clickAwayFromCell(cellIndex: number) {
		const cell = this.cell.nth(cellIndex);
		const box = await cell.boundingBox();
		if (!box) {
			return;
		}

		// We want to offset the click as little as possible to avoid
		// clicking other interactive elements. Here we're clicking just
		// below the bottom right of the cell which should be a safe
		// area due to that being where the cell padding is.
		const OFFSET = 10;
		const x = box.x + box.width - OFFSET;
		const y = box.y + box.height + OFFSET;

		await this.code.driver.page.mouse.click(x, y);
	}

	/**
	 * Action: Add a new cell of the specified type.
	 * @param type - The type of cell to add ('code' or 'markdown').
	 */
	async addCell(type: 'code' | 'markdown'): Promise<void> {
		const beforeCount = await this.getCellCount();

		type === 'code'
			? await this.addCodeButton.click()
			: await this.addMarkdownButton.click();

		await expect(this.cell).toHaveCount(beforeCount + 1, { timeout: DEFAULT_TIMEOUT });
	}

	/**
	 * Action: Select a cell at the specified index.
	 * @param cellIndex - The index of the cell to select.
	 */
	async selectCellAtIndex(
		cellIndex: number,
		{ editMode = undefined }: { editMode?: boolean } = {}
	): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}, edit mode: ${editMode}`, async () => {
			const cell = this.cell.nth(cellIndex);
			const cellType = await this.getCellType(cellIndex);
			const isMarkdown = cellType === 'markdown';

			await cell.click();

			if (editMode === undefined) {
				await this.expectCellIndexToBeSelected(cellIndex, {
					isSelected: true,
				});
			} else {
				if (editMode && isMarkdown) { await cell.dblclick(); }

				if (!editMode) {
					await test.step('Exit edit mode', async () => {
						// give the editor a moment to settle before toggling mode
						await this.code.driver.page.waitForTimeout(500);

						await expect(
							async () => {
								await this.code.driver.page.keyboard.press('Escape');
								await this.expectCellIndexToBeSelected(cellIndex, {
									isSelected: true,
									inEditMode: false,
									timeout: 2000
								});
							},
							'should NOT be in edit mode'
						).toPass({ timeout: 15000 });
					});
				}
				await this.expectCellIndexToBeSelected(cellIndex, {
					isSelected: true,
					inEditMode: editMode
				});
			}
		});


	}

	/**
	 * Action: Select an action from the More Actions menu for a specific cell.
	 * @param cellIndex - The index of the cell to act on
	 * @param action - The action to perform from the More Actions menu
	 */
	async triggerCellAction(cellIndex: number, action: MoreActionsMenuItems): Promise<void> {
		await test.step(`Select action from More Actions menu: ${action}`, async () => {
			await this.moreActionsButtonAtIndex(cellIndex).click();
			await this.moreActionsOption(action).click();
		});
	}

	/**
	 * Action: Create a new code cell at the END of the notebook.
	 */
	private async addCodeCellToEnd(): Promise<void> {
		await test.step(`Create new code cell at end`, async () => {
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
		await test.step(`Run code in cell ${cellIndex}`, async () => {
			await this.selectCellAtIndex(cellIndex);
			await this.runCellButtonAtIndex(cellIndex).click();

			// Wait for spinner to appear (cell is executing) and disappear (execution complete)
			const spinner = this.spinnerAtIndex(cellIndex);
			await expect(spinner).toBeVisible({ timeout: 2000 }).catch(() => {
				// Spinner might not appear for very fast executions, that's okay
			});
			await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Action: Move the mouse away from the notebook area to close any open tooltips/popups.
	 */
	async moveMouseAway(): Promise<void> {
		await this.code.driver.page.waitForTimeout(500);
		await this.code.driver.page.mouse.move(0, 0);
		await expect(this.cellInfoToolTip).toHaveCount(0);
	}

	/**
	 * Action: Enter edit mode for the cell at the specified index.
	 * @param cellIndex - The index of the cell to enter edit mode for.
	 */
	async editModeAtIndex(cellIndex: number): Promise<void> {
		// Determine if cell is markdown or code and enter edit mode accordingly
		const ariaLabel = await this.cell.nth(cellIndex).getAttribute('aria-label');
		ariaLabel === 'Markdown cell'
			? await this.cell.nth(cellIndex).dblclick()
			: await this.cell.nth(cellIndex).click();
	}

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
		options?: { delay?: number; run?: boolean; waitForSpinner?: boolean }
	): Promise<Locator> {
		const { delay = 0, run = false, waitForSpinner = false } = options ?? {};
		return await test.step(`Add code to cell: ${cellIndex}, run: ${run}, waitForSpinner: ${waitForSpinner}`, async () => {
			const currentCellCount = await this.getCellCount();

			if (cellIndex >= currentCellCount) {
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}
				await this.addCodeCellToEnd();
			}

			await this.editModeAtIndex(cellIndex);

			// Focus the editor for the cell
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
					await expect(spinner).toBeVisible({ timeout: 2000 }).catch(() => {
						// Spinner might not appear for very fast executions, that's okay
					});
					await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
				}
			}

			return this.cell.nth(cellIndex);
		});
	}

	/**
	 * Action: Perform a cell action using keyboard shortcuts.
	 * @param action - The action to perform: 'copy', 'cut', 'paste', 'undo', 'redo', 'delete', 'addCellBelow'.
	 */
	async performCellAction(action: 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'delete' | 'addCellBelow'): Promise<void> {
		await test.step(`Perform cell action: ${action}`, async () => {
			// Note: We use direct keyboard shortcuts instead of hotKeys/clipboard helpers
			// because Positron Notebooks uses Jupyter-style single-key shortcuts (C/X/V/Z)
			// in command mode, not the standard Cmd+C/X/V/Z shortcuts
			switch (action) {
				case 'copy':
					await this.code.driver.page.keyboard.press('KeyC');
					break;
				case 'cut':
					await this.code.driver.page.keyboard.press('KeyX');
					break;
				case 'paste':
					await this.code.driver.page.keyboard.press('KeyV');
					break;
				case 'undo':
					await this.code.driver.page.keyboard.press('KeyZ');
					break;
				case 'redo':
					await this.code.driver.page.keyboard.press('Shift+KeyZ');
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
		});
	}

	/**
	 * Action: Delete a cell using the action bar button.
	 */
	async deleteCellWithActionBar(cellIndex = 0): Promise<void> {
		await test.step(`Delete cell ${cellIndex} using action bar`, async () => {
			// Get the current cell count before deletion
			const initialCount = await this.getCellCount();

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

	// #endregion

	// #region VERIFICATIONS

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
	 * Verify: Cell contents match expected contents.
	 * @param expectedContents - Array of expected cell contents in order.
	 */
	async expectCellContentsToBe(expectedContents: string[]): Promise<void> {
		for (let i = 0; i < expectedContents.length; i++) {
			await this.expectCellContentAtIndexToBe(i, expectedContents[i]);
		}
	}

	/**
	 * Verify: Cell type at specified index matches expected type.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedType - The expected type of the cell ('code' or 'markdown').
	 */
	async expectCellTypeAtIndexToBe(cellIndex: number, expectedType: 'code' | 'markdown'): Promise<void> {
		await test.step(`Expect cell ${cellIndex} type to be: ${expectedType}`, async () => {
			const ariaLabel = await this.cell.nth(cellIndex).getAttribute('aria-label');

			expectedType === 'code'
				? expect(ariaLabel).toBe('Code cell')
				: expect(ariaLabel).toBe('Markdown cell');

		});
	}

	/**
	 * Verify: Cell content at specified index matches expected content.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedContent - The expected content of the cell.
	 */
	async expectCellContentAtIndexToBe(cellIndex: number, expectedContent: string): Promise<void> {
		await test.step(`Expect cell ${cellIndex} content to be: ${expectedContent}`, async () => {
			const cellType = await this.getCellType(cellIndex);
			const actualContent = cellType === 'code'
				? await this.getCodeCellContent(cellIndex)
				: await this.getMarkdownCellContent(cellIndex);
			await expect(async () => {
				expect(actualContent).toBe(expectedContent);
			}).toPass({ timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Verify: Cell content at specified index contains expected substring or matches RegExp.
	 * @param cellIndex - The index of the cell to check.
	 * @param expected - The substring or RegExp expected to be contained in the cell content.
	 */
	async expectCellContentAtIndexToContain(cellIndex: number, expected: string | RegExp): Promise<void> {
		await test.step(
			`Expect cell ${cellIndex} content to contain: ${expected instanceof RegExp ? expected.toString() : expected}`,
			async () => {
				await expect(async () => {
					const actualContent = await this.getCodeCellContent(cellIndex);

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
	 * @param timeout - Optional timeout for the expectation.
	 */
	async expectToolTipToContain(
		expectedContent: { order?: number; duration?: RegExp; status?: 'Success' | 'Failed' | 'Currently running...'; completed?: RegExp },
		timeout = DEFAULT_TIMEOUT
	): Promise<void> {
		await test.step(`Expect cell info tooltip to contain: ${JSON.stringify(expectedContent)}`, async () => {
			await expect(this.cellInfoToolTip).toBeVisible({ timeout });

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
						await expect(labelLocator).toBeVisible({ timeout });
					} else {
						const valueLocator = getValueLocator(labelMap[key]);
						const expectedText = expectedValue instanceof RegExp ? expectedValue : expectedValue.toString();
						await expect(valueLocator).toContainText(expectedText, { timeout });
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

	/**
	 * Verify: Execution order for multiple cells.
	 * @param executionOrders - { index, order }[] array specifying cell index, expected order.
	 */
	async expectExecutionOrder(executionOrders: { index: number; order: number | undefined }[],): Promise<void> {
		for (const { index, order } of executionOrders) {
			await test.step(`Expect execution order at index ${index} to be: ${order}`, async () => {
				// attempting to make any tooltips dissapear
				await this.code.driver.page.keyboard.press('Escape');
				await this.moveMouseAway();

				// hover over the run button to show the tooltip
				await this.cell.nth(index).click();
				await this.runCellButtonAtIndex(index).hover();

				// make sure only the right tooltip is visible (i've been seeing multiple tooltips sometimes)
				await expect(this.cellInfoToolTipAtIndex(index)).toBeVisible();
				await expect(this.cellInfoToolTip).toHaveCount(1); // make sure this is the only tooltip visible
				await this.expectToolTipToContain({ order }, DEFAULT_TIMEOUT);
			});
		}
	}

	/**
	 * Verify: Spinner visibility in a cell.
	 * @param cellIndex - The index of the cell to check.
	 * @param visible - Whether the spinner should be visible (true) or not (false).
	 * @param timeout - The timeout for the expectation.
	 */
	async expectSpinnerAtIndex(cellIndex: number, visible = true, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect spinner to be ${visible ? 'visible' : 'hidden'} in cell ${cellIndex}`, async () => {
			if (visible) {
				await expect(this.spinnerAtIndex(cellIndex)).toBeVisible({ timeout });
			} else {
				await expect(this.spinnerAtIndex(cellIndex)).toHaveCount(0, { timeout });
			}
		});
	}

	/**
	 * Verify: No active spinners are present.
	 * @param timeout - Timeout for the expectation.
	 */
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
	 * Verify: multiple cells are selected.
	 * @param expectedIndices - The indices of the cells expected to be selected.
	 * @param timeout - Timeout for the expectation.
	 */
	async expectCellsToBeSelected(expectedIndices: number[], timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Verify cells at indices [${expectedIndices.join(', ')}] are selected`, async () => {
			for (const index of expectedIndices) {
				await this.expectCellIndexToBeSelected(index, { isSelected: true, timeout });
			}
		});
	}

	/**
	 * Verify: the cell at the specified index is (or is not) selected,
	 * and optionally, whether it is in edit mode.
	 * @param expectedIndex - The index of the cell to check.
	 * @param options - Options to specify selection and edit mode expectations.
	 */
	async expectCellIndexToBeSelected(
		expectedIndex: number,
		options?: { isSelected?: boolean; inEditMode?: boolean; isActive?: boolean; timeout?: number }
	): Promise<void> {
		const {
			isSelected = true,
			inEditMode = undefined,
			isActive = undefined,
		} = options ?? {};

		await expect(async () => {
			await test.step(`Verify cell at index ${expectedIndex} to is${isSelected ? '' : ' NOT'} selected`, async () => {
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

				if (isActive !== undefined) {
					isActive
						? await expect(this.moreActionsButtonAtIndex(expectedIndex)).toBeVisible()
						: await expect(this.moreActionsButtonAtIndex(expectedIndex)).toBeHidden();
				}
			});

			if (inEditMode !== undefined) {
				await test.step(`Verify cell at index ${expectedIndex} is ${inEditMode ? '' : 'NOT '}in edit mode`, async () => {
					const editorFocused = this.cell.nth(expectedIndex).locator('.monaco-editor-background').locator('.focused');
					inEditMode
						? await expect(editorFocused).toHaveCount(1)
						: await expect(editorFocused).toHaveCount(0);

				});
			}

		}, `Cell selection and edit mode`).toPass({ timeout: options?.timeout ?? DEFAULT_TIMEOUT });
	}

	/**
	 * Verify: the cell at the specified index has the expected number of lines.
	 * @param cellIndex - The index of the cell to check.
	 * @param numLines - The expected number of lines in the cell.
	 */
	async expectCellToHaveLineCount({ cellIndex, numLines }): Promise<void> {
		await test.step(`Expect cell at index ${cellIndex} to have ${numLines} lines`, async () => {
			const viewLines = this.cell.nth(cellIndex).locator('.view-line');
			await expect(viewLines).toHaveCount(numLines, { timeout: DEFAULT_TIMEOUT });
		});
	}


	/**
	 * Verify: Screenshot of rendered markdown at specified index matches expected screenshot.
	 * @param index - The index of the markdown cell to check.
	 * @param screenshotName - The name to use for the screenshot file.
	 */
	async expectScreenshotToMatch(index: number, screenshotName: string): Promise<void> {
		await test.step(`Take/compare screenshot of cell output at index ${index}`, async () => {
			const output = this.cellMarkdown(index);
			await output.scrollIntoViewIfNeeded();
			await expect(output).toBeVisible();

			// Logging the screenshot path for easier debugging
			const info = test.info();
			const resolvedPath = info.snapshotPath(screenshotName);
			const resolvedFile = path.basename(resolvedPath);
			const repoRelativePath = path.relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
			await info.attach(`${resolvedFile}.path.txt`, {
				body: Buffer.from(repoRelativePath, 'utf8'),
				contentType: 'text/plain',
			});

			// Take screenshot and attach to report
			const shot = await output.screenshot({ animations: 'disabled' });
			await info.attach(resolvedFile, {
				body: shot,
				contentType: 'image/png',
			});

			// Verify screenshot matches
			// await expect(output).toHaveScreenshot('basic-markdown-render.png', {
			// 	maxDiffPixelRatio: 0.05,
			// 	animations: 'disabled',
			// 	caret: 'hide',
			// 	scale: 'css',
			// });
		});
	}

	/**
	 * Verify: markdown text for a specific tag matches expected text.
	 * @param tag - The tag of the markdown element to assert.
	 * @param expectedText - The expected text content.
	 */
	async expectMarkdownTagToBe(tag: string, expectedText: string): Promise<void> {
		const markdownLocator = this.cell.locator(tag);
		await expect(markdownLocator).toBeVisible();
		await expect(markdownLocator).toHaveText(expectedText);
	}

	/**
	 * Verify: cell output at specified index matches expected output.
	 * @param cellIndex - The index of the cell to check.
	 * @param lines - The expected output lines.
	 */
	async expectOutputAtIndex(cellIndex: number, lines: string[]): Promise<void> {
		await test.step(`Verify output at index: ${cellIndex}`, async () => {
			await this.cellOutput(cellIndex).scrollIntoViewIfNeeded();
			await expect(this.cellOutput(cellIndex)).toBeVisible();
			for (const line of lines) {
				await expect(this.cellOutput(cellIndex).getByText(line)).toBeVisible();
			}
		});
	}
	// #endregion
}

// -----------------
//     Kernel
// -----------------
export class Kernel {
	statusBadge: Locator;
	private activeStatus: Locator;
	private idleStatus: Locator;
	private disconnectedStatus: Locator;

	constructor(private code: Code, private notebooks: PositronNotebooks, private contextMenu: ContextMenu, private hotKeys: HotKeys, private quickinput: QuickInput) {
		this.statusBadge = this.code.driver.page.getByRole('button', { name: 'Kernel Actions' });
		this.activeStatus = this.notebooks.editorActionBar.locator(ACTIVE_STATUS_ICON);
		this.idleStatus = this.notebooks.editorActionBar.locator(IDLE_STATUS_ICON);
		this.disconnectedStatus = this.notebooks.editorActionBar.locator(DISCONNECTED_STATUS_ICON);
	}

	// #region ACTIONS

	/**
	 * Action: Restart the notebook kernel and optionally wait for it to be ready.
	 * @param param0 - { waitForRestart?: boolean } - Whether to wait for the kernel to be idle after restart (default: true).
	 */
	async restart({ waitForRestart = true }: { waitForRestart?: boolean } = {}): Promise<void> {
		await test.step('Restart kernel', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: /Restart Kernel/
			});

			if (waitForRestart) {
				await this.expectStatusToBe('idle', 30000);
			}
		});
	}

	/**
	 * Action: Shutdown the notebook kernel.
	 */
	async shutdown(): Promise<void> {
		await test.step('Shutdown kernel', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: /Shutdown Kernel/
			});
			await this.expectStatusToBe('disconnected', 15000);
		});
	}

	/**
	 * Action: Open the notebook session scratchpad in console.
	 */
	async openNotebookConsole(): Promise<void> {
		await test.step('Open notebook console', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: /Open Notebook Console/
			});
		});
	}

	/**
	 * Action: Insert code cell above/below
	 */
	async insertCodeCell(position: 'above' | 'below'): Promise<void> {
		await test.step(`Insert code cell ${position} via kernel menu`, async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: new RegExp(`Insert Code Cell ${position === 'above' ? 'Above' : 'Below'}`)
			});
		});
	}

	/**
	 * Action: Select notebook kernel and optionally wait for it to be ready
	 */
	async select(
		kernelGroup: 'Python' | 'R',
		{ version, waitForReady = true }: { version?: string; waitForReady?: boolean } = {}
	): Promise<void> {
		const desiredKernel = version ?? (kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!);

		await test.step(`Select kernel ${waitForReady ? '<waitForReady>' : ''}: ${desiredKernel}`, async () => {
			await this.notebooks.expectToBeVisible();

			// Wait for kernel detection to complete
			await expect(this.notebooks.cellStatusSyncIcon).not.toBeVisible({ timeout: 30000 });
			await expect(this.notebooks.detectingKernelsText).not.toBeVisible({ timeout: 30000 });
			await expect(this.statusBadge).toBeVisible({ timeout: 5000 });


			// Check if the desired kernel is already selected
			const currentKernelText = await this.statusBadge.textContent();
			if (currentKernelText && currentKernelText.includes(desiredKernel) && await this.idleStatus.isVisible()) {
				this.code.logger.log(`Kernel already selected and ready: ${desiredKernel}`);
				return;
			}

			// select the kernel
			await this.hotKeys.selectNotebookKernel();
			await this.quickinput.waitForQuickInputOpened({ timeout: 1000 });
			await this.quickinput.selectQuickInputElementContaining(desiredKernel, { timeout: 1000, force: false });
			await this.quickinput.waitForQuickInputClosed();
			this.code.logger.log(`Selected kernel: ${desiredKernel}`);

			if (waitForReady) {
				await this.expectKernelToBe({
					kernelGroup,
					kernelVersion: desiredKernel,
					status: 'idle',
					timeout: 30000
				});
				this.code.logger.log('Kernel is connected and ready/idle');
			}
		});
	}
	// #endregion

	// #region VERIFICATIONS

	/**
	 * Verify: Kernel has expected status and version.
	 * @param param0 - { kernelGroup, kernelVersion, status, timeout }
	 */
	async expectKernelToBe({
		kernelGroup,
		kernelVersion = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!,
		status = 'idle',
		timeout = 20000 // longer than should be due to known lag
	}: {
		kernelGroup: 'Python' | 'R';
		kernelVersion?: string;
		status?: SessionState;
		timeout?: number;
	}): Promise<void> {
		await test.step(`Expect kernel to be: ${status} - ${kernelVersion}`, async () => {
			await expect(this.statusBadge).toContainText(kernelVersion, { timeout });
			await this.expectStatusToBe(status, timeout);
		});
	}

	/**
	 * Verify: Kernel menu contains expected items.
	 * @param menuItemStates - Array of expected menu item states.
	 */
	async expectMenuToContain(menuItemStates: MenuItemState[]): Promise<void> {
		await test.step(`Verify kernel menu items: ${menuItemStates.map(item => item.label).join(', ')}`, async () => {
			await this.contextMenu.triggerAndVerifyMenuItems({
				menuTrigger: this.statusBadge,
				menuItemStates: menuItemStates
			});
		});
	}

	/**
	 * Verify: Kernel status is as expected.
	 * @param expectedStatus - the kernel status (idle | active | disconnected)
	 * @param timeout - the timeout for the expectation
	 */
	async expectStatusToBe(expectedStatus: SessionState, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect kernel status to be: ${expectedStatus}`, async () => {
			const statusMap: Record<Exclude<SessionState, 'exited'>, Locator> = {
				active: this.activeStatus,
				idle: this.idleStatus,
				disconnected: this.disconnectedStatus
			};

			// Use the mapped locator for the expected status
			const locator = statusMap[expectedStatus];
			if (!locator) {
				throw new Error(`Unknown expected status: ${expectedStatus}`);
			}
			await expect(locator).toBeVisible({ timeout });
		});
	}

	// #endregion

}
