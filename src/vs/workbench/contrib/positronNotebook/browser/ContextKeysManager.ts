/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IContextKey, IContextKeyService, IScopedContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';

/**
 * Context key that is set when the Positron notebook editor container is focused.
 */
export const POSITRON_NOTEBOOK_EDITOR_FOCUSED = new RawContextKey<boolean>('positronNotebookEditorFocused', false, localize('positronNotebookFocused', "Whether a Positron notebook editor or a notebook editor widget (e.g. a cell editor or the find widget) has focus"));

/**
 * Context key that is set when a cell editor (Monaco editor within a notebook cell) is focused.
 * This is more specific than EditorContextKeys.editorTextFocus which applies to ANY Monaco editor.
 */
export const POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED = new RawContextKey<boolean>('positronNotebookCellEditorFocused', false, localize('positronNotebookCellEditorFocused', "Whether a code editor within a Positron notebook cell is focused"));

// Cell state context keys
export const POSITRON_NOTEBOOK_CELL_IS_CODE = new RawContextKey<boolean>('positronNotebookCellIsCode', false);
export const POSITRON_NOTEBOOK_CELL_IS_MARKDOWN = new RawContextKey<boolean>('positronNotebookCellIsMarkdown', false);
/**
 * A cell of type 'raw' i.e. one that contains plain text without any rendered outputs or execution capabilities.
 */
export const POSITRON_NOTEBOOK_CELL_IS_RAW = new RawContextKey<boolean>('positronNotebookCellIsRaw', false);
export const POSITRON_NOTEBOOK_CELL_IS_RUNNING = new RawContextKey<boolean>('positronNotebookCellIsRunning', false);
export const POSITRON_NOTEBOOK_CELL_IS_PENDING = new RawContextKey<boolean>('positronNotebookCellIsPending', false);
export const POSITRON_NOTEBOOK_CELL_IS_FIRST = new RawContextKey<boolean>('positronNotebookCellIsFirst', false);
export const POSITRON_NOTEBOOK_CELL_IS_LAST = new RawContextKey<boolean>('positronNotebookCellIsLast', false);
export const POSITRON_NOTEBOOK_CELL_IS_ONLY = new RawContextKey<boolean>('positronNotebookCellIsOnly', false);
/**
 * Context key that is true when the markdown editor of a cell is open for editing.
 */
export const POSITRON_NOTEBOOK_CELL_MARKDOWN_EDITOR_OPEN = new RawContextKey<boolean>('positronNotebookCellMarkdownEditorOpen', false);
/**
 * Context key that is true when a cell is selected which is relevant for multi-cell selection scenarios.
 */
export const POSITRON_NOTEBOOK_CELL_IS_SELECTED = new RawContextKey<boolean>('positronNotebookCellIsSelected', false);
/**
 * Context key that is true when the cell is the active/focused cell. In multi-selection contexts,
 * only one cell is active. The active cell is the one that displays its action bar and where cell
 * level keyboard actions take effect.
 */
export const POSITRON_NOTEBOOK_CELL_IS_ACTIVE = new RawContextKey<boolean>('positronNotebookCellIsActive', false);

export const POSITRON_NOTEBOOK_CELL_CAN_MOVE_UP = new RawContextKey<boolean>('positronNotebookCellCanMoveUp', false);
export const POSITRON_NOTEBOOK_CELL_CAN_MOVE_DOWN = new RawContextKey<boolean>('positronNotebookCellCanMoveDown', false);

// All cell context keys in one place so we can easily operate on them all at once
export const POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS = {
	isCode: POSITRON_NOTEBOOK_CELL_IS_CODE,
	isMarkdown: POSITRON_NOTEBOOK_CELL_IS_MARKDOWN,
	isRaw: POSITRON_NOTEBOOK_CELL_IS_RAW,
	isRunning: POSITRON_NOTEBOOK_CELL_IS_RUNNING,
	isPending: POSITRON_NOTEBOOK_CELL_IS_PENDING,
	isFirst: POSITRON_NOTEBOOK_CELL_IS_FIRST,
	isLast: POSITRON_NOTEBOOK_CELL_IS_LAST,
	isOnly: POSITRON_NOTEBOOK_CELL_IS_ONLY,
	markdownEditorOpen: POSITRON_NOTEBOOK_CELL_MARKDOWN_EDITOR_OPEN,
	isSelected: POSITRON_NOTEBOOK_CELL_IS_SELECTED,
	isActive: POSITRON_NOTEBOOK_CELL_IS_ACTIVE,
	canMoveUp: POSITRON_NOTEBOOK_CELL_CAN_MOVE_UP,
	canMoveDown: POSITRON_NOTEBOOK_CELL_CAN_MOVE_DOWN,
} as const;

// Interface for the cell context keys
export type IPositronNotebookCellContextKeys = {
	readonly [K in keyof typeof POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS]: IContextKey<boolean>;
};


/**
 * Bind all cell context keys to a scoped context key service
 */
export function bindCellContextKeys(service: IScopedContextKeyService): IPositronNotebookCellContextKeys {
	return {
		isCode: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isCode.bindTo(service),
		isMarkdown: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isMarkdown.bindTo(service),
		isRaw: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isRaw.bindTo(service),
		isRunning: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isRunning.bindTo(service),
		isPending: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isPending.bindTo(service),
		isFirst: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isFirst.bindTo(service),
		isLast: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isLast.bindTo(service),
		isOnly: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isOnly.bindTo(service),
		markdownEditorOpen: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.markdownEditorOpen.bindTo(service),
		isSelected: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isSelected.bindTo(service),
		isActive: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isActive.bindTo(service),
		canMoveUp: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.canMoveUp.bindTo(service),
		canMoveDown: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.canMoveDown.bindTo(service),
	} satisfies IPositronNotebookCellContextKeys;
}


/**
 * Reset all cell context keys to their default values
 *
 * @param keys - The cell context keys object to reset, or undefined if not available
 */
export function resetCellContextKeys(keys: IPositronNotebookCellContextKeys | undefined): void {
	if (!keys) {
		return;
	}

	// Reset each context key to its default value in a type-safe manner
	Object.values(keys).forEach(contextKey => {
		contextKey.reset();
	});
}


/**
 * Class to handle context keys for positron notebook editor
 *
 * This class is responsible for setting up context keys for the positron notebook editor.
 * The context keys are made available for setting in appropriate places.
 */
export class PositronNotebookContextKeyManager extends Disposable {
	//#region Private Properties
	private _scopedInstantiationService?: IInstantiationService;
	private readonly _containerDisposables = this._register(new DisposableStore());
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _notebookInstance: IPositronNotebookInstance,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods
	setContainer(container: HTMLElement) {
		this._containerDisposables.clear();
		const disposables = this._containerDisposables;

		const { scopedContextKeyService } = this._notebookInstance;
		this._scopedInstantiationService = disposables.add(this._instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService])));

		const positronEditorFocus = POSITRON_NOTEBOOK_EDITOR_FOCUSED.bindTo(scopedContextKeyService);

		disposables.add(toDisposable(() => positronEditorFocus.reset()));

		// Create the manager for VSCode notebook editor context keys
		// Extensions may depend on these familiar context keys
		disposables.add(this._scopedInstantiationService.createInstance(NotebookEditorContextKeys, this._notebookInstance));

		const focusTracker = disposables.add(DOM.trackFocus(container));
		disposables.add(focusTracker.onDidFocus(() => {
			positronEditorFocus.set(true);
		}));

		disposables.add(focusTracker.onDidBlur(() => {
			positronEditorFocus.set(false);
		}));
	}

	//#endregion Public Methods
}
