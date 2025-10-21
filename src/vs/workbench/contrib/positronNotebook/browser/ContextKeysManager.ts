/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService, IScopedContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Context key that is set when the Positron notebook editor container is focused. This will _not_ be true when the user is editing a cell.
 */
export const POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED = new RawContextKey<boolean>('positronNotebookEditorContainerFocused', false);

/**
 * Context key that is set when a cell editor (Monaco editor within a notebook cell) is focused.
 * This is more specific than EditorContextKeys.editorTextFocus which applies to ANY Monaco editor.
 */
export const POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED = new RawContextKey<boolean>('positronNotebookCellEditorFocused', false);

// Cell state context keys
export const POSITRON_NOTEBOOK_CELL_IS_CODE = new RawContextKey<boolean>('positronNotebookCellIsCode', false);
export const POSITRON_NOTEBOOK_CELL_IS_MARKDOWN = new RawContextKey<boolean>('positronNotebookCellIsMarkdown', false);
/**
 * A raw cell is one that contains plain text without any rendered outputs or execution capabilities.
 */
export const POSITRON_NOTEBOOK_CELL_IS_RAW = new RawContextKey<boolean>('positronNotebookCellIsRaw', false);
export const POSITRON_NOTEBOOK_CELL_IS_RUNNING = new RawContextKey<boolean>('positronNotebookCellIsRunning', false);
export const POSITRON_NOTEBOOK_CELL_IS_PENDING = new RawContextKey<boolean>('positronNotebookCellIsPending', false);
export const POSITRON_NOTEBOOK_CELL_IS_FIRST = new RawContextKey<boolean>('positronNotebookCellIsFirst', false);
export const POSITRON_NOTEBOOK_CELL_IS_LAST = new RawContextKey<boolean>('positronNotebookCellIsLast', false);
export const POSITRON_NOTEBOOK_CELL_IS_ONLY = new RawContextKey<boolean>('positronNotebookCellIsOnly', false);
/**
 * Context key that is true when the markdown editor of a cell is open for editing.
 * This does not necessarily mean the cell is focused, just that the editor is visible.
 */
export const POSITRON_NOTEBOOK_CELL_MARKDOWN_EDITOR_OPEN = new RawContextKey<boolean>('positronNotebookCellMarkdownEditorOpen', false);
/**
 * Context key that is true when the cell is selected (active for selection/navigation, but not necessarily being edited).
 * This is similar to "command mode" in Vim, allowing for cell navigation and selection without entering edit mode.
 * Relevant for multi-cell selection scenarios.
 */
export const POSITRON_NOTEBOOK_CELL_IS_SELECTED = new RawContextKey<boolean>('positronNotebookCellIsSelected', false);
/**
 * POSITRON_NOTEBOOK_CELL_IS_EDITING looks to be a duplicate of POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED.
 * The context key value is set but never actually read anywhere in the codebase. Consider removing it if it's not needed.
 */
export const POSITRON_NOTEBOOK_CELL_IS_EDITING = new RawContextKey<boolean>('positronNotebookCellIsEditing', false);
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
	isEditing: POSITRON_NOTEBOOK_CELL_IS_EDITING,
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
		isEditing: POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS.isEditing.bindTo(service),
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
	private _container?: HTMLElement;
	private _scopedContextKeyService?: IScopedContextKeyService;
	//#endregion Private Properties

	//#region Public Properties
	positronEditorFocus?: IContextKey<boolean>;
	//#endregion Public Properties

	//#region Constructor & Dispose
	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
	) {
		super();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods
	setContainer(container: HTMLElement, scopedContextKeyService?: IScopedContextKeyService) {
		this._container = container;
		this.positronEditorFocus?.reset();
		this._scopedContextKeyService = scopedContextKeyService ?? this._contextKeyService.createScoped(this._container);

		this.positronEditorFocus = POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED.bindTo(this._scopedContextKeyService);

		const focusTracker = this._register(DOM.trackFocus(container));
		this._register(focusTracker.onDidFocus(() => {
			this.positronEditorFocus?.set(true);
		}));

		this._register(focusTracker.onDidBlur(() => {
			this.positronEditorFocus?.set(false);
		}));
	}

	/**
	 * Gets the scoped context key service for this notebook editor.
	 * This is the context service that has access to notebook-specific context keys.
	 * @returns The scoped context key service, or undefined if no container has been set
	 */
	getScopedContextKeyService(): IContextKeyService | undefined {
		return this._scopedContextKeyService;
	}

	/**
	 * Manually set the container focused state.
	 * This is needed because DOM.trackFocus doesn't fire blur events when a child element
	 * (like a Monaco editor) gets focus. We need to manually coordinate this with the
	 * cell editing state to ensure the context key is accurate.
	 * @param focused - Whether the container should be considered focused
	 */
	setContainerFocused(focused: boolean): void {
		this.positronEditorFocus?.set(focused);
	}

	//#endregion Public Methods
}
