/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IBaseCellEditorOptions, ICellViewModel, INotebookCellOverlayChangeAccessor, INotebookDeltaDecoration, INotebookEditor, INotebookEditorOptions, INotebookViewModel, INotebookViewZoneChangeAccessor } from '../../notebook/browser/notebookBrowser.js';
import { NotebookLayoutInfo } from '../../notebook/browser/notebookViewEvents.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ICellRange } from '../../notebook/common/notebookRange.js';

/**
 * This module is our solution to partially implementing INotebookEditor
 * to benefit from upstream features, as required.
 *
 * The idea is as follows:
 *
 * 1. We define narrower interfaces per feature e.g. IExtensionApiNotebookEditor
 *    for integrating with the extension API.
 * 2. We update features to depend on our narrower interfaces e.g. IExtensionApiNotebookEditor
 *    as INotebookEditor.
 * 3. We define a single union of all per-feature interfaces e.g. IPositronNotebookEditor.
 * 4. Our main interfaces extend these union interfaces e.g. IPositronNotebookInstance
 *    extends IPositronNotebookEditor.
 *
 * See also INotebookEditorServiceProxy.
 */

//#region Extension API
export type IExtensionApiNotebookViewModel = Pick<INotebookViewModel, 'viewType'>;
export type IExtensionApiCellViewModel = Pick<ICellViewModel, 'handle'>;
export interface IExtensionApiNotebookEditor extends Pick<
	INotebookEditor,
	// Basic
	| 'getId'
	// Text model
	| 'textModel'
	| 'onDidChangeModel'
	// Selected cells: vscode.NotebookEditor.selections
	| 'getSelections'
	| 'setSelections'
	| 'onDidChangeSelection'
	// Visible cells: vscode.NotebookEditor.visibleRanges
	| 'visibleRanges'
	| 'onDidChangeVisibleRanges'
	// Cell structure: to retrieve a cell to be revealed and to ensure the revealed range is within the notebook length
	| 'getLength'
	// Reveal: to reveal a cell
	| 'revealCellRangeInView'
	// Focus
	| 'onDidFocusWidget'
> {
	hasModel(): this is IExtensionApiActiveNotebookEditor;
	cellAt(index: number): IExtensionApiCellViewModel | undefined;
	getViewModel(): IExtensionApiNotebookViewModel | undefined;
	revealInCenter(cell: IExtensionApiCellViewModel): void;
	revealInCenterIfOutsideViewport(cell: IExtensionApiCellViewModel): Promise<void>;
	revealInViewAtTop(cell: IExtensionApiCellViewModel): void;
}
export interface IExtensionApiActiveNotebookEditor extends IExtensionApiNotebookEditor {
	cellAt(index: number): IExtensionApiCellViewModel;
	textModel: NotebookTextModel;
	getViewModel(): IExtensionApiNotebookViewModel;
}
//#endregion Extension API

//#region Context keys
export interface IContextKeysCellOutputViewModel {
}
export interface IContextKeysCellViewModel extends Pick<
	ICellViewModel,
	| 'model'
> {
	outputsViewModels: IContextKeysCellOutputViewModel[];
}
export type ContextKeysNotebookViewCellsSplice = [
	number,
	number,
	IContextKeysCellViewModel[],
];
export interface IContextKeysNotebookViewCellsUpdateEvent {
	readonly splices: readonly ContextKeysNotebookViewCellsSplice[];
}
export interface IContextKeysNotebookEditor extends Pick<
	INotebookEditor,
	| 'onDidChangeModel'
	| 'textModel'
	| 'notebookOptions'
	| 'getDomNode'
	| 'getLength'
> {
	readonly onDidChangeViewCells: Event<IContextKeysNotebookViewCellsUpdateEvent>;
	hasModel(): this is IContextKeysActiveNotebookEditor;
	readonly scopedContextKeyService: IContextKeyService | undefined;
}
export interface IContextKeysActiveNotebookEditor extends IContextKeysNotebookEditor {
	cellAt(index: number): IContextKeysCellViewModel;
	textModel: NotebookTextModel;
}
//#endregion Context keys

