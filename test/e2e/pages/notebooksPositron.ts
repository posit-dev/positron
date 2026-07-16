/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Notebooks } from './notebooks';
import { Code } from '../infra/code';
import { QuickInput } from './quickInput';
import { QuickAccess } from './quickaccess';
import test, { expect, Locator } from '@playwright/test';
import { HotKeys } from './hotKeys.js';
import { ContextMenu, MenuItemState } from './dialog-contextMenu.js';
import { ACTIVE_STATUS_ICON, DEPRIORITIZED_PYTHON_SOURCES, DISCONNECTED_STATUS_ICON, IDLE_STATUS_ICON, SessionState } from './sessions.js';
import { basename, relative } from 'path';

const DEFAULT_TIMEOUT = 10000;

/**
 * Minimum pointer distance (px) before a drag activates.
 * Must match DRAG_ACTIVATION_DISTANCE_PX in SortableCellList.tsx.
 */
const DRAG_ACTIVATION_DISTANCE_PX = 10;
const MARKDOWN_ARIA_LABEL = 'Markdown cell - Press Enter to edit';

type MoreActionsMenuItems = 'Copy cell' | 'Cut cell' | 'Paste Cell Above' | 'Paste cell below' | 'Move cell down' | 'Move cell up' | 'Insert code cell above' | 'Insert code cell below';
type EditorActionBarButtons = 'Markdown' | 'Code' | 'Clear All Outputs' | 'Run All Cells';
type OutputActionBarButtons = 'Collapse Output' | 'Expand Output' | 'Clear Output' | 'Show Full Output' | 'Truncate Output' | 'Copy Image';

/**
 * Notebooks functionality exclusive to Positron notebooks.
 */
export class PositronNotebooks extends Notebooks {
	// Containers, generic locators
	private positronNotebook = this.code.driver.currentPage.locator('.positron-notebook').first();
	cellsContainer = this.positronNotebook.locator('.positron-notebook-cells-container').first();
	private newCellButton = this.code.driver.currentPage.getByLabel(/new code cell/i);
	private spinner = this.code.driver.currentPage.getByLabel(/cell is executing/i);
	editorAtIndex = (index: number) => this.cell.nth(index).locator('.monaco-editor :is(.native-edit-context, .inputarea)');
	/** The visible editor code area -- clickable even when the editor is not focused. */
	editorWidgetAtIndex = (index: number) => this.cell.nth(index).locator('.positron-cell-editor-monaco-widget .view-lines');
	cell = this.code.driver.currentPage.locator('[data-testid="notebook-cell"]');
	codeCell = this.code.driver.currentPage.locator('[data-testid="notebook-cell"][aria-label="Code cell"]');
	markdownCell = this.code.driver.currentPage.locator(`[data-testid="notebook-cell"][aria-label="${MARKDOWN_ARIA_LABEL}"]`);
	cellStatusSyncIcon = this.code.driver.currentPage.locator('.cell-status-item-has-runnable .codicon-sync');
	detectingKernelsText = this.code.driver.currentPage.getByText(/detecting kernels/i);

	// Editor action bar
	editorActionBar = this.code.driver.currentPage.locator('.editor-action-bar-container');
	kernel: Kernel;
	private addMarkdownButton = this.editorActionBar.getByRole('button', { name: 'Markdown' });
	private addCodeButton = this.editorActionBar.getByRole('button', { name: 'Code' });

	// Cell action buttons, menus, tooltips, etc
	moreActionsButtonAtIndex = (index: number) => this.cell.nth(index).getByRole('button', { name: /More Cell Actions/i });
	// Drag handle is a sibling of the cell inside .sortable-cell parent
	sortableCellAtIndex = (index: number) => this.code.driver.currentPage.locator('.sortable-cell').nth(index);
	dragHandleAtIndex = (index: number) => this.sortableCellAtIndex(index).getByRole('button', { name: /Drag to reorder cell/i });
	dragZoneAtIndex = (index: number) => this.sortableCellAtIndex(index).locator('.cell-drag-zone');
	// One AddCellButtons per gap (including before the first and after the last cell), in DOM order by gap index
	addCellButtonsAtGap = (gapIndex: number) => this.code.driver.currentPage.locator('.positron-add-cell-buttons').nth(gapIndex);
	dropIndicatorAtGap = (gapIndex: number) => this.addCellButtonsAtGap(gapIndex).getByTestId('drop-indicator');
	moreActionsOption = (option: string) => this.code.driver.currentPage.locator('button.custom-context-menu-item', { hasText: option });
	runCellButtonAtIndex = (index: number) => this.cell.nth(index).getByRole('button', { name: 'Run Cell', exact: true });
	private executionOrderBadgeAtIndex = (index: number) => this.cell.nth(index).locator('.execution-order-badge');
	private cellMarkdown = (index: number) => this.cell.nth(index).locator('.positron-notebook-markdown-rendered');
	private cellFooterAtIndex = (index: number) => this.cell.nth(index).locator('.positron-notebook-code-cell-footer');
	private spinnerAtIndex = (index: number) => this.cell.nth(index).getByLabel(/Cell is executing/i);
	private executionStatusAtIndex = (index: number) => this.cell.nth(index).locator('[data-execution-status]');
	private deleteCellButton = this.cell.getByRole('button', { name: /Delete Cell/i });
	viewMarkdown = this.code.driver.currentPage.getByRole('button', { name: 'View markdown' });
	expandMarkdownEditor = this.code.driver.currentPage.getByRole('button', { name: 'Open markdown editor' });

	// Cell outputs
	cellOutput = (index: number) => this.cell.nth(index).getByTestId('cell-output');
	cellOutputSash = (index: number) => this.cellOutput(index).locator('.horizontal-splitter .sash');
	private outputActionBar = (index: number) => this.cell.nth(index).locator('.cell-output-action-bar');
	outputCollapsedLabel = (index: number) => this.cellOutput(index).getByText('Output collapsed');
	outputTruncationMessage = (index: number) => this.cellOutput(index).getByText(/\.\.\. Show [\d,.\s\u00A0]+ more lines/);
	outputCollapseToggle = (index: number) => this.cell.nth(index).locator('.cell-output-collapse-button-container').getByRole('button');

	// Cell outputs - ipywidgets (rendered inside the notebook webview iframe)
	widgetSlider = this.frameLocator.locator('[role="slider"]');
	widgetReadout = this.frameLocator.locator('div.widget-readout');

	async focusWidgetSlider(): Promise<void> {
		await this.widgetSlider.hover();
		await this.widgetSlider.focus();
	}

	// Assistant buttons (shown on error cells when assistant is enabled)
	private askAssistantButton = this.editorActionBar.getByRole('button', { name: 'Ask Assistant', exact: true });
	private fixErrorButton = this.code.driver.currentPage.getByRole('button', { name: /Ask assistant to fix/i });
	private explainErrorButton = this.code.driver.currentPage.getByRole('button', { name: /Ask assistant to explain/i });

	// Search Widget
	private searchWidget = this.code.driver.currentPage.locator('.positron-find-widget');
	private findInput = this.searchWidget.getByRole('textbox', { name: 'Find' });
	private toggleReplaceButton = this.searchWidget.getByRole('button', { name: 'Toggle Replace' });
	private replaceInput = this.searchWidget.getByRole('textbox', { name: 'Replace' });
	private replaceButton = this.searchWidget.getByRole('button', { name: 'Replace', exact: true });
	private replaceAllButton = this.searchWidget.getByRole('button', { name: 'Replace All' });
	private searchNextButton = this.searchWidget.getByRole('button', { name: 'Next Match' });
	private searchPreviousButton = this.searchWidget.getByRole('button', { name: 'Previous Match' });
	private searchCloseButton = this.searchWidget.getByRole('button', { name: 'Close', exact: true });
	private searchDecoration = this.code.driver.currentPage.locator('.findMatchInline');
	private searchMatchCaseToggle = this.searchWidget.getByRole('checkbox', { name: 'Match Case' });
	private searchWholeWordToggle = this.searchWidget.getByRole('checkbox', { name: 'Match Whole Word' });
	private searchRegexToggle = this.searchWidget.getByRole('checkbox', { name: 'Use Regular Expression' });
	private hoverTooltip = this.code.driver.currentPage.locator('.hover-contents');

