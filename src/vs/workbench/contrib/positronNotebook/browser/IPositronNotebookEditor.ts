/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICellViewModel, INotebookEditor, INotebookViewModel } from '../../notebook/browser/notebookBrowser.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';

/**
 * @module IPositronNotebookEditor
 *
 * This module provides a solution for partially implementing INotebookEditor to benefit
 * from upstream VS Code features while maintaining Positron's notebook architecture.
 *
 * **Architectural Approach:**
 *
 * 1. **Feature-specific interfaces** - We define narrower interfaces per feature (e.g.,
 *    `IExtensionApiNotebookEditor` for extension API integration) that implement only the
 *    subset of INotebookEditor methods required for that feature.
 *
 * 2. **Type-safe compatibility** - Features depend on these narrower interfaces, ensuring
 *    compile-time verification that Positron implementations match upstream signatures.
 *
 * 3. **Interface unification** - We define a single union of all feature-specific interfaces
 *    (`IPositronNotebookEditor`) that combines their capabilities.
 *
 * 4. **Implementation inheritance** - Our main implementation interfaces (e.g.,
 *    `IPositronNotebookInstance`) extend the unified interface, gaining all feature support.
 *
 * @see INotebookEditorServiceProxy for the service-level integration
 */

//#region Extension API
/**
 * Extension API Integration
 *
 * Types and interfaces for integrating Positron notebooks with VS Code's extension API,
 * particularly the `vscode.NotebookEditor` API surface.
 */

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

//#region Decorations
export interface IDecorationsCellViewModel extends Pick<
	ICellViewModel,
	| 'deltaModelDecorations'
	| 'getCellDecorationRange'
> { }
//#endregion Decorations

//#region Context keys
/**
 * Context Key Management Integration
 *
 * Types and interfaces for managing VS Code context keys in notebook editors, enabling
 * conditional keybindings and UI behaviors based on notebook state.
 */

// Type aliases
export type ContextKeysNotebookViewCellsSplice = [
	number,
	number,
	IContextKeysCellViewModel[],
];

// Interfaces
/**
 * Minimal output view model for context key tracking.
 * Currently empty but defined for future extensibility and type compatibility.
 */
export interface IContextKeysCellOutputViewModel {
}

export interface IContextKeysCellViewModel extends Pick<
	ICellViewModel,
	| 'model'
> {
	outputsViewModels: IContextKeysCellOutputViewModel[];
}

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
	| 'scopedContextKeyService'
> {
	readonly onDidChangeViewCells: Event<IContextKeysNotebookViewCellsUpdateEvent>;
	hasModel(): this is IContextKeysActiveNotebookEditor;
}

export interface IContextKeysActiveNotebookEditor extends IContextKeysNotebookEditor {
	cellAt(index: number): IContextKeysCellViewModel;
	textModel: NotebookTextModel;
}
//#endregion Context keys

//#region Chat Editing
/**
 * Chat Editing Integration
 *
 * Types and interfaces for integrating Positron notebooks with VS Code's chat editing feature,
 * enabling AI-powered code modifications through the native diff view system.
 */

/**
 * The subset of INotebookEditor methods that Positron implements for chat editing.
 * Using Pick<INotebookEditor, ...> ensures compile-time verification that our
 * implementations match the upstream method signatures.
 */
type NotebookEditorChatEditingSubset = Pick<INotebookEditor,
	// Properties
	| 'textModel'
	| 'visibleRanges'
	| 'onDidChangeVisibleRanges'
	| 'isReadOnly'
	| 'isDisposed'
	// Cell access methods
	| 'getActiveCell'
	| 'getSelectionViewModels'
	| 'focusNotebookCell'
	| 'revealRangeInCenterAsync'
	// Decorator compatibility methods
	| 'deltaCellDecorations'
	| 'getCellsInRange'
	| 'getLayoutInfo'
	| 'getHeightOfElement'
	| 'getAbsoluteTopOfElement'
	| 'focusContainer'
	| 'revealOffsetInCenterIfOutsideViewport'
	| 'setFocus'
	| 'setSelections'
	| 'changeViewZones'
	| 'changeCellOverlays'
	// Options
	| 'setOptions'
	| 'getBaseCellEditorOptions'
