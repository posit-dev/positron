/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';
import { QuartoCodeCell, IQuartoDocumentModel, QuartoCellChangeEvent } from '../common/quartoTypes.js';
import { QuartoCellToolbar } from './quartoCellToolbar.js';
import { POSITRON_QUARTO_INLINE_OUTPUT_KEY } from '../common/positronQuartoConfig.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';

/**
 * Editor contribution that manages cell toolbars for Quarto documents.
 * Creates and manages toolbar widgets for each code cell, providing
 * Run Cell, Run Above, and Run Below actions.
 */
export class QuartoCellToolbarController extends Disposable implements IEditorContribution {
	static readonly ID = 'editor.contrib.quartoCellToolbarController';

	private readonly _toolbars = new Map<string, QuartoCellToolbar>();
	private readonly _disposables = this._register(new DisposableStore());
	private _quartoModel: IQuartoDocumentModel | undefined;
	private _currentCellId: string | undefined;
	private _mouseCellId: string | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._logService.info('[QuartoCellToolbarController] Constructor called');
		console.log('[QuartoCellToolbarController] Constructor called');

		// Listen for model changes
		this._register(this._editor.onDidChangeModel(() => {
			this._logService.debug('[QuartoCellToolbarController] Editor model changed');
			this._onEditorModelChanged();
		}));