//#region Chat Editing
/**
 * Minimal cell view model adapter for chat editing integration.
 * Only implements the `handle` property that the integration needs.
 */
export interface IChatEditingCellViewModel {
	handle: number;
}

/**
 * View model interface for chat editing integration.
 * Provides access to viewCells array for VS Code notebooks.
 * Extends IExtensionApiNotebookViewModel to maintain compatibility.
 * viewCells is optional because Positron notebooks don't have this property.
 */
export interface IChatEditingNotebookViewModel extends IExtensionApiNotebookViewModel {
	viewCells?: ICellViewModel[];
}

/**
 * Interface for chat editing notebook editor support.
 * Uses a minimal cell view model adapter instead of full ICellViewModel.
 * Extends IExtensionApiNotebookEditor to include common properties needed by chat editing.
 */
export interface IChatEditingNotebookEditor extends Pick<IExtensionApiNotebookEditor, 'textModel' | 'visibleRanges' | 'onDidChangeVisibleRanges'> {
	/**
	 * Returns an array of [cell view model, code editor] tuples for cells with attached editors.
	 * Used by chat editing integration to attach diff views to cell editors.
	 * Uses IChatEditingCellViewModel instead of ICellViewModel for Positron notebooks.
	 */
	codeEditors: [IChatEditingCellViewModel, ICodeEditor][];

	/**
	 * Whether the notebook is currently read-only.
	 * Optional because VS Code's INotebookEditor has this property.
	 */
	readonly isReadOnly?: boolean;

	/**
	 * Set the notebook's read-only state.
	 * For VS Code notebooks, use the utility function setNotebookEditorReadOnly which calls setOptions.
	 * For Positron notebooks, this is currently a no-op.
	 * Optional because VS Code's INotebookEditor uses setOptions({ isReadOnly }) instead.
	 * @param value - The read-only state to set.
	 */
	setReadOnly?(value: boolean): void;

	/**
	 * Find a cell view model by its handle.
	 * Returns undefined for Positron notebooks (no cell view models).
	 * Optional because VS Code's INotebookEditor uses getViewModel().viewCells instead.
	 * Use the utility function getNotebookCellViewModelByHandle for cross-platform support.
	 * @param handle - The handle of the cell to find.
	 * @returns The cell view model, or undefined if not found.
	 */
	getCellViewModelByHandle?(handle: number): ICellViewModel | undefined;

	/**
	 * Get the currently active cell, if any.
	 * Returns undefined for Positron notebooks which don't have this concept.
	 */
	getActiveCell(): ICellViewModel | undefined;

	/**
	 * Get the currently selected cell view models.
	 * Returns empty array for Positron notebooks which don't have this concept.
	 */
	getSelectionViewModels(): ICellViewModel[];

	/**
	 * Focus a notebook cell with the specified focus target.
	 * No-op for Positron notebooks.
	 */
	focusNotebookCell(
		cell: ICellViewModel,
		focus: 'editor' | 'container' | 'output',
		options?: { focusEditorLine?: number }
	): Promise<void>;

	/**
	 * Reveal a range in the center of the cell editor.
	 * No-op for Positron notebooks.
	 */
	revealRangeInCenterAsync(cell: ICellViewModel, range: Range): Promise<void>;

	/**
	 * Get the view model for this notebook editor.
	 * For VS Code notebooks, returns a view model with viewCells.
	 * For Positron notebooks, may return undefined or a minimal view model.
	 */
	getViewModel(): IChatEditingNotebookViewModel | undefined;

	// --- Decorator compatibility methods ---
	// These methods are needed by notebook decorators (NotebookDeletedCellDecorator,
	// NotebookInsertedCellDecorator, NotebookModifiedCellDecorator, OverlayToolbarDecorator).
	// For Positron notebooks, most return stub/no-op values since we have different UI architecture.

	/**
	 * Whether the notebook editor has been disposed.
	 * Used by decorators for cleanup checks.
	 */
	readonly isDisposed: boolean;

