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
import { ACTIVE_STATUS_ICON, DISCONNECTED_STATUS_ICON, IDLE_STATUS_ICON } from './sessions.js';

const DEFAULT_TIMEOUT = 10000;

type MoreActionsMenuItems = 'Copy cell' | 'Cut cell' | 'Paste Cell Above' | 'Paste cell below' | 'Move cell down' | 'Move cell up' | 'Insert code cell above' | 'Insert code cell below';
type KernelStatus = 'Active' | 'Idle' | 'Disconnected';
/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	private positronNotebook = this.code.driver.page.locator('.positron-notebook').first();
	editorActionBar = this.code.driver.page.locator('.editor-action-bar-container');
	cell = this.code.driver.page.locator('[data-testid="notebook-cell"]');
	private newCellButton = this.code.driver.page.getByLabel(/new code cell/i);
	editorAtIndex = (index: number) => this.cell.nth(index).locator('.positron-cell-editor-monaco-widget textarea');
	runCellButtonAtIndex = (index: number) => this.cell.nth(index).getByLabel(/execute cell/i);
	private spinner = this.code.driver.page.getByLabel(/cell is executing/i);
	private spinnerAtIndex = (index: number) => this.cell.nth(index).getByLabel(/cell is executing/i);
	private executionStatusAtIndex = (index: number) => this.cell.nth(index).locator('[data-execution-status]');
	detectingKernelsText = this.code.driver.page.getByText(/detecting kernels/i);
	cellStatusSyncIcon = this.code.driver.page.locator('.cell-status-item-has-runnable .codicon-sync');


	private deleteCellButton = this.cell.getByRole('button', { name: /delete the selected cell/i });
	private cellInfoToolTip = this.code.driver.page.getByRole('tooltip', { name: /cell execution details/i });
	private cellInfoToolTipAtIndex = (index: number) => this.cell.nth(index).getByRole('tooltip', { name: /cell execution details/i });
	moreActionsButtonAtIndex = (index: number) => this.cell.nth(index).getByRole('button', { name: /more actions/i });
	moreActionsOption = (option: string) => this.code.driver.page.locator('button.custom-context-menu-item', { hasText: option });
	kernel: Kernel;

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
	 */
	async getCellContent(cellIndex: number): Promise<string> {
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
	 * Create a new Positron notebook.
	 * @param numCellsToAdd - Number of cells to add after creating the notebook (default: 0).
	 */
	async newNotebook(numCellsToAdd = 0): Promise<void> {
		await this.createNewNotebook();
		await this.expectToBeVisible();
		if (numCellsToAdd > 0) {
			for (let i = 0; i < numCellsToAdd; i++) {
				await this.addCodeToCell(i, `# Cell ${i}`);
			}
			await this.expectCellCountToBe(numCellsToAdd);
		}
	}

	/**
	 * Action: Select a cell at the specified index.
	 * @param cellIndex - The index of the cell to select.
	 */
	async selectCellAtIndex(cellIndex: number, { editMode = true }: { editMode?: boolean } = {}): Promise<void> {
		await test.step(`Select cell at index: ${cellIndex}, edit mode: ${editMode}`, async () => {
			// click cell and verify selected & edit mode
			await this.cell.nth(cellIndex).click();
			await this.expectCellIndexToBeSelected(cellIndex, { isSelected: true, inEditMode: true });


			if (!editMode) {
				await test.step('Exit edit mode', async () => {
					// press escape to exit edit mode
					await this.code.driver.page.waitForTimeout(500);
					await expect(async () => {
						await this.code.driver.page.keyboard.press('Escape');
						await this.expectCellIndexToBeSelected(cellIndex, { isSelected: true, inEditMode: false, timeout: 2000 });
					}, 'should NOT be in edit mode').toPass({ timeout: 15000 });
				});
			}
		});
	}

	/**
	 * Action: Select an action from the More Actions menu for a specific cell.
	 * @param cellIndex - The index of the cell to act on
	 * @param action - The action to perform from the More Actions menu
	 */
	async selectFromMoreActionsMenu(cellIndex: number, action: MoreActionsMenuItems): Promise<void> {
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
			await expect(spinner).toBeVisible({ timeout: DEFAULT_TIMEOUT }).catch(() => {
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
			// Press escape to ensure focus is out of the cell editor
			await this.code.driver.page.keyboard.press('Escape');

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
	 * Verify: Cell content at specified index contains expected substring or matches RegExp.
	 * @param cellIndex - The index of the cell to check.
	 * @param expected - The substring or RegExp expected to be contained in the cell content.
	 */
	async expectCellContentAtIndexToContain(cellIndex: number, expected: string | RegExp): Promise<void> {
		await test.step(
			`Expect cell ${cellIndex} content to contain: ${expected instanceof RegExp ? expected.toString() : expected}`,
			async () => {
				await expect(async () => {
					const actualContent = await this.getCellContent(cellIndex);

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

	async expectExecutionOrderAtIndexToBe(cellIndex: number, expectedOrder: number, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect execution order at index ${cellIndex} to be: ${expectedOrder}`, async () => {
			await this.code.driver.page.keyboard.press('Escape');
			await this.code.driver.page.mouse.move(0, 0);
			await this.cell.nth(cellIndex).click();
			await this.code.driver.page.getByRole('button', { name: 'Execute cell' }).hover();
			await expect(this.cellInfoToolTipAtIndex(cellIndex)).toBeVisible(); // make sure we have the RIGHT tooltip
			await expect(this.cellInfoToolTip).toHaveCount(1); // make sure this is the only tooltip visible
			await this.expectToolTipToContain({ order: expectedOrder }, timeout);
		});
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
			});

			await test.step(`Verify cell at index ${expectedIndex} is ${inEditMode ? '' : 'NOT '}in edit mode`, async () => {
				const editorFocused = this.cell.nth(expectedIndex).locator('.monaco-editor-background').locator('.focused');
				inEditMode
					? await expect(editorFocused).toHaveCount(1)
					: await expect(editorFocused).toHaveCount(0);

			});
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
	// #endregion


}

// -----------------
//     Kernel
// -----------------
export class Kernel {
	kernelStatusBadge: Locator;
	private activeStatus: Locator;
	private idleStatus: Locator;
	private disconnectedStatus: Locator;

	constructor(private code: Code, private notebooks: PositronNotebooks, private contextMenu: ContextMenu, private hotKeys: HotKeys, private quickinput: QuickInput) {
		this.kernelStatusBadge = this.code.driver.page.getByRole('button', { name: 'Kernel Actions' });
		this.activeStatus = this.notebooks.editorActionBar.locator(ACTIVE_STATUS_ICON);
		this.idleStatus = this.notebooks.editorActionBar.locator(IDLE_STATUS_ICON);
		this.disconnectedStatus = this.notebooks.editorActionBar.locator(DISCONNECTED_STATUS_ICON);
	}

	// #region ACTIONS

	async restart({ waitForRestart = true }: { waitForRestart?: boolean } = {}): Promise<void> {
		await test.step('Restart kernel', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.kernelStatusBadge,
				menuItemLabel: /Restart Kernel/
			});

			if (waitForRestart) {
				await this.expectStatusToBe('Idle', 30000);
			}
		});
	}

	async shutdown(): Promise<void> {
		await test.step('Shutdown kernel', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.kernelStatusBadge,
				menuItemLabel: /Shutdown Kernel/
			});
			await this.expectStatusToBe('Disconnected', 15000);
		});
	}

	async select(
		kernelGroup: 'Python' | 'R',
		desiredKernel = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!
	): Promise<void> {
		await test.step(`Select kernel: ${desiredKernel}`, async () => {
			// sometimes the input closes immediately the 1st attempt in Playwright :(
			await expect(async () => {
				// select the kernel
				await this.hotKeys.selectNotebookKernel();
				await this.quickinput.waitForQuickInputOpened({ timeout: 1000 });
				await this.quickinput.selectQuickInputElementContaining(desiredKernel, { timeout: 1000, force: false });
				await this.quickinput.waitForQuickInputClosed();
				this.code.logger.log(`Selected kernel: ${desiredKernel}`);
			}).toPass({ timeout: 10000 });
		});
	}

	/**
	 * Action: Select interpreter and wait for the kernel to be ready.
	 * This combines selecting the interpreter with waiting for kernel connection to prevent flakiness.
	 * Directly implements Positron-specific logic without unnecessary notebook type detection.
	 */
	async selectAndWaitForReady(
		kernelGroup: 'Python' | 'R',
		desiredKernel = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!
	): Promise<void> {
		await test.step(`Select kernel and wait for ready: ${desiredKernel}`, async () => {
			// Ensure notebook is visible
			await this.notebooks.expectToBeVisible();

			// Wait for kernel detection to complete
			await expect(this.notebooks.cellStatusSyncIcon).not.toBeVisible({ timeout: 30000 });
			await expect(this.notebooks.detectingKernelsText).not.toBeVisible({ timeout: 30000 });

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

			// we shouldn't need to retry this, but the input closes immediately the 1st attempt in Playwright
			await expect(async () => {
				// select the kernel
				await this.hotKeys.selectNotebookKernel();
				await this.quickinput.waitForQuickInputOpened({ timeout: 1000 });
				await this.quickinput.selectQuickInputElementContaining(desiredKernel, { timeout: 1000, force: false });
			}).toPass({ timeout: 10000 });

			await this.quickinput.waitForQuickInputClosed();
			this.code.logger.log(`Selected kernel: ${desiredKernel}`);

			// wait for kernel
			await this.expectKernelToBe({
				kernelGroup,
				kernelVersion: desiredKernel,
				status: 'Idle',
				timeout: 30000
			});
			this.code.logger.log('Kernel is connected and ready/idle');
		});
	}
	// #endregion

	// #region VERIFICATIONS

	async expectKernelToBe({
		kernelGroup,
		kernelVersion = kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!,
		status = 'Idle',
		timeout = 20000 // longer than should be due to known lag
	}: {
		kernelGroup: 'Python' | 'R';
		kernelVersion?: string;
		status?: KernelStatus;
		timeout?: number;
	}): Promise<void> {
		await test.step(`Expect kernel to be: ${status} - ${kernelVersion}`, async () => {
			await expect(this.kernelStatusBadge).toContainText(kernelVersion, { timeout });
			await this.expectStatusToBe(status, timeout);
		});
	}

	async expectMenuToContain(menuItemStates: MenuItemState[]): Promise<void> {
		await test.step(`Verify kernel menu items: ${menuItemStates.map(item => item.label).join(', ')}`, async () => {
			await this.contextMenu.triggerAndVerify({
				menuTrigger: this.kernelStatusBadge,
				menuItemStates: menuItemStates
			});
		});
	}

	async expectStatusToBe(expectedStatus: KernelStatus, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect kernel status to be: ${expectedStatus}`, async () => {
			const statusMap: Record<KernelStatus, Locator> = {
				Active: this.activeStatus,
				Idle: this.idleStatus,
				Disconnected: this.disconnectedStatus
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