>;

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
 * Extends NotebookEditorChatEditingSubset (Pick<INotebookEditor, ...>) for type-safe
 * compatibility with upstream INotebookEditor methods.
 *
 * Methods defined separately below have Positron-specific types that differ from INotebookEditor.
 */
export interface IChatEditingNotebookEditor extends NotebookEditorChatEditingSubset {
	/**
	 * Returns an array of [cell view model, code editor] tuples for cells with attached editors.
	 * Used by chat editing integration to attach diff views to cell editors.
	 *
	 * Note: Uses IChatEditingCellViewModel instead of ICellViewModel for Positron notebooks,
	 * which is why this is defined separately rather than included in the Pick<> type.
	 */
	codeEditors: [IChatEditingCellViewModel, ICodeEditor][];

	/**
	 * Get the view model for this notebook editor.
	 * For VS Code notebooks, returns a view model with viewCells.
	 * For Positron notebooks, returns a minimal view model without viewCells.
	 *
	 * Note: Return type differs from INotebookEditor (IChatEditingNotebookViewModel vs INotebookViewModel),
	 * which is why this is defined separately rather than included in the Pick<> type.
	 */
	getViewModel(): IChatEditingNotebookViewModel | undefined;

	/**
	 * Set the notebook's read-only state.
	 * For VS Code notebooks, use setOptions({ isReadOnly }) instead.
	 * For Positron notebooks, this is currently a no-op.
	 *
	 * Note: This is a Positron-specific addition not present in INotebookEditor.
	 */
	setReadOnly?(value: boolean): void;

	/**
	 * Find a cell view model by its handle.
	 * Returns undefined for Positron notebooks (no cell view models).
	 * For VS Code notebooks, use getViewModel().viewCells.find() instead.
	 *
	 * Note: This is a Positron-specific addition not present in INotebookEditor.
	 */
	getCellViewModelByHandle?(handle: number): ICellViewModel | undefined;

	/**
	 * Scoped context key service for toolbar/menu context.
	 * Required by decorators for creating scoped instantiation services.
	 *
	 * Note: Positron notebooks throw if accessed before attachView() is called,
	 * but by the time decorators are created, it should always be available.
	 */
	readonly scopedContextKeyService: IContextKeyService;
}
//#endregion Chat Editing

//#region Combined
/**
 * Unified Interface Definitions
 *
 * This section unifies the feature-specific interfaces defined above into cohesive types
 * that combine all required capabilities. These combined interfaces are what Positron
 * notebook implementations actually extend, providing full compatibility with all integrated
 * upstream VS Code features (Extension API, Context Keys, and Chat Editing).
 *
 * The unification follows the architectural pattern described at the top of this file:
 * multiple narrow feature interfaces → single unified interface → implementation inheritance.
 */

/**
 * Unified cell output view model combining all feature-specific output view model interfaces.
 */
export interface IPositronCellOutputViewModel extends IContextKeysCellOutputViewModel {
}

/**
 * Unified cell view model combining Extension API and Context Keys capabilities.
 * Includes output view models for complete cell representation.
 */
export interface IPositronCellViewModel extends IExtensionApiCellViewModel, IContextKeysCellViewModel, IDecorationsCellViewModel {
	outputsViewModels: IPositronCellOutputViewModel[];
}

/**
 * Unified active (with model) notebook editor interface.
 * Extends both Extension API and Context Keys active editor interfaces, ensuring the editor
 * is fully functional with a loaded notebook model and can participate in all feature integrations.
 */
export interface IPositronActiveNotebookEditor extends IExtensionApiActiveNotebookEditor, IContextKeysActiveNotebookEditor {
	cellAt(index: number): IPositronCellViewModel;
	hasModel(): this is IPositronActiveNotebookEditor;
}

/**
 * Main unified notebook editor interface combining all feature-specific interfaces.
 * This is the primary interface that Positron notebook implementations provide, enabling:
 * - Extension API integration (vscode.NotebookEditor)
 * - Context key management for conditional keybindings
 * - Chat editing with native diff views
 *
 * Implementations of this interface can be used interchangeably with INotebookEditor in
 * upstream VS Code features that depend on these specific subsets of functionality.
 */
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