		// Listen for configuration changes
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(POSITRON_QUARTO_INLINE_OUTPUT_KEY)) {
				this._logService.debug('[QuartoCellToolbarController] Configuration changed');
				this._onEditorModelChanged();
			}
		}));

		// Initial setup
		this._onEditorModelChanged();
	}

	/**
	 * Called when the editor model changes.
	 * Sets up or tears down toolbars based on whether this is a Quarto document.
	 */
	private _onEditorModelChanged(): void {
		this._logService.debug('[QuartoCellToolbarController] _onEditorModelChanged called');

		// Clean up previous toolbars
		this._disposables.clear();
		this._clearToolbars();
		this._quartoModel = undefined;
		this._currentCellId = undefined;
		this._mouseCellId = undefined;

		const model = this._editor.getModel();
		if (!model) {
			this._logService.debug('[QuartoCellToolbarController] No model found');
			return;
		}

		this._logService.debug(`[QuartoCellToolbarController] Model URI: ${model.uri.toString()}`);

		// Check if feature is enabled
		const enabled = this._configurationService.getValue<boolean>(POSITRON_QUARTO_INLINE_OUTPUT_KEY) ?? false;
		this._logService.info(`[QuartoCellToolbarController] Feature enabled: ${enabled}`);
		console.log(`[QuartoCellToolbarController] Feature enabled: ${enabled}`);
		if (!enabled) {
			console.log('[QuartoCellToolbarController] Feature not enabled, skipping toolbar setup');
			return;
		}

		// Check if this is a Quarto document
		const uri = model.uri;
		this._logService.debug(`[QuartoCellToolbarController] File path: ${uri.path}`);
		if (!uri.path.endsWith('.qmd')) {
			this._logService.debug('[QuartoCellToolbarController] Not a .qmd file, skipping');
			return;
		}

		this._logService.debug('[QuartoCellToolbarController] Detected Quarto document, setting up toolbars');

		// Get the Quarto document model
		this._quartoModel = this._documentModelService.getModel(model);
		this._logService.debug(`[QuartoCellToolbarController] Got Quarto model, cells: ${this._quartoModel.cells.length}`);

		// Listen for execution state changes
		this._disposables.add(this._executionManager.onDidChangeExecutionState((event) => {
			const toolbar = this._toolbars.get(event.execution.cellId);
			if (toolbar) {
				toolbar.setExecutionState(event.execution.state);
			}
		}));

		// Listen for cell changes in the document model
		this._disposables.add(this._quartoModel.onDidChangeCells((event) => {
			this._logService.debug('[QuartoCellToolbarController] Cells changed, updating toolbars incrementally');
			this._handleCellChanges(event);
			// Re-evaluate cursor position after cells change
			this._updateToolbarVisibilityForCursor();
		}));

		// Listen for cursor position changes
		this._disposables.add(this._editor.onDidChangeCursorPosition(() => {
			this._updateToolbarVisibilityForCursor();
		}));

		// Listen for mouse movements to show toolbar when mouse is in a cell
		this._disposables.add(this._editor.onMouseMove((e: IEditorMouseEvent) => {
			this._updateToolbarVisibilityForMouse(e);
		}));

		// Listen for mouse leaving the editor
		this._disposables.add(this._editor.onMouseLeave(() => {
			// Clear mouse-hovered cell when mouse leaves the editor
			this._setMouseCell(undefined);
		}));

		// Initial toolbar build
		this._rebuildToolbars();

		// Initial cursor position check
		this._updateToolbarVisibilityForCursor();
	}

	/**
	 * Rebuild all toolbars based on current document state.
	 */
	private _rebuildToolbars(): void {
		this._logService.debug('[QuartoCellToolbarController] _rebuildToolbars called');

		// Clear existing toolbars
		this._clearToolbars();

		const model = this._editor.getModel();
		if (!model) {
			this._logService.debug('[QuartoCellToolbarController] No model in _rebuildToolbars');
			return;
		}

		// Get the Quarto document model
		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;

		this._logService.info(`[QuartoCellToolbarController] Building toolbars for ${cells.length} cells`);
		console.log(`[QuartoCellToolbarController] Building toolbars for ${cells.length} cells`);

		// Create a toolbar for each cell
		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i];
			this._logService.debug(`[QuartoCellToolbarController] Creating toolbar for cell ${i}: id=${cell.id}, line=${cell.startLine}`);
			const toolbar = new QuartoCellToolbar(
				this._editor,
				cell,
				i,
				cells.length,
				// Use toolbar.cell instead of captured cell to get the current cell after updates
				() => this._runCell(toolbar.cell),
				() => this._stopCell(toolbar.cell),
				() => this._runCellsAboveFromToolbar(toolbar),
				() => this._runCellAndBelowFromToolbar(toolbar),
				this._hoverService,
				this._keybindingService
			);

			// Set initial execution state
			const state = this._executionManager.getExecutionState(cell.id);
			toolbar.setExecutionState(state);

			this._toolbars.set(cell.id, toolbar);
			this._logService.debug(`[QuartoCellToolbarController] Toolbar created and added for cell ${cell.id}`);
		}

		this._logService.debug(`[QuartoCellToolbarController] Total toolbars created: ${this._toolbars.size}`);
	}

	/**
	 * Handle incremental cell changes without destroying all toolbars.
	 * This prevents flickering when typing in cells.
	 */
	private _handleCellChanges(event: QuartoCellChangeEvent): void {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}

		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;
		const totalCells = cells.length;

		// Build index-based mappings for removed and added cells
		// This helps us match unlabeled cells that appear as removed+added when content changes
		const removedByIndex = new Map<number, string>();
		for (const removedId of event.removed) {
			const toolbar = this._toolbars.get(removedId);
			if (toolbar) {
				removedByIndex.set(toolbar.cell.index, removedId);
			}
		}

		const addedByIndex = new Map<number, QuartoCodeCell>();
		for (const addedCell of event.added) {
			addedByIndex.set(addedCell.index, addedCell);
		}

		// Track which removed cells were matched with added cells at the same index
		const matchedRemovedIds = new Set<string>();
		const matchedAddedIds = new Set<string>();

		// Match removed+added at same index (unlabeled cell content changes)
		for (const [index, removedId] of removedByIndex) {
			const addedCell = addedByIndex.get(index);
			if (addedCell) {
				const toolbar = this._toolbars.get(removedId);
				if (toolbar) {
					this._logService.debug(`[QuartoCellToolbarController] Reusing toolbar at index ${index}: ${removedId} -> ${addedCell.id}`);
					// Update the toolbar with new cell data instead of disposing it
					toolbar.updateCell(addedCell, addedCell.index, totalCells);
					// Re-map the toolbar under the new cell ID
					this._toolbars.delete(removedId);
					this._toolbars.set(addedCell.id, toolbar);
					matchedRemovedIds.add(removedId);
					matchedAddedIds.add(addedCell.id);
				}
			}
		}

		// Handle truly removed cells - dispose their toolbars
		for (const removedId of event.removed) {
			if (matchedRemovedIds.has(removedId)) {
				continue; // Already handled as a match with an added cell
			}
			const toolbar = this._toolbars.get(removedId);
			if (toolbar) {
				this._logService.debug(`[QuartoCellToolbarController] Disposing toolbar for removed cell ${removedId}`);
				toolbar.dispose();
				this._toolbars.delete(removedId);
			}
		}

		// Handle modified cells - update existing toolbars with new cell data
		// The modified map contains oldId -> newCell mapping
		for (const [oldId, newCell] of event.modified) {
			const toolbar = this._toolbars.get(oldId);
			if (toolbar) {
				this._logService.debug(`[QuartoCellToolbarController] Updating toolbar for modified cell ${oldId} -> ${newCell.id}`);
				// Update the toolbar with new cell data
				toolbar.updateCell(newCell, newCell.index, totalCells);
				// Re-map the toolbar under the new cell ID
				this._toolbars.delete(oldId);
				this._toolbars.set(newCell.id, toolbar);
			}
		}

		// Handle truly added cells - create new toolbars
		for (const addedCell of event.added) {
			if (matchedAddedIds.has(addedCell.id)) {
				continue; // Already handled as a match with a removed cell
			}
			if (!this._toolbars.has(addedCell.id)) {
				this._logService.debug(`[QuartoCellToolbarController] Creating toolbar for added cell ${addedCell.id}`);
				const toolbar = new QuartoCellToolbar(
					this._editor,
					addedCell,
					addedCell.index,
					totalCells,
					// Use toolbar.cell instead of captured cell to get the current cell after updates
					() => this._runCell(toolbar.cell),
					() => this._stopCell(toolbar.cell),
					() => this._runCellsAboveFromToolbar(toolbar),
					() => this._runCellAndBelowFromToolbar(toolbar),
					this._hoverService,
					this._keybindingService
				);

				// Set initial execution state
				const state = this._executionManager.getExecutionState(addedCell.id);
				toolbar.setExecutionState(state);

				this._toolbars.set(addedCell.id, toolbar);
			}
		}

		// Update cell positions for all existing toolbars that weren't modified
		// This ensures button visibility (run above/below) is correct after cells change
		for (const [id, toolbar] of this._toolbars) {
			const cell = quartoModel.getCellById(id);
			if (cell) {
				toolbar.updateCellPosition(cell.index, totalCells);
			}
		}
	}

	/**
	 * Clear all toolbars.
	 */
	private _clearToolbars(): void {
		for (const toolbar of this._toolbars.values()) {
			toolbar.dispose();
		}
		this._toolbars.clear();
	}

	/**
	 * Find the cell that contains the given line number.
	 */
	private _findCellAtLine(lineNumber: number): QuartoCodeCell | undefined {
		if (!this._quartoModel) {
			return undefined;
		}
		for (const cell of this._quartoModel.cells) {
			if (lineNumber >= cell.startLine && lineNumber <= cell.endLine) {
				return cell;
			}
		}
		return undefined;
	}

	/**
	 * Update toolbar visibility based on cursor position.
	 */
	private _updateToolbarVisibilityForCursor(): void {
		const position = this._editor.getPosition();
		if (!position) {
			this._setCurrentCell(undefined);
			return;
		}

		const cell = this._findCellAtLine(position.lineNumber);
		this._setCurrentCell(cell?.id);
	}

	/**
	 * Update toolbar visibility based on mouse position.
	 */
	private _updateToolbarVisibilityForMouse(e: IEditorMouseEvent): void {
		// Only handle content area mouse events
		if (e.target.type !== MouseTargetType.CONTENT_TEXT &&
			e.target.type !== MouseTargetType.CONTENT_EMPTY) {
			// Mouse is not over content, clear mouse cell
			this._setMouseCell(undefined);
			return;
		}

		const position = e.target.position;
		if (!position) {
			this._setMouseCell(undefined);
			return;
		}

		const cell = this._findCellAtLine(position.lineNumber);
		this._setMouseCell(cell?.id);
	}

	/**
	 * Set the cell the mouse is currently over and update toolbar visibility.
	 */
	private _setMouseCell(cellId: string | undefined): void {
		if (this._mouseCellId === cellId) {
			return;
		}

		// Hide previous mouse-hovered cell's toolbar (unless it's the cursor cell)
		if (this._mouseCellId && this._mouseCellId !== this._currentCellId) {
			const previousToolbar = this._toolbars.get(this._mouseCellId);
			if (previousToolbar) {
				previousToolbar.setCursorInCell(false);
			}
		}

		this._mouseCellId = cellId;

		// Show new mouse-hovered cell's toolbar and hide all others
		if (cellId) {
			this._showToolbarExclusively(cellId);
		}
	}

	/**
	 * Set the current cell and update toolbar visibility.
	 */
	private _setCurrentCell(cellId: string | undefined): void {
		if (this._currentCellId === cellId) {
			return;
		}

		// Hide previous cell's toolbar (unless mouse is over it)
		if (this._currentCellId && this._currentCellId !== this._mouseCellId) {
			const previousToolbar = this._toolbars.get(this._currentCellId);
			if (previousToolbar && !previousToolbar.isMouseOverToolbar) {
				previousToolbar.setCursorInCell(false);
			}
		}

		this._currentCellId = cellId;

		// Show new cell's toolbar and hide all others
		if (cellId) {
			this._showToolbarExclusively(cellId);
		}
	}

	/**
	 * Show the toolbar for the specified cell and hide all others.
	 * This ensures only one toolbar is visible at a time.
	 */
	private _showToolbarExclusively(cellId: string): void {
		for (const [id, toolbar] of this._toolbars) {
			if (id === cellId) {
				toolbar.setCursorInCell(true);
			} else if (!toolbar.isMouseOverToolbar) {
				// Hide all other toolbars (unless the mouse is directly over them)
				toolbar.setCursorInCell(false);
			}
		}
	}

	/**
	 * Execute a single cell.
	 */
	private async _runCell(cell: QuartoCodeCell): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		await this._executionManager.executeCell(model.uri, cell);
	}

	/**
	 * Stop execution for a cell.
	 */
	private async _stopCell(cell: QuartoCodeCell): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		await this._executionManager.cancelExecution(model.uri, cell.id);
	}

	/**
	 * Execute all cells above the toolbar's current cell.
	 * Gets fresh cell list from document model to handle cell changes.
	 */
	private async _runCellsAboveFromToolbar(toolbar: QuartoCellToolbar): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;
		const currentIndex = toolbar.cell.index;
		const cellsToRun = cells.slice(0, currentIndex);
		await this._executionManager.executeCells(model.uri, [...cellsToRun]);
	}

	/**
	 * Execute the toolbar's current cell and all cells below it.
	 * Gets fresh cell list from document model to handle cell changes.
	 */
	private async _runCellAndBelowFromToolbar(toolbar: QuartoCellToolbar): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		const quartoModel = this._documentModelService.getModel(model);
		const cells = quartoModel.cells;
		const currentIndex = toolbar.cell.index;
		const cellsToRun = cells.slice(currentIndex);
		await this._executionManager.executeCells(model.uri, [...cellsToRun]);
	}

	override dispose(): void {
		this._clearToolbars();
		super.dispose();
	}
}
