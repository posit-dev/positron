/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from '../../../../editor/browser/editorBrowser.js';
import { IEditorContribution } from '../../../../editor/common/editorCommon.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuartoDocumentModelService } from './quartoDocumentModelService.js';
import { IQuartoExecutionManager } from '../common/quartoExecutionTypes.js';
import { QuartoCodeCell, IQuartoDocumentModel } from '../common/quartoTypes.js';
import { QuartoCellToolbar } from './quartoCellToolbar.js';
import { QUARTO_INLINE_OUTPUT_ENABLED, isQuartoDocument } from '../common/positronQuartoConfig.js';
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
	private readonly _updateToolbarsScheduler = this._register(new RunOnceScheduler(() => this._updateToolbars(), 100));
	private _quartoModel: IQuartoDocumentModel | undefined;
	private _currentCellIndex: number | undefined;
	private _mouseCellIndex: number | undefined;

	constructor(
		private readonly _editor: ICodeEditor,
		@IQuartoDocumentModelService private readonly _documentModelService: IQuartoDocumentModelService,
		@IQuartoExecutionManager private readonly _executionManager: IQuartoExecutionManager,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IHoverService private readonly _hoverService: IHoverService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// Listen for model changes
		this._register(this._editor.onDidChangeModel(() => {
			this._logService.debug('[QuartoCellToolbarController] Editor model changed');
			this._onEditorModelChanged();
		}));

		// Listen for context key changes (feature enabled/disabled)
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([QUARTO_INLINE_OUTPUT_ENABLED.key]))) {
				this._logService.debug('[QuartoCellToolbarController] Context key changed');
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
		this._updateToolbarsScheduler.cancel();
		this._disposables.clear();
		this._clearToolbars();
		this._quartoModel = undefined;
		this._currentCellIndex = undefined;
		this._mouseCellIndex = undefined;

		const model = this._editor.getModel();
		if (!model) {
			this._logService.debug('[QuartoCellToolbarController] No model found');
			return;
		}

		// Check if feature is enabled (context key checks both setting and extension installation)
		const enabled = this._contextKeyService.getContextKeyValue<boolean>(QUARTO_INLINE_OUTPUT_ENABLED.key) ?? false;
		if (!enabled) {
			return;
		}

		// Check if this is a Quarto or RMarkdown document (by extension or language ID)
		const uri = model.uri;
		const languageId = model.getLanguageId();
		this._logService.debug(`[QuartoCellToolbarController] File path: ${uri.path}, language: ${languageId}`);
		if (!isQuartoDocument(uri.path, languageId)) {
			this._logService.debug('[QuartoCellToolbarController] Not a Quarto/RMarkdown file, skipping');
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

		// Listen for content changes, update toolbar positions with a debounce
		this._disposables.add(this._quartoModel.onDidParse(() => {
			this._logService.debug('[QuartoCellToolbarController] Document parsed, scheduling toolbar update');
			this._updateToolbarsScheduler.schedule();
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
		this._updateToolbars();
	}

	/**
	 * Update the toolbars against the document's current cells, reusing
	 * existing toolbars wherever possible so editing does not flicker.
	 *
	 * Each current cell claims a prior toolbar by priority:
	 * - exact cell id (the cell is unchanged)
	 * - content hash (the cell moved but its content is identical, e.g. text inserted above)
	 * - cell index (the cell's content was edited in place, so both its id and hash changed)
	 *
	 * A claimed toolbar is updated to the cell's new position and re-keyed
	 * under its current id. Cells with no prior toolbar get a new one. Any
	 * toolbar left unclaimed belongs to a cell that no longer exists and is
	 * disposed.
	 */
	private _updateToolbars(): void {
		if (!this._quartoModel) {
			return;
		}

		const cells = this._quartoModel.cells;
		const totalCells = cells.length;

		const toolbars = new Set(this._toolbars.values());
		const byId = new Map<string, QuartoCellToolbar>();
		const byHash = new Map<string, QuartoCellToolbar>();
		const byIndex = new Map<number, QuartoCellToolbar>();

		// Index the existing toolbars so each current cell can find its prior
		// toolbar by id, content hash, or cell index
		for (const toolbar of toolbars) {
			byId.set(toolbar.cell.id, toolbar);
			// First writer wins. Duplicate hashes (identical cells) are rare and
			// any reuse is acceptable.
			if (!byHash.has(toolbar.cell.contentHash)) {
				byHash.set(toolbar.cell.contentHash, toolbar);
			}
			byIndex.set(toolbar.cell.index, toolbar);
		}

		this._toolbars.clear();

		for (const cell of cells) {
			const match = byId.get(cell.id) ?? byHash.get(cell.contentHash) ?? byIndex.get(cell.index);

			let toolbar: QuartoCellToolbar;
			if (match && toolbars.has(match)) {
				toolbars.delete(match);
				match.updateCell(cell, cell.index, totalCells);
				toolbar = match;
			} else {
				toolbar = new QuartoCellToolbar(
					this._editor,
					cell,
					cell.index,
					totalCells,
					// Use toolbar.cell instead of the captured cell so callbacks see
					// the current cell after later updateCell calls.
					() => this._runCell(toolbar.cell),
					() => this._cancelCell(toolbar.cell),
					() => this._stopCell(toolbar.cell),
					() => this._runCellsAboveFromToolbar(toolbar),
					() => this._runCellAndBelowFromToolbar(toolbar),
					this._hoverService,
					this._keybindingService
				);
				toolbar.setExecutionState(this._executionManager.getExecutionState(cell.id));
			}

			this._toolbars.set(cell.id, toolbar);
		}

		// Dispose toolbars whose cell no longer exists
		for (const toolbar of toolbars) {
			toolbar.dispose();
		}

		// The cell set or positions may have changed. Re-evaluate which toolbar
		// should be visible for the current cursor position.
		this._updateToolbarVisibilityForCursor();
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
		this._setCurrentCell(cell?.index);
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
		this._setMouseCell(cell?.index);
	}

	/**
	 * Set the cell the mouse is currently over and update toolbar visibility.
	 */
	private _setMouseCell(cellIndex: number | undefined): void {
		if (this._mouseCellIndex === cellIndex) {
			return;
		}

		// Hide previous mouse-hovered cell's toolbar (unless it's the cursor cell)
		if (this._mouseCellIndex !== undefined && this._mouseCellIndex !== this._currentCellIndex) {
			this._findToolbarByIndex(this._mouseCellIndex)?.setCursorInCell(false);
		}

		this._mouseCellIndex = cellIndex;

		// Show new mouse-hovered cell's toolbar and hide all others
		if (cellIndex !== undefined) {
			this._showToolbarExclusively(cellIndex);
		}
	}

	/**
	 * Set the current cell and update toolbar visibility.
	 */
	private _setCurrentCell(cellIndex: number | undefined): void {
		if (this._currentCellIndex === cellIndex) {
			return;
		}

		// Hide previous cell's toolbar. We always reset _isCursorInCell even
		// when the mouse is over the toolbar; _updateVisualVisibility will
		// keep it visible while hovered but hide it once the mouse leaves.
		if (this._currentCellIndex !== undefined && this._currentCellIndex !== this._mouseCellIndex) {
			this._findToolbarByIndex(this._currentCellIndex)?.setCursorInCell(false);
		}

		this._currentCellIndex = cellIndex;

		// Show new cell's toolbar and hide all others
		if (cellIndex !== undefined) {
			this._showToolbarExclusively(cellIndex);
		}
	}

	/**
	 * Show the toolbar for the cell at the given index and hide all others.
	 * This ensures only one toolbar is visible at a time.
	 *
	 * Note: We always call setCursorInCell(false) on non-target toolbars,
	 * even when the mouse is over them. The toolbar's _updateVisualVisibility
	 * will keep it visible while the mouse hovers, but once the mouse leaves,
	 * it will properly hide since _isCursorInCell is false.
	 */
	private _showToolbarExclusively(cellIndex: number): void {
		for (const toolbar of this._toolbars.values()) {
			toolbar.setCursorInCell(toolbar.cell.index === cellIndex);
		}
	}

	/**
	 * Find the toolbar for the cell at the given index, or `undefined` if none.
	 * Toolbars are keyed by cell id (which churns as content changes), so
	 * visibility lookups resolve by the stable cell index instead.
	 */
	private _findToolbarByIndex(cellIndex: number): QuartoCellToolbar | undefined {
		for (const toolbar of this._toolbars.values()) {
			if (toolbar.cell.index === cellIndex) {
				return toolbar;
			}
		}
		return undefined;
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
	 * Cancels a cell's previously pending execution.
	 * This is used when a cell is queued but hasn't started running yet.
	 * It removes the cell from the execution queue without interrupting
	 * any currently running cell.
	 */
	private async _cancelCell(cell: QuartoCodeCell): Promise<void> {
		const model = this._editor.getModel();
		if (!model) {
			return;
		}
		await this._executionManager.cancelQueuedCell(model.uri, cell.id);
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