	/**
	 * Apply cell decorations to the notebook.
	 * For Positron notebooks, returns empty array (no-op).
	 * @param oldDecorations - Decoration IDs to remove
	 * @param newDecorations - New decorations to add
	 * @returns Array of decoration IDs
	 */
	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[];

	/**
	 * Get cells in a given range.
	 * For Positron notebooks, returns empty array (no ICellViewModel instances).
	 * @param range - The cell range to query
	 * @returns Array of cell view models
	 */
	getCellsInRange(range?: ICellRange): ReadonlyArray<ICellViewModel>;

	/**
	 * Get layout information for the notebook editor.
	 * For Positron notebooks, returns stub layout info.
	 */
	getLayoutInfo(): NotebookLayoutInfo;

	/**
	 * Get the height of a cell element.
	 * For Positron notebooks, returns 0 (stub).
	 * @param cell - The cell view model
	 * @returns Height in pixels
	 */
	getHeightOfElement(cell: ICellViewModel): number;

	/**
	 * Get the absolute top position of a cell element.
	 * For Positron notebooks, returns 0 (stub).
	 * @param cell - The cell view model
	 * @returns Top position in pixels
	 */
	getAbsoluteTopOfElement(cell: ICellViewModel): number;

	/**
	 * Focus the notebook container element.
	 * For Positron notebooks, no-op.
	 * @param clearSelection - Whether to clear selection
	 */
	focusContainer(clearSelection?: boolean): void;

	/**
	 * Reveal an offset position in the center of the viewport.
	 * For Positron notebooks, no-op.
	 * @param offset - The offset to reveal
	 */
	revealOffsetInCenterIfOutsideViewport(offset: number): void;

	/**
	 * Set the focus range in the notebook.
	 * For Positron notebooks, no-op.
	 * @param focus - The cell range to focus
	 */
	setFocus(focus: ICellRange): void;

	/**
	 * Modify view zones in the notebook.
	 * For Positron notebooks, no-op.
	 * @param callback - Callback to modify view zones
	 */
	changeViewZones(callback: (accessor: INotebookViewZoneChangeAccessor) => void): void;

	/**
	 * Modify cell overlays in the notebook.
	 * For Positron notebooks, no-op.
	 * @param callback - Callback to modify overlays
	 */
	changeCellOverlays(callback: (accessor: INotebookCellOverlayChangeAccessor) => void): void;

	/**
	 * Set notebook editor options including readonly state.
	 * For Positron notebooks, delegates to setReadOnly for isReadOnly option.
	 * @param options - The options to set
	 */
	setOptions(options: INotebookEditorOptions | undefined): Promise<void>;

	/**
	 * Get base cell editor options for a language.
	 * For Positron notebooks, returns stub options.
	 * @param language - The language ID
	 * @returns Base cell editor options
	 */
	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions;
}
//#endregion Chat Editing

//#region Combined
export interface IPositronCellOutputViewModel extends IContextKeysCellOutputViewModel {
}
export interface IPositronCellViewModel extends IExtensionApiCellViewModel, IContextKeysCellViewModel {
	outputsViewModels: IPositronCellOutputViewModel[];
}

export interface IPositronActiveNotebookEditor extends IExtensionApiActiveNotebookEditor, IContextKeysActiveNotebookEditor {
	cellAt(index: number): IPositronCellViewModel;
	hasModel(): this is IPositronActiveNotebookEditor;
}

export interface IPositronNotebookEditor extends IExtensionApiNotebookEditor, IContextKeysNotebookEditor, IChatEditingNotebookEditor {
	cellAt(index: number): IPositronCellViewModel | undefined;
	hasModel(): this is IPositronActiveNotebookEditor;
	/**
	 * Override getViewModel to satisfy both IExtensionApiNotebookEditor and IChatEditingNotebookEditor.
	 * Returns undefined for Positron notebooks since they don't have viewCells.
	 */
	getViewModel(): IChatEditingNotebookViewModel | undefined;
}
//#endregion Combined