	// Ghost Cell
	private ghostCellHeader = this.code.driver.currentPage.locator('.ghost-cell-header');
	private ghostCellGenerating = this.code.driver.currentPage.locator('text=Generating suggestion...');
	private ghostCellExplanationText = this.code.driver.currentPage.locator('.ghost-cell-explanation-text');
	private ghostCellModeToggle = this.code.driver.currentPage.locator('.ghost-cell-mode-toggle');
	private ghostCellAccept = this.code.driver.currentPage.locator('.ghost-cell-accept');
	private ghostCellDismiss = this.code.driver.currentPage.locator('.ghost-cell-dismiss');
	private ghostCellRegenerate = this.code.driver.currentPage.locator('.ghost-cell-regenerate');
	private ghostCellCodePreview = this.code.driver.currentPage.locator('.ghost-cell-code-preview');
	private ghostCellCodeText = this.code.driver.currentPage.locator('.ghost-cell-code-text');
	private ghostCellFooter = this.code.driver.currentPage.locator('.ghost-cell-footer');
	private ghostCellInfoButton = this.code.driver.currentPage.locator('.ghost-cell-info-button');
	private ghostCellModelInfo = this.code.driver.currentPage.locator('.ghost-cell-model-info');
	private ghostCellAwaitingRequest = this.code.driver.currentPage.locator('.ghost-cell-awaiting-request');
	private ghostCellAwaitingText = this.code.driver.currentPage.locator('.ghost-cell-awaiting-text');
	private ghostCellGetSuggestion = this.code.driver.currentPage.locator('.ghost-cell-get-suggestion');
	private ghostCellDismissButton = this.code.driver.currentPage.locator('.ghost-cell-dismiss-button');
	private ghostCellAutomaticButton = this.code.driver.currentPage.locator('.ghost-cell-mode-toggle .toggle-button.left');
	private ghostCellOnDemandButton = this.code.driver.currentPage.locator('.ghost-cell-mode-toggle .toggle-button.right');

	constructor(code: Code, quickinput: QuickInput, quickaccess: QuickAccess, hotKeys: HotKeys, private contextMenu: ContextMenu) {
		super(code, quickinput, quickaccess, hotKeys);
		this.kernel = new Kernel(this.code, this, this.contextMenu, hotKeys, quickinput);
	}

	/**
	 * Returns a scoped version of the notebook for use with side-by-side notebooks.
	 * All locators and actions will be scoped to the provided container.
	 * @param container - A locator for the editor group container (e.g., `editors.editorGroup(0)`)
	 */
	scopedTo(container: Locator): ScopedNotebook {
		return new ScopedNotebook(container, this.contextMenu);
	}

	// #region GETTERS

	/**
	 * Get cell count.
	 */
	async getCellCount(): Promise<number> {
		return this.cell.count();
	}

	/**
	 * Get markdown cell content lines at specified index.
	 * Returns an array where each item is the text of a single .view-line element.
	 */
	async getCellContent(cellIndex: number): Promise<string[]> {
		const cellType = await this.getCellType(cellIndex);
		if (cellType === 'markdown') {
			// Enter edit mode to ensure the monaco view-lines are present
			const inEditMode = await this.cell.nth(cellIndex).getByRole('button', { name: 'View markdown' }).isVisible();
			if (!inEditMode) {
				await this.selectCellAtIndex(cellIndex, { editMode: true });
			}
		}

		const content = await test.step(`Get markdown content lines of cell at index: ${cellIndex}`, async () => {
			return this.getCellContentFromLocator(this.cell.nth(cellIndex));
		});

		if (cellType === 'markdown') {
			await this.viewMarkdown.click();
		}

		return content;
	}

	/**
	 * Read the view-line text of a cell directly from its locator.
	 * Use this when you already have a scoped cell locator (e.g., from a container).
	 */
	private async getCellContentFromLocator(cell: Locator): Promise<string[]> {
		const editor = cell.locator('.positron-cell-editor-monaco-widget .view-lines');
		const rawLines = await editor.locator('.view-line').allTextContents();
		return rawLines.map(l => (l ?? '').replace(/\u00a0/g, ' '));
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
		return ariaLabel === MARKDOWN_ARIA_LABEL ? 'markdown' : 'code';
	}

	// #endregion

	// #region ACTIONS

	/**
	 * Action: Enable Positron notebooks as the default editor.
	 * @param settings - The settings fixture
	 */
	async enablePositronNotebooks(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		},
	) {
		await settings.set(
			{ 'positron.notebook.enabled': true },
			// Don't actually need a reload on web but it's a simple way
			// to make sure the setting takes effect
			{ reload: 'web' });
	}

	/**
	 * Action: Disable Positron notebooks as the default editor.
	 * @param settings - The settings fixture
	 */
	async disablePositronNotebooks(
		settings: {
			set: (settings: Record<string, unknown>, options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }) => Promise<void>;
		},
	) {
		await settings.set(
			{ 'positron.notebook.enabled': false },
			// Don't actually need a reload on web but it's a simple way
			// to make sure the setting takes effect
			{ reload: 'web' });
	}

	/**
	 * Action: Open a Positron notebook.
	 * @param path - The path to the notebook to open.
	 */
	async openNotebook(path: string): Promise<void> {
		await this.prepareOpenNotebook(path);
		await this.confirmOpenNotebook();
	}

	/**
	 * Action: Open Quick Access and surface the notebook so a subsequent
	 * {@link confirmOpenNotebook} call only needs to confirm the selection.
	 *
	 * Splitting the open this way lets perf tests exclude Quick Access UI
	 * latency (Cmd+P, clearEditorHistory, the result-polling retry loop)
	 * from the measured open + parse + render time.
	 * @param path - The path to the notebook to open.
	 */
	async prepareOpenNotebook(path: string): Promise<void> {
		await this.quickaccess.openFileQuickAccessAndWait(basename(path), 1);
	}

	/**
	 * Action: Confirm the Quick Access selection staged by
	 * {@link prepareOpenNotebook} and wait for the notebook to render.
	 */
	async confirmOpenNotebook(): Promise<void> {
		await this.quickinput.selectQuickInputElement(0);
		await this.expectToBeVisible();
	}

	/**
	 * Action: Create a new Positron notebook.
	 * @param codeCells - Number of code cells to create
	 * @param markdownCells - Number of markdown cells to create
	 */
	async newNotebook({ codeCells = 1, markdownCells = 0 }: { codeCells?: number; markdownCells?: number } = {}): Promise<void> {
		await this.createNewNotebook();
		await this.expectToBeVisible();
		await this.expectCellCountToBe(1); // New notebook starts with 1 cell by default

		if (codeCells === 0) {
			await this.deleteCellWithActionBar(0);
		}

		if (codeCells <= 1 && markdownCells === 0) {
			return;
		}

		// Scope all cell operations to the active editor group so that cells from
		// other open notebooks are not counted or accidentally targeted when multiple
		// notebooks are open simultaneously (e.g., when setting up side-by-side tests).
		const activeGroup = this.code.driver.currentPage.locator('.part.editor .editor-group-container.active');
		const scopedCell = activeGroup.locator('[data-testid="notebook-cell"]');

		let totalCellsAdded = 0;

		if (codeCells > 0) {
			for (let i = 0; i < codeCells; i++) {
				await this.addCodeToCell(i, `# Cell ${i}`, { container: activeGroup });
				await expect(scopedCell).toHaveCount(totalCellsAdded + 1, { timeout: DEFAULT_TIMEOUT });
				await this.expectCellContentAtIndexToBe(i, `# Cell ${i}`, scopedCell.nth(i));
				totalCellsAdded++;
			}
		}

		if (markdownCells > 0) {
			for (let i = 0; i < markdownCells; i++) {
				await this.addCell('markdown', activeGroup);
				const editor = scopedCell.nth(totalCellsAdded).locator('.monaco-editor :is(.native-edit-context, .inputarea)');
				await editor.focus();
				await editor.pressSequentially(`### Cell ${totalCellsAdded}`);
				await expect(scopedCell).toHaveCount(totalCellsAdded + 1, { timeout: DEFAULT_TIMEOUT });
				await this.expectCellContentAtIndexToBe(totalCellsAdded, `### Cell ${totalCellsAdded}`, scopedCell.nth(totalCellsAdded));
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

		await this.code.driver.currentPage.mouse.click(x, y);
	}

	/**
	 * Action: Add a new cell of the specified type.
	 * @param type - The type of cell to add ('code' or 'markdown').
	 */
	async addCell(type: 'code' | 'markdown', container?: Locator): Promise<void> {
		const scopedCell = container ? container.locator('[data-testid="notebook-cell"]') : this.cell;
		const beforeCount = await scopedCell.count();

		if (container) {
			const actionBar = container.locator('.editor-action-bar-container');
			if (type === 'code') {
				await actionBar.getByRole('button', { name: 'Code' }).click();
			} else {
				this.code.driver.browser === 'webkit'
					? await actionBar.getByRole('button', { name: 'Markdown' }).dispatchEvent('click')
					: await actionBar.getByRole('button', { name: 'Markdown' }).click();
			}
		} else if (type === 'code') {
			await this.addCodeButton.click();
		} else {
			// WebKit has trouble clicking the Markdown button (tabindex="-1")
			this.code.driver.browser === 'webkit'
				? await this.addMarkdownButton.dispatchEvent('click')
				: await this.addMarkdownButton.click();
		}

		await expect(scopedCell).toHaveCount(beforeCount + 1, { timeout: DEFAULT_TIMEOUT });
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
						await this.code.driver.currentPage.waitForTimeout(500);

						await expect(
							async () => {
								await this.code.driver.currentPage.keyboard.press('Escape');
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
	 * Internal helper: activate a drag on a cell's handle.
	 * Hovers the cell, waits for the handle, presses mouse down, and moves
	 * past the 10px activation threshold. Returns the start coordinates.
	 */
	private async _activateDrag(cellIndex: number): Promise<{ startX: number; startY: number }> {
		const dragHandle = this.dragHandleAtIndex(cellIndex);

		// Hover near the left edge of the cell to trigger handle visibility.
		// Uses locator.hover() for auto-wait and auto-scroll guarantees
		// (avoids coupling to the internal .cell-drag-zone CSS class).
		await this.sortableCellAtIndex(cellIndex).hover({ position: { x: 8, y: 20 } });
		await expect(dragHandle).toBeVisible({ timeout: 2000 });

		const handleBox = await dragHandle.boundingBox();
		if (!handleBox) {
			throw new Error('Could not get bounding box for drag handle');
		}

		const startX = handleBox.x + handleBox.width / 2;
		const startY = handleBox.y + handleBox.height / 2;

		// Start drag and move past activation threshold
		// (DRAG_ACTIVATION_DISTANCE_PX in SortableCellList.tsx)
		await this.code.driver.currentPage.mouse.move(startX, startY);
		await this.code.driver.currentPage.mouse.down();
		await this.code.driver.currentPage.mouse.move(startX, startY + DRAG_ACTIVATION_DISTANCE_PX + 5, { steps: 3 });

		// Wait for the cursor-following drag overlay to appear, which is the
		// user-visible signal that a drag is fully active.
		const page = this.code.driver.currentPage;
		await expect(page.locator('.cursor-following-overlay')).toBeVisible({ timeout: 2000 });

		return { startX, startY };
	}

	/**
	 * Action: Drag a cell from one position to another using the drag handle.
	 * @param fromIndex - The index of the cell to drag
	 * @param toIndex - The index of the cell to drop onto
	 */
	async dragCellToPosition(fromIndex: number, toIndex: number): Promise<void> {
		await test.step(`Drag cell from index ${fromIndex} to index ${toIndex}`, async () => {
			const { startX } = await this._activateDrag(fromIndex);
			const page = this.code.driver.currentPage;

			try {
				// Scroll the target cell into view programmatically AFTER
				// the drag activates. _activateDrag hovers the source cell
				// which may scroll the container; we need the target visible
				// so the mouse move doesn't trigger dnd-kit's auto-scroll
				// (which shifts cell positions mid-move).
				const targetCell = this.sortableCellAtIndex(toIndex);
				const handle = await targetCell.elementHandle();
				if (!handle) {
					throw new Error('Could not get element handle for target cell');
				}
				await page.evaluate(
					(el) => el.scrollIntoView({ block: 'center' }),
					handle
				);

				const targetBox = await targetCell.boundingBox();
				if (!targetBox) {
					throw new Error('Could not get bounding box for target cell during drag');
				}

				// Target 75%/25% inside the cell because dnd-kit's collision
				// detection uses the vertical midpoint to decide above vs. below
				// placement. See: SortableCellList.tsx collisionDetection
				// callback (midY calculation).
				const targetY = toIndex > fromIndex
					? targetBox.y + targetBox.height * 0.75
					: targetBox.y + targetBox.height * 0.25;

				await page.mouse.move(startX, targetY, { steps: 10 });

				// Wait for the drop indicator to appear, confirming dnd-kit
				// processed the pointer position. This method is only used for
				// real (non-no-op) moves, so the indicator will always appear.
				await expect(
					page.getByTestId('drop-indicator')
				).toBeVisible({ timeout: 2000 });
			} finally {
				await page.mouse.up();
			}
		});
	}

	/**
	 * Action: Start dragging a cell (without releasing). Useful for testing drag cancellation.
	 * @param cellIndex - The index of the cell to start dragging
	 */
	async startDragCell(cellIndex: number): Promise<void> {
		await test.step(`Start dragging cell at index ${cellIndex}`, async () => {
			await this._activateDrag(cellIndex);
			// Leave mouse down - caller controls what happens next
		});
	}

	/**
	 * Action: Drag a cell to a position that requires auto-scrolling.
	 * This method handles dragging across long notebooks where the target
	 * position is not initially visible.
	 * @param fromIndex - The index of the cell to drag
	 * @param toIndex - The target index (may be off-screen)
	 */
	async dragCellToPositionWithScroll(fromIndex: number, toIndex: number): Promise<void> {
		await test.step(`Drag cell from index ${fromIndex} to index ${toIndex} (with auto-scroll)`, async () => {
			// Ensure source cell is visible before activating drag
			const sourceCell = this.sortableCellAtIndex(fromIndex);
			await sourceCell.scrollIntoViewIfNeeded();
			await expect(sourceCell).toBeVisible();

			const { startX } = await this._activateDrag(fromIndex);

			// Get the notebook container for viewport bounds
			const notebookContainer = this.positronNotebook;
			const containerBox = await notebookContainer.boundingBox();
			if (!containerBox) {
				throw new Error('Could not get notebook container bounding box');
			}

			// Determine scroll direction
			const scrollingDown = toIndex > fromIndex;

			// Move to the edge of the viewport to trigger auto-scroll
			// dnd-kit's auto-scroll triggers near viewport edges
			const edgeY = scrollingDown
				? containerBox.y + containerBox.height * 0.85  // Near bottom edge
				: containerBox.y + containerBox.height * 0.15; // Near top edge

			// The gap where dnd-kit will actually drop: after the target cell when
			// scrolling down, before it when scrolling up. This is the same index
			// AddCellButtons receives -- see PositronNotebookComponent.tsx.
			const targetGapIndex = scrollingDown ? toIndex + 1 : toIndex;
			// The drop indicator reflects dnd-kit's own collision detection
			// (computeDropIndex in sortableCellListLogic.ts), which is the
			// authoritative source of truth for reachability -- unlike a
			// bounding-box re-check, it can't disagree with the real drag state.
			const targetDropIndicator = this.dropIndicatorAtGap(targetGapIndex);

			try {
				await this.code.driver.currentPage.mouse.move(startX, edgeY, { steps: 5 });

				await expect(async () => {
					// Keep cursor at edge to maintain auto-scroll
					await this.code.driver.currentPage.mouse.move(startX, edgeY, { steps: 2 });
					await expect(targetDropIndicator).toBeVisible({ timeout: 500 });
				}).toPass({ timeout: 15000, intervals: [100, 200, 300, 500] });
			} finally {
				await this.code.driver.currentPage.mouse.up();
			}
		});
	}

	/**
	 * Action: Hover over a cell to show the drag handle.
	 * @param cellIndex - The index of the cell to hover over
	 */
	async hoverCell(cellIndex: number): Promise<void> {
		await test.step(`Hover over cell at index ${cellIndex}`, async () => {
			// Hover near the left edge of the cell to trigger handle visibility.
			// Uses locator.hover() for auto-wait and auto-scroll guarantees
			// (avoids coupling to the internal .cell-drag-zone CSS class).
			await this.sortableCellAtIndex(cellIndex).hover({ position: { x: 8, y: 20 } });
		});
	}

	/**
	 * Action: Select an output action from the Output Action Bar for a cell.
	 * @param cellIndex - The index of the cell to act on
	 * @param button - The button to click on the Output Action Bar
	 */
	async triggerCellOutputAction(cellIndex: number, button: OutputActionBarButtons): Promise<void> {
		await test.step(`Click "${button}" for cell ${cellIndex}`, async () => {
			await this.cellOutput(cellIndex).hover();
			await this.outputActionBar(cellIndex).getByRole('button', { name: button }).click();
		});
	}

	/**
	 * Action: Drag the output resize sash for a cell by a given distance.
	 * @param cellIndex - The index of the cell whose output sash to drag.
	 * @param distance - The vertical distance in pixels to drag (positive = down).
	 */
	async dragCellOutputSash(cellIndex: number, distance: number) {
		const page = this.code.driver.currentPage;
		const sash = this.cellOutputSash(cellIndex);

		// Reveal the sash for debugging.
		await sash.scrollIntoViewIfNeeded();

		// Get the sash's starting position.
		const box = await sash.boundingBox();
		expect(box).toBeTruthy();
		const startX = box!.x + box!.width / 2;
		const startY = box!.y + box!.height / 2;

		// Drag the sash down to grow the output area.
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX, startY + distance, { steps: 10 });
		await page.mouse.up();

		// Reveal the final sash position for debugging.
		await sash.scrollIntoViewIfNeeded();
	}

	/**
	 * Get the height of a cell's output area.
	 * @param cellIndex - The index of the cell to measure
	 * @returns The height of the cell's output area in pixels
	 */
	async getCellOutputHeight(cellIndex: number): Promise<number> {
		const output = this.cellOutput(cellIndex);
		const box = await output.boundingBox();
		if (!box) {
			throw new Error(`Could not get bounding box for cell output at index ${cellIndex}`);
		}
		return box.height;
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
			// The button count before adding the cell will match the new cell count after adding the cell.
			// This is because there is one extra "New Code Cell" button at the beginning of the notebook.
			// Ex: if there are 0 cells, there is 1 button; if there is 1 cell, there are 2 buttons, etc.
			await expect(this.cell).toHaveCount(newCellButtonCount, { timeout: DEFAULT_TIMEOUT });
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
	 * fast: Use fill() instead of pressSequentially() — skips keystroke simulation for bulk population (default: false).
	 * run: Whether to run the cell after adding code (default: false).
	 * waitForSpinner: Whether to wait for the execution spinner to appear and disappear (default: false).
	 * waitForPopup: Whether to wait for the execution info popup to appear after running (default: false).
	 */
	async addCodeToCell(
		cellIndex: number,
		code: string,
		options?: { delay?: number; fast?: boolean; run?: boolean; waitForSpinner?: boolean; container?: Locator }
	): Promise<Locator> {
		const { delay = 0, fast = false, run = false, waitForSpinner = false, container } = options ?? {};
		// When a container is provided, scope all cell lookups to it so that cells from
		// other open notebooks are not counted or accidentally targeted.
		const scopedCell = container ? container.locator('[data-testid="notebook-cell"]') : this.cell;

		return await test.step(`Add code to cell: ${cellIndex}, run: ${run}, waitForSpinner: ${waitForSpinner}`, async () => {
			const currentCellCount = await scopedCell.count();

			if (cellIndex >= currentCellCount) {
				if (cellIndex > currentCellCount) {
					throw new Error(`Cannot create cell at index ${cellIndex}. Current cell count is ${currentCellCount}. Can only add cells sequentially.`);
				}
				await this.addCodeCellToEnd();
			}

			const cell = scopedCell.nth(cellIndex);
			const ariaLabel = await cell.getAttribute('aria-label');
			ariaLabel === 'Markdown cell' ? await cell.dblclick() : await cell.click();

			// Focus the editor for the cell
			const editor = cell.locator('.monaco-editor :is(.native-edit-context, .inputarea)');
			await editor.focus();

			if (fast) {
				await this.code.driver.currentPage.keyboard.insertText(code);
			} else {
				await editor.pressSequentially(code, { delay });
			}

			if (run) {
				await cell.getByRole('button', { name: 'Run Cell', exact: true }).click();

				if (waitForSpinner) {
					const spinner = cell.getByLabel(/Cell is executing/i);
					await expect(spinner).toBeVisible({ timeout: 2000 }).catch(() => {
						// Spinner might not appear for very fast executions, that's okay
					});
					await expect(spinner).toHaveCount(0, { timeout: DEFAULT_TIMEOUT });
				}
			}

			return cell;
		});
	}

	/**
	 * Action: Add a tag to the cell at the specified index.
	 *
	 * Uses the "Add Tag" command, which opens the inline tag input on the
	 * active cell; the tag is committed with Enter.
	 * @param cellIndex - The index of the cell to tag.
	 * @param tag - The tag text to add (e.g. 'raises-exception').
	 */
	async addCellTag(cellIndex: number, tag: string): Promise<void> {
		await test.step(`Add tag "${tag}" to cell ${cellIndex}`, async () => {
			await this.selectCellAtIndex(cellIndex);
			await this.quickaccess.runCommand('positronNotebook.cell.addTag');

			const tagInput = this.cell.nth(cellIndex).locator('.positron-notebook-cell-tag-input');
			await expect(tagInput).toBeFocused({ timeout: DEFAULT_TIMEOUT });
			await tagInput.fill(tag);
			await this.code.driver.currentPage.keyboard.press('Enter');

			// Confirm the tag pill rendered.
			await expect(
				this.cell.nth(cellIndex).getByRole('button', { name: `Edit tag ${tag}` })
			).toBeVisible({ timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Action: Run all cells and wait for execution to finish.
	 *
	 * Overrides the legacy notebook implementation: triggers Run All via the
	 * Cmd/Ctrl+Shift+Enter command-mode shortcut, then waits for all execution
	 * spinners to clear.
	 * @param timeout - Maximum time to wait for execution to complete.
	 */
	override async runAllCells({ timeout = 30000 } = {}): Promise<void> {
		await test.step('Run all cells', async () => {
			// Run All / Interrupt own the Cmd/Ctrl+Shift+Enter shortcut in command
			// mode; exit edit mode first so it doesn't just run the selection in the
			// focused cell (#3804).
			await this.selectCellAtIndex(0, { editMode: false });
			const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
			await this.code.driver.currentPage.keyboard.press(`${mod}+Shift+Enter`);
			await this.expectNoActiveSpinners(timeout);
		});
	}

	/**
	 * Action: Perform a cell action using keyboard shortcuts.
	 * @param action - The action to perform: 'copy', 'cut', 'paste', 'undo', 'redo', 'delete', 'addCellBelow'.
	 */
	async performCellAction(action: 'copy' | 'cut' | 'paste' | 'undo' | 'redo' | 'delete' | 'addCellBelow' | 'changeToCode' | 'changeToMarkdown' | 'changeToRaw'): Promise<void> {
		await test.step(`Perform cell action: ${action}`, async () => {
			// Note: We use direct keyboard shortcuts instead of hotKeys/clipboard helpers
			// because Positron Notebooks uses Jupyter-style single-key shortcuts (C/X/V/Z)
			// in command mode, not the standard Cmd+C/X/V/Z shortcuts
			switch (action) {
				case 'copy':
					await this.code.driver.currentPage.keyboard.press('KeyC');
					break;
				case 'cut':
					await this.code.driver.currentPage.keyboard.press('KeyX');
					break;
				case 'paste':
					await this.code.driver.currentPage.keyboard.press('KeyV');
					break;
				case 'undo':
					await this.code.driver.currentPage.keyboard.press('KeyZ');
					break;
				case 'redo':
					await this.code.driver.currentPage.keyboard.press('Shift+KeyZ');
					break;
				case 'delete':
					await this.code.driver.currentPage.keyboard.press('Backspace');
					break;
				case 'addCellBelow':
					await this.code.driver.currentPage.keyboard.press('KeyB');
					break;
				case 'changeToCode':
					await this.code.driver.currentPage.keyboard.press('KeyY');
					break;
				case 'changeToMarkdown':
					await this.code.driver.currentPage.keyboard.press('KeyM');
					break;
				case 'changeToRaw':
					await this.code.driver.currentPage.keyboard.press('KeyR');
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
			await this.code.driver.currentPage.waitForTimeout(100);
		});
	}

	/**
	 * Action: Click the "Ask assistant to fix" button on an error cell.
	 * Requires: assistant enabled, a model signed in, and an error visible in a cell.
	 */
	async clickFixErrorButton(): Promise<void> {
		await test.step('Click Fix error button', async () => {
			await this.fixErrorButton.click();
		});
	}

	/**
	 * Action: Click the "Ask assistant to explain" button on an error cell.
	 * Requires: assistant enabled, a model signed in, and an error visible in a cell.
	 */
	async clickExplainErrorButton(): Promise<void> {
		await test.step('Click Explain error button', async () => {
			await this.explainErrorButton.click();
		});
	}

	/**
	 * Action: Click the "Ask Assistant" button in the editor action bar.
	 * Requires: assistant enabled and a model signed in.
	 */
	async clickAskAssistantButton(): Promise<void> {
		await test.step('Click Ask Assistant button', async () => {
			await this.askAssistantButton.click();
		});
	}

	async expectNotebookAssistantModalVisible(timeout = 10000): Promise<void> {
		await expect(
			this.code.driver.currentPage
				.locator('.positron-dynamic-modal-dialog-box')
				.filter({ hasText: 'Positron Notebook Assistant' })
		).toBeVisible({ timeout });
	}

	/**
	 * Action: Search Notebook.
	 * @param searchText - The text to search for.
	 * @param options - Options to control behavior:
	 * replaceText: Optional text to replace the search text with.
	 * replaceAll: Whether to replace all occurrences (default: false).
	 */
	async search(
		searchText: string,
		options?: { replaceText?: string; replaceAll?: boolean; enterKey?: boolean }
	): Promise<void> {
		const { replaceText = undefined, replaceAll = false, enterKey = true } = options ?? {};

		await test.step(`Search notebook for: ${searchText}`, async () => {
			// Open search
			await this.hotKeys.searchInNotebook();
			await expect(this.searchWidget).toBeVisible({ timeout: 2000 });

			// Enter search text
			await this.findInput.fill(searchText);

			if (enterKey) {
				await this.code.driver.currentPage.keyboard.press('Enter');
			}

			// If replace text is provided, expand replace row and perform replace
			if (replaceText !== undefined) {
				// Wait for search results before interacting with replace
				await expect(this.searchNextButton).toBeEnabled({ timeout: 5000 });

				await this.searchExpandReplace();
				await this.replaceInput.fill(replaceText);

				if (replaceAll) {
					await this.replaceAllButton.click();
				} else {
					await this.replaceButton.click();
				}
			}
		});
	}

	/**
	 * Action: Click the 'Next Match' button in the search widget.
	 * @param mode - 'button' to click the button, 'keyboard' to press Enter key (default: 'button')
	 */
	async searchNext(mode: 'button' | 'keyboard' = 'button'): Promise<void> {
		await test.step('Search next match', async () => {
			mode === 'keyboard'
				? await this.code.driver.currentPage.keyboard.press('Enter')
				: await this.searchNextButton.click();
		});
	}

	/**
	 * Action: Click the 'Previous Match' button in the search widget.
	 */
	async searchPrevious(): Promise<void> {
		await test.step('Search previous match', async () => {
			await this.searchPreviousButton.click();
		});
	}

	/**
	 * Action: Close the search widget.
	 * @param mode - 'button' to click the close button, 'keyboard' to press Escape key.
	 */
	async searchClose(mode: 'button' | 'keyboard' = 'button'): Promise<void> {
		await test.step('Close search widget', async () => {
			mode === 'keyboard'
				? await this.code.driver.currentPage.keyboard.press('Escape')
				: await this.searchCloseButton.click();

			await expect(this.searchWidget).not.toBeVisible({ timeout: 2000 });
		});
	}

	/**
	 * Action: Expand the replace row in the search widget.
	 * Clicks the "Toggle Replace" button if the replace input is not already visible.
	 */
	async searchExpandReplace(): Promise<void> {
		await test.step('Expand replace row', async () => {
			if (!await this.replaceInput.isVisible()) {
				// Move the mouse away to dismiss any tooltip that may intercept the click
				await this.code.driver.currentPage.mouse.move(0, 0);
				await this.toggleReplaceButton.click();
			}
			await expect(this.replaceInput).toBeVisible({ timeout: 2000 });
		});
	}

	/**
	 * Action: Set a search option toggle to the given state.
	 * Clicks the toggle only if its current state differs from the desired one.
	 * @param toggle - The search option toggle to set.
	 * @param enabled - The desired checked state.
	 */
	async searchSetToggle(toggle: 'matchCase' | 'wholeWord' | 'regex', enabled: boolean): Promise<void> {
		await test.step(`Set search toggle ${toggle} to ${enabled}`, async () => {
			const toggleLocator = {
				matchCase: this.searchMatchCaseToggle,
				wholeWord: this.searchWholeWordToggle,
				regex: this.searchRegexToggle,
			}[toggle];

			if (await toggleLocator.getAttribute('aria-checked') !== String(enabled)) {
				await toggleLocator.click();
			}
			await expect(toggleLocator).toHaveAttribute('aria-checked', String(enabled), { timeout: 2000 });
		});
	}

	/**
	 * Action: Fill the replace input without performing a replace.
	 * Expands the replace row if it is not already visible.
	 * @param replaceText - The text to fill into the replace input.
	 */
	async searchSetReplaceText(replaceText: string): Promise<void> {
		await test.step(`Set replace text to: ${replaceText}`, async () => {
			await this.searchExpandReplace();
			await this.replaceInput.fill(replaceText);
		});
	}

	/**
	 * Action: Click the 'Replace' button.
	 * Replaces the current match and advances to the next one. Note: if no
	 * match is active yet, the first click only navigates to the first match
	 * without replacing (two-step behavior, matching the editor find widget).
	 */
	async searchReplaceNext(): Promise<void> {
		await test.step('Replace current match', async () => {
			await this.replaceButton.click();
		});
	}

	/**
	 * Action: Click the 'Replace All' button.
	 */
	async searchReplaceAll(): Promise<void> {
		await test.step('Replace all matches', async () => {
			await this.replaceAllButton.click();
		});
	}

	// #endregion

	// #region VERIFICATIONS

	/**
	 * Verify: Replace row is visible or hidden.
	 * @param visible - Whether the replace row should be visible (true) or hidden (false).
	 */
	async expectReplaceRowVisible(visible: boolean = true): Promise<void> {
		await test.step(`Expect replace row to be ${visible ? 'visible' : 'hidden'}`, async () => {
			if (visible) {
				await expect(this.replaceInput).toBeVisible({ timeout: 2000 });
				await expect(this.replaceButton).toBeVisible({ timeout: 2000 });
				await expect(this.replaceAllButton).toBeVisible({ timeout: 2000 });
			} else {
				await expect(this.replaceInput).not.toBeVisible({ timeout: 2000 });
			}
		});
	}

	/**
	 * Verify: Assistant buttons visibility.
	 * @param visible - Whether the buttons should be visible (true) or hidden (false).
	 */
	async expectAssistantButtonsVisible(visible: boolean = true): Promise<void> {
		await test.step(`Expect assistant buttons to be ${visible ? 'visible' : 'hidden'}`, async () => {
			if (visible) {
				await expect(this.askAssistantButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
			} else {
				await expect(this.askAssistantButton).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
			}
		});
	}

	/**
	 * Verify: Fix/Explain error buttons visibility.
	 * @param visible - Whether the buttons should be visible (true) or hidden (false).
	 */
	async expectErrorAssistantButtonsVisible(visible: boolean = true): Promise<void> {
		await test.step(`Expect Fix/Explain error buttons to be ${visible ? 'visible' : 'hidden'}`, async () => {
			if (visible) {
				await expect(this.fixErrorButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
				await expect(this.explainErrorButton).toBeVisible({ timeout: DEFAULT_TIMEOUT });
			} else {
				await expect(this.fixErrorButton).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
				await expect(this.explainErrorButton).not.toBeVisible({ timeout: DEFAULT_TIMEOUT });
			}
		});
	}

	/**
	 * Verify: A notebook error is visible in any cell.
	 * @param timeout - The maximum time to wait for visibility (default: 10000ms)
	 */
	async expectNotebookErrorVisible(timeout: number = 10000): Promise<void> {
		await test.step('Expect notebook error to be visible', async () => {
			await this.code.driver.currentPage.waitForSelector('.notebook-error', { timeout });
		});
	}

	/**
	 * Verify: search count matches expected count.
	 * @param total  - The expected number of search results.
	 * @param current - The expected current search result index (1-based).
	 */
	async expectSearchCountToBe({ current, total }: { current?: number; total: number }): Promise<void> {
		await test.step(`Expect search count to be: ${current ?? '_'} of ${total}`, async () => {
			if (total === 0) {
				await expect(this.searchWidget.getByText('No results')).toBeVisible({ timeout: DEFAULT_TIMEOUT });
			} else {
				const countText = current !== undefined ? `${current} of ${total}` : `of ${total}`;
				await expect(this.searchWidget.getByText(countText)).toBeVisible({ timeout: DEFAULT_TIMEOUT });
			}
		});
	}

	/**
	 * Verify: search decoration count matches expected count.
	 * @param expectedCount - The expected number of search decorations.
	 */
	async expectSearchDecorationCountToBe(expectedCount: number): Promise<void> {
		await test.step(`Expect search decoration count to be: ${expectedCount}`, async () => {
			await expect(this.searchDecoration).toHaveCount(expectedCount, { timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Verify: Replace and Replace All buttons enabled state.
	 * Note: the widget disables these buttons only when the find text is
	 * empty, not when a query has zero matches.
	 * @param enabled - Whether the buttons should be enabled (true) or disabled (false).
	 */
	async expectReplaceButtonsEnabled(enabled: boolean = true): Promise<void> {
		await test.step(`Expect replace buttons to be ${enabled ? 'enabled' : 'disabled'}`, async () => {
			if (enabled) {
				await expect(this.replaceButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
				await expect(this.replaceAllButton).toBeEnabled({ timeout: DEFAULT_TIMEOUT });
			} else {
				await expect(this.replaceButton).toBeDisabled({ timeout: DEFAULT_TIMEOUT });
				await expect(this.replaceAllButton).toBeDisabled({ timeout: DEFAULT_TIMEOUT });
			}
		});
	}

	/**
	 * Verify: hovering a search widget button shows a tooltip with the expected text.
	 * @param button - The search widget button to hover.
	 * @param expectedTooltip - The expected tooltip text (string or regex).
	 */
	async expectSearchButtonTooltip(
		button: 'previous' | 'next' | 'close' | 'toggleReplace' | 'replace' | 'replaceAll',
		expectedTooltip: string | RegExp
	): Promise<void> {
		await test.step(`Expect tooltip on ${button} button: ${expectedTooltip}`, async () => {
			const buttonLocator = {
				previous: this.searchPreviousButton,
				next: this.searchNextButton,
				close: this.searchCloseButton,
				toggleReplace: this.toggleReplaceButton,
				replace: this.replaceButton,
				replaceAll: this.replaceAllButton,
			}[button];

			// Park the mouse elsewhere first so the hover delay applies cleanly,
			// then hover the button and wait for the tooltip to render.
			await this.code.driver.currentPage.mouse.move(0, 0);
			await expect(this.hoverTooltip).not.toBeVisible({ timeout: 5000 });
			await buttonLocator.hover();
			await expect(this.hoverTooltip).toContainText(expectedTooltip, { timeout: DEFAULT_TIMEOUT });
		});
	}

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
	 * @param expectedType - The expected type of the cell ('code', 'markdown', or 'raw').
	 */
	async expectCellTypeAtIndexToBe(cellIndex: number, expectedType: 'code' | 'markdown' | 'raw'): Promise<void> {
		await test.step(`Expect cell ${cellIndex} type to be: ${expectedType}`, async () => {
			const ariaLabel = await this.cell.nth(cellIndex).getAttribute('aria-label');

			if (expectedType === 'code') {
				expect(ariaLabel).toContain('Code cell');
			} else if (expectedType === 'markdown') {
				expect(ariaLabel).toContain('Markdown cell');
			} else if (expectedType === 'raw') {
				expect(ariaLabel).toContain('Raw cell');
			}
		});
	}

	/**
	 * Verify: Cell content at specified index matches expected content.
	 * @param cellIndex - The index of the cell to check.
	 * @param expectedContent - The expected content of the cell.
	 * @param cell - Optional scoped cell locator. When provided, reads content directly
	 *               from this locator instead of using the page-wide cell at cellIndex.
	 *               Use this when multiple notebooks are open to avoid targeting the wrong cell.
	 */
	async expectCellContentAtIndexToBe(cellIndex: number, expectedContent: string | string[], cell?: Locator): Promise<void> {
		await test.step(`Expect cell ${cellIndex} content to be: ${expectedContent}`, async () => {
			await expect(async () => {
				const actualContent = cell
					? await this.getCellContentFromLocator(cell)
					: await this.getCellContent(cellIndex);

				if (Array.isArray(expectedContent)) {
					// Compare arrays line by line
					expect(actualContent.length).toBe(expectedContent.length);
					for (let i = 0; i < expectedContent.length; i++) {
						expect(actualContent[i]).toBe(expectedContent[i]);
					}
				} else {
					// Single string comparison
					if (actualContent.length !== 1) {
						throw new Error(`Expected single line content but got ${actualContent.length} lines: ${actualContent.join('\n')}`);
					}
					expect(actualContent[0]).toBe(expectedContent);
				}
			}).toPass({ timeout: 2000 });
		});
	}

	/**
	 * Verify: Cell footer contains expected execution info.
	 * @param cellIndex - The index of the cell whose footer to check.
	 * @param expectedContent - Object with expected content to verify.
	 *                          Use RegExp for fields where exact match is not feasible (e.g., duration, completed time).
	 * @param timeout - Optional timeout for the expectation.
	 */
	async expectFooterToContain(
		cellIndex: number,
		expectedContent: { duration?: RegExp; status?: 'Cell execution succeeded' | 'Cell execution failed' | 'Cell is executing' | 'Cell is queued for execution'; completed?: RegExp },
		timeout = DEFAULT_TIMEOUT
	): Promise<void> {
		await test.step(`Expect cell footer to contain: ${JSON.stringify(expectedContent)}`, async () => {
			const footer = this.cellFooterAtIndex(cellIndex);
			await expect(footer).toBeVisible({ timeout });

			// Check status via data-execution-status attribute
			if (expectedContent.status) {
				const statusMap: Record<string, string> = {
					'Cell execution succeeded': 'idle',
					'Cell execution failed': 'idle',
					'Cell is executing': 'running',
					'Cell is queued for execution': 'pending'
				};
				const expectedStatus = statusMap[expectedContent.status];
				await expect(footer).toHaveAttribute('data-execution-status', expectedStatus, { timeout });

				// Check for appropriate icon based on status
				const status = expectedContent.status;
				if (status === 'Cell is executing') {
					await expect(footer.locator('.code-cell-footer-icon.running')).toBeVisible({ timeout });
				} else if (status === 'Cell is queued for execution') {
					await expect(footer.locator('.code-cell-footer-icon.pending')).toBeVisible({ timeout });
				} else if (status === 'Cell execution succeeded') {
					await expect(footer.locator('.code-cell-footer-icon.success')).toBeVisible({ timeout });
				} else if (status === 'Cell execution failed') {
					await expect(footer.locator('.code-cell-footer-icon.error')).toBeVisible({ timeout });
				}
			}

			// Check duration if provided
			if (expectedContent.duration) {
				const durationText = footer.locator('.code-cell-footer-duration');
				await expect(durationText).toContainText(expectedContent.duration, { timeout });
			}

			// Check completion time if provided
			if (expectedContent.completed) {
				const footerText = footer.locator('.code-cell-footer-text');
				await expect(footerText).toContainText(expectedContent.completed, { timeout });
			}
		});
	}

	/**
	 * Verify: Cell footer has the expected aria-label.
	 * @param cellIndex - The index of the cell whose footer to check.
	 * @param expectedAriaLabel - The expected aria-label value.
	 * @param timeout - Optional timeout for the expectation.
	 */
	async expectFooterAriaLabel(cellIndex: number, expectedAriaLabel: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect cell footer aria-label to be: ${expectedAriaLabel}`, async () => {
			const footer = this.cellFooterAtIndex(cellIndex);
			await expect(footer).toHaveAttribute('aria-label', expectedAriaLabel, { timeout });
		});
	}

	/**
	 * Verify: Cell footer is collapsed (hidden via CSS animation).
	 * @param cellIndex - The index of the cell whose footer to check.
	 */
	async expectFooterNotVisible(cellIndex: number): Promise<void> {
		await test.step(`Expect cell footer to be collapsed`, async () => {
			const footer = this.cellFooterAtIndex(cellIndex);
			await expect(footer).toHaveClass(/\bcollapsed\b/);
			await expect(footer).not.toBeVisible();
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
	async expectExecutionOrder(executionOrders: { index: number; order: number | undefined }[]): Promise<void> {
		for (const { index, order } of executionOrders) {
			await test.step(`Expect execution order at index ${index} to be: ${order}`, async () => {
				const badge = this.executionOrderBadgeAtIndex(index);

				if (order === undefined) {
					// Cell hasn't been executed yet, should show "-"
					const badgeText = await badge.textContent();
					expect(badgeText?.trim()).toBe('-');
				} else {
					// Cell has been executed, should show the order number
					await expect(badge).toHaveText(`${order}`);
				}
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
	 * Verify: drag handle visibility state for a cell.
	 * @param cellIndex - The index of the cell to check.
	 * @param visible - Whether the drag handle should be visible.
	 * @param timeout - Timeout for the expectation.
	 */
	async expectDragHandleVisibility(cellIndex: number, visible: boolean, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect drag handle at index ${cellIndex} to be ${visible ? 'visible' : 'hidden'}`, async () => {
			const dragHandle = this.dragHandleAtIndex(cellIndex);

			// Note: Drag handle uses opacity for show/hide (see SortableCell.css)
			// opacity: 0 when hidden, 1 on hover (via CSS :hover on parent element)
			await expect(async () => {
				const opacity = await dragHandle.evaluate(el =>
					parseFloat(window.getComputedStyle(el).opacity)
				);
				if (visible) {
					expect(opacity).toBeGreaterThan(0);
				} else {
					expect(opacity).toBe(0);
				}
			}).toPass({ timeout });
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
			const resolvedFile = basename(resolvedPath);
			const repoRelativePath = relative(process.cwd(), resolvedPath).replace(/\\/g, '/');
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

	/**
	 * Verify: the height of the cell's output area matches expected height.
	 * @param cellIndex - The index of the cell to check.
	 * @param height - The expected height of the cell's output area in pixels.
	 * @param options - Options to control expectation:
	 *   tolerance: Optional pixel tolerance for height comparison (default: 0, meaning exact match).
	 */
	async expectCellOutputHeight(
		cellIndex: number,
		height: number,
		{ tolerance = 0 }: { tolerance?: number } = {}
	): Promise<void> {
		await test.step(`Verify cell output height at index ${cellIndex} is ${height}px (±${tolerance}px)`, async () => {
			const actual = await this.getCellOutputHeight(cellIndex);
			if (tolerance === 0) {
				expect(actual).toBe(height);
			} else {
				expect(actual).toBeGreaterThanOrEqual(height - tolerance);
				expect(actual).toBeLessThanOrEqual(height + tolerance);
			}
		});
	}

	/**
	 * Verify: the cell at the specified index is fully visible within the
	 * notebook scroll container. For cells taller than the viewport, checks
	 * that the specified edge ('top' or 'bottom') is visible instead.
	 */
	async expectCellToBeVisibleInViewport(
		cellIndex: number,
		options?: { edge?: 'top' | 'bottom' }
	): Promise<void> {
		await test.step(`Verify cell ${cellIndex} is visible in viewport`, async () => {
			await expect(async () => {
				const cellBox = await this.cell.nth(cellIndex).boundingBox();
				const containerBox = await this.cellsContainer.boundingBox();
				expect(cellBox, `Cell ${cellIndex} has no bounding box`).not.toBeNull();
				expect(containerBox, 'Cells container has no bounding box').not.toBeNull();

				const isOversized = cellBox!.height > containerBox!.height;

				if (isOversized) {
					// Oversized cell: check the requested edge, or default to
					// verifying at least partial overlap with the viewport.
					if (options?.edge === 'top') {
						expect(cellBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 1);
					} else if (options?.edge === 'bottom') {
						expect(cellBox!.y + cellBox!.height).toBeLessThanOrEqual(
							containerBox!.y + containerBox!.height + 1
						);
					} else {
						// No edge specified: cell must at least partially overlap viewport
						const cellBottom = cellBox!.y + cellBox!.height;
						const containerBottom = containerBox!.y + containerBox!.height;
						expect(cellBottom).toBeGreaterThanOrEqual(containerBox!.y - 1);
						expect(cellBox!.y).toBeLessThanOrEqual(containerBottom + 1);
					}
				} else {
					// Cell should be fully within container
					expect(cellBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 1);
					expect(cellBox!.y + cellBox!.height).toBeLessThanOrEqual(
						containerBox!.y + containerBox!.height + 1
					);
				}
			}).toPass({ timeout: DEFAULT_TIMEOUT });
		});
	}

	/**
	 * Verify: the action bar for the cell at the specified index is not clipped
	 * by the notebook scroll container (its top edge is within the viewport).
	 */
	async expectActionBarVisibleInViewport(cellIndex: number): Promise<void> {
		await test.step(`Verify action bar for cell ${cellIndex} is visible in viewport`, async () => {
			await expect(async () => {
				const actionBar = this.cell.nth(cellIndex).locator('.positron-notebooks-cell-action-bar');
				const actionBarBox = await actionBar.boundingBox();
				const containerBox = await this.cellsContainer.boundingBox();
				expect(actionBarBox, `Action bar for cell ${cellIndex} has no bounding box`).not.toBeNull();
				expect(containerBox, 'Cells container has no bounding box').not.toBeNull();

				// The action bar's top edge should not be above the scroll container
				expect(actionBarBox!.y).toBeGreaterThanOrEqual(containerBox!.y - 1);
			}).toPass({ timeout: DEFAULT_TIMEOUT });
		});
	}

	// #region Ghost Cell Verifications

	/**
	 * Verify: "Generating suggestion..." message is visible.
	 */
	async expectGhostCellGenerationVisible(): Promise<void> {
		await test.step('Verify "Generating suggestion..." is visible', async () => {
			await expect(this.ghostCellGenerating).toBeVisible({ timeout: 5000 });
		});
	}

	/**
	 * Verify: Ghost cell is visible with all expected components.
	 */
	async expectGhostCellVisible(): Promise<void> {
		await test.step('Verify ghost cell is visible with all components', async () => {
			// Wait for header first (indicates ghost cell is rendering)
			await expect(this.ghostCellHeader).toBeVisible();

			// Then check all other components in parallel
			await Promise.all([
				// Header components
				expect(this.ghostCellExplanationText).toBeVisible(),
				expect(this.ghostCellModeToggle).toBeVisible(),
				expect(this.ghostCellAccept).toBeVisible(),
				expect(this.ghostCellDismiss).toBeVisible(),
				expect(this.ghostCellRegenerate).toBeVisible(),

				// Code preview
				expect(this.ghostCellCodePreview).toBeVisible(),
				expect(this.ghostCellCodeText).toBeVisible(),

				// Footer
				expect(this.ghostCellFooter).toBeVisible(),
				expect(this.ghostCellInfoButton).toBeVisible(),
				expect(this.ghostCellModelInfo).toBeVisible()
			]);
		});
	}

	/**
	 * Verify: Ghost cell mode is set to the expected value.
	 * @param automatic - True for Automatic mode, false for On-demand mode
	 */
	async expectGhostCellMode(automatic: boolean): Promise<void> {
		await test.step(`Verify ghost cell mode is ${automatic ? 'Automatic' : 'On-demand'}`, async () => {
			const button = automatic ? this.ghostCellAutomaticButton : this.ghostCellOnDemandButton;
			// Check button has the highlighted class (indicates it's selected)
			await expect(button).toHaveClass(/highlighted/);
		});
	}

	/**
	 * Verify: "AI suggestion available on request" UI is visible.
	 */
	async expectGhostCellAwaitingRequest(): Promise<void> {
		await test.step('Verify "AI suggestion available on request" is visible', async () => {
			// Wait for the container first
			await expect(this.ghostCellAwaitingRequest).toBeVisible();

			// Then check all other elements in parallel
			await Promise.all([
				expect(this.ghostCellAwaitingText).toHaveText('AI suggestion available on request'),
				expect(this.ghostCellGetSuggestion).toBeVisible(),
				expect(this.ghostCellGetSuggestion).toHaveText('Get Suggestion'),
				expect(this.ghostCellDismissButton).toBeVisible()
			]);
		});
	}

	/**
	 * Verify: Ghost cell contains expected text.
	 * @param expectedText - The text expected to be in the ghost cell
	 */
	async expectGhostCellToContainText(expectedText: string): Promise<void> {
		await test.step(`Verify ghost cell contains text: "${expectedText}"`, async () => {
			await expect(this.ghostCellCodeText).toContainText(expectedText);
		});
	}

	// #endregion

	// #region Ghost Cell Actions

	/**
	 * Action: Select ghost cell mode.
	 * @param automatic - True for Automatic mode, false for On-demand mode
	 */
	async selectGhostCellMode(automatic: boolean): Promise<void> {
		await test.step(`Select ghost cell mode: ${automatic ? 'Automatic' : 'On-demand'}`, async () => {
			// Add retry logic for potentially flaky toggle
			await expect(async () => {
				// Click the appropriate button directly
				const button = automatic ? this.ghostCellAutomaticButton : this.ghostCellOnDemandButton;
				await button.click();

				// Verify the mode was selected
				await this.expectGhostCellMode(automatic);
			}).toPass({ timeout: 5000 });
		});
	}

	/**
	 * Action: Accept ghost cell suggestion (clicks Accept and Run).
	 */
	async acceptGhostCellSuggestion(): Promise<void> {
		await test.step('Accept ghost cell suggestion', async () => {
			const acceptButton = this.code.driver.currentPage.locator('.ghost-cell-accept .split-button-main');
			await acceptButton.click();
		});
	}

	/**
	 * Action: Request a suggestion by clicking "Get Suggestion" button.
	 */
	async getSuggestion(): Promise<void> {
		await test.step('Request suggestion', async () => {
			await this.ghostCellGetSuggestion.click();
		});
	}

	// #endregion

	/**
	 * Get the current scroll position of the notebook cells container.
	 */
	async getScrollTop(): Promise<number> {
		return this.cellsContainer.evaluate(el => el.scrollTop);
	}

	/**
	 * Capture the scroll anchor: the first cell at least partially visible in
	 * the viewport, plus its top offset relative to the cells container.
	 *
	 * This is what the scroll restoration implementation preserves across
	 * reloads. Compare anchors (not raw scrollTop): cells above the anchor can
	 * re-render with slightly different heights between sessions, shifting
	 * scrollTop while leaving the user-visible position unchanged.
	 */
	async getScrollAnchor(): Promise<{ cellIndex: number; offsetFromTop: number } | null> {
		return this.cellsContainer.evaluate(c => {
			const containerRect = c.getBoundingClientRect();
			const cells = c.querySelectorAll('[data-testid="notebook-cell"]');
			for (let i = 0; i < cells.length; i++) {
				const r = cells[i].getBoundingClientRect();
				if (r.bottom > containerRect.top) {
					return { cellIndex: i, offsetFromTop: r.top - containerRect.top };
				}
			}
			return null;
		});
	}
	// #endregion
}

// -----------------
//    KernelBase
// -----------------

/**
 * Base class for kernel functionality shared between Kernel and ScopedKernel.
 * Contains common locators and methods for kernel actions.
 */
class KernelBase {
	statusBadge: Locator;
	restartButton: Locator;
	protected activeStatus: Locator;
	protected idleStatus: Locator;
	protected disconnectedStatus: Locator;

	constructor(
		statusBadge: Locator,
		editorActionBar: Locator,
		protected contextMenu: ContextMenu
	) {
		this.statusBadge = statusBadge;
		this.restartButton = editorActionBar.getByRole('button', { name: 'Restart Kernel', exact: true });
		this.activeStatus = editorActionBar.locator(ACTIVE_STATUS_ICON);
		this.idleStatus = editorActionBar.locator(IDLE_STATUS_ICON);
		this.disconnectedStatus = editorActionBar.locator(DISCONNECTED_STATUS_ICON);
	}

	/**
	 * Action: Restart the notebook kernel and optionally wait for it to be ready.
	 */
	async restart({ waitForRestart = true }: { waitForRestart?: boolean } = {}): Promise<void> {
		await test.step('Restart kernel', async () => {
			await this.restartButton.click();

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
			// The Shutdown Kernel menu item is gated on the
			// `notebookHasRunningInterpreter` context key, which only flips
			// true on `RuntimeState.Ready`. The runtime status icon can read
			// "idle" during a restart before `Ready` fires (intermediate
			// state while comms are being set up), so we cannot use the icon
			// as a readiness signal. Menu items also do not reactively
			// update once open, so we poll by re-opening the menu until the
			// item is enabled, then click.
			await this.waitForMenuItemEnabled('Shutdown Kernel');

			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: /Shutdown Kernel/
			});
			await this.expectStatusToBe('disconnected', 15000);
		});
	}

	/**
	 * Poll the kernel context menu until `menuItemLabel` is enabled.
	 *
	 * Context-menu items render their enabled state at open-time and do not
	 * update while open: if the underlying context key flips after the menu
	 * is shown, the rendered item stays stale until the menu is closed and
	 * reopened. Each polling iteration therefore opens the menu, checks the
	 * item, and closes it. The close runs in a `finally` so we don't
	 * accidentally keep the menu open (otherwise the next iteration's
	 * click would close the menu instead of open it).
	 */
	private async waitForMenuItemEnabled(menuItemLabel: string, timeout = 30000): Promise<void> {
		await expect(async () => {
			try {
				await this.contextMenu.triggerAndVerifyMenuItems({
					menuTrigger: this.statusBadge,
					menuItemStates: [{ label: menuItemLabel, enabled: true }],
				});
			} finally {
				await this.statusBadge.page().keyboard.press('Escape').catch(() => { });
			}
		}, `${menuItemLabel} menu item to be enabled`).toPass({ timeout });
	}

	/**
	 * Verify: Kernel status is as expected.
	 */
	async expectStatusToBe(expectedStatus: SessionState, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect kernel status to be: ${expectedStatus}`, async () => {
			const statusMap: Record<Exclude<SessionState, 'exited'>, Locator> = {
				active: this.activeStatus,
				idle: this.idleStatus,
				disconnected: this.disconnectedStatus
			};

			const locator = statusMap[expectedStatus];
			if (!locator) {
				throw new Error(`Unknown expected status: ${expectedStatus}`);
			}
			await expect(locator).toBeVisible({ timeout });
		});
	}

	/**
	 * Verify: Kernel badge contains expected text.
	 */
	async expectBadgeToContain(text: RegExp | string, timeout = DEFAULT_TIMEOUT): Promise<void> {
		await test.step(`Expect kernel badge to contain: ${text}`, async () => {
			await expect(this.statusBadge).toContainText(text, { timeout });
		});
	}

	/**
	 * Verify: Kernel status and badge text are as expected.
	 */
	async expectToBe(name: RegExp | string, options?: { status: SessionState; timeout?: number }): Promise<void> {
		const { status, timeout = DEFAULT_TIMEOUT } = options ?? {};
		if (status) {
			await this.expectStatusToBe(status, timeout);
		}
		await this.expectBadgeToContain(name, timeout);
	}
}

// -----------------
//     Kernel
// -----------------

/**
 * Full kernel functionality for single-notebook scenarios.
 * Extends KernelBase with additional page-level methods like select().
 */
export class Kernel extends KernelBase {
	constructor(
		private code: Code,
		private notebooks: PositronNotebooks,
		contextMenu: ContextMenu,
		private hotKeys: HotKeys,
		private quickinput: QuickInput
	) {
		super(
			code.driver.currentPage.getByRole('button', { name: 'Kernel Actions' }),
			notebooks.editorActionBar,
			contextMenu
		);
	}

	// #region ACTIONS

	/**
	 * Action: Change the kernel for the current notebook.
	 */
	async change(
		kernelGroup: 'Python' | 'R',
		{ version }: { version?: string } = {}
	): Promise<void> {
		const desiredKernel = version ?? (kernelGroup === 'Python'
			? process.env.POSITRON_PY_VER_SEL!
			: process.env.POSITRON_R_VER_SEL!);
		await test.step('Change kernel', async () => {
			await this.contextMenu.triggerAndClick({
				menuTrigger: this.statusBadge,
				menuItemLabel: /Change Kernel/
			});
			// select the kernel
			await this.quickinput.waitForQuickInputOpened({ timeout: 1000 });
			await this.quickinput.type(desiredKernel);
			await this.quickinput.selectQuickInputElementContaining(desiredKernel, {
				timeout: 1000,
				force: false,
				deprioritize: kernelGroup === 'Python' ? DEPRIORITIZED_PYTHON_SOURCES : undefined,
			});
			await this.quickinput.waitForQuickInputClosed();
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
			await this.quickinput.type(desiredKernel);
			await this.quickinput.selectQuickInputElementContaining(desiredKernel, {
				timeout: 1000,
				force: false,
				deprioritize: kernelGroup === 'Python' ? DEPRIORITIZED_PYTHON_SOURCES : undefined,
			});
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
				menuItemStates: menuItemStates,
				useNativeMenu: false
			});
		});
	}

	// #endregion

	/**
	 * Returns a scoped version of the Kernel for use with side-by-side notebooks.
	 * All locators and actions will be scoped to the provided container.
	 * @param container - A locator for the editor group container (e.g., `.editor-group-container`)
	 */
	scopedTo(container: Locator): ScopedKernel {
		const editorActionBar = container.locator('.editor-action-bar-container');
		const statusBadge = container.getByRole('button', { name: 'Kernel Actions' });
		return new ScopedKernel(statusBadge, editorActionBar, this.contextMenu);
	}
}

// -----------------
//   ScopedKernel
// -----------------

/**
 * A scoped version of Kernel for testing side-by-side notebooks.
 * Extends KernelBase - shares restart(), shutdown(), expectStatusToBe(), expectBadgeToContain().
 *
 * NOTE: For kernel selection, use the page-level `notebooksPositron.kernel.select()` while
 * only one notebook is visible (before splitting side-by-side).
 */
export class ScopedKernel extends KernelBase {
	constructor(
		statusBadge: Locator,
		editorActionBar: Locator,
		contextMenu: ContextMenu
	) {
		super(statusBadge, editorActionBar, contextMenu);
	}
}

// -----------------
//  ScopedNotebook
// -----------------

/**
 * A scoped version of PositronNotebooks for testing side-by-side notebooks.
 * Exposes locators scoped to the provided container (editor group).
 */
export class ScopedNotebook {
	/** All cells in this notebook */
	cells: Locator;
	/** The editor action bar for this notebook */
	editorActionBar: Locator;
	/** Scoped kernel helper for this notebook */
	kernel: ScopedKernel;

	// Editor action bar buttons
	runAllButton: Locator;
	addCodeButton: Locator;
	addMarkdownButton: Locator;
	clearOutputsButton: Locator;

	constructor(
		container: Locator,
		contextMenu: ContextMenu
	) {
		this.cells = container.locator('[data-testid="notebook-cell"]');
		this.editorActionBar = container.locator('.editor-action-bar-container');

		const statusBadge = container.getByRole('button', { name: 'Kernel Actions' });
		this.kernel = new ScopedKernel(statusBadge, this.editorActionBar, contextMenu);

		// Action bar buttons
		this.runAllButton = this.editorActionBar.getByRole('button', { name: 'Run All Cells' });
		this.addCodeButton = this.editorActionBar.getByRole('button', { name: 'Code' });
		this.addMarkdownButton = this.editorActionBar.getByRole('button', { name: 'Markdown' });
		this.clearOutputsButton = this.editorActionBar.getByRole('button', { name: 'Clear All Outputs' });
	}

	/** Get a specific cell by index */
	cell(index: number): Locator {
		return this.cells.nth(index);
	}

	/** Get cell output for a specific cell */
	cellOutput(index: number): Locator {
		return this.cell(index).getByTestId('cell-output');
	}

	/** Get the "Run Cell" button for a specific cell */
	runCellButton(index: number): Locator {
		return this.cell(index).getByRole('button', { name: 'Run Cell', exact: true });
	}
}
