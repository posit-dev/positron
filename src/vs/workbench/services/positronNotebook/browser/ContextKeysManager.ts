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
export const POSITRON_NOTEBOOK_CELL_IS_RAW = new RawContextKey<boolean>('positronNotebookCellIsRaw', false);
export const POSITRON_NOTEBOOK_CELL_IS_RUNNING = new RawContextKey<boolean>('positronNotebookCellIsRunning', false);
export const POSITRON_NOTEBOOK_CELL_IS_PENDING = new RawContextKey<boolean>('positronNotebookCellIsPending', false);
export const POSITRON_NOTEBOOK_CELL_IS_FIRST = new RawContextKey<boolean>('positronNotebookCellIsFirst', false);
export const POSITRON_NOTEBOOK_CELL_IS_LAST = new RawContextKey<boolean>('positronNotebookCellIsLast', false);
export const POSITRON_NOTEBOOK_CELL_IS_ONLY = new RawContextKey<boolean>('positronNotebookCellIsOnly', false);
export const POSITRON_NOTEBOOK_CELL_MARKDOWN_EDITOR_OPEN = new RawContextKey<boolean>('positronNotebookCellMarkdownEditorOpen', false);
export const POSITRON_NOTEBOOK_CELL_IS_SELECTED = new RawContextKey<boolean>('positronNotebookCellIsSelected', false);
export const POSITRON_NOTEBOOK_CELL_IS_EDITING = new RawContextKey<boolean>('positronNotebookCellIsEditing', false);

// All cell context keys in one place so we can easily opperate on them all at once
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
} as const;

// Interface for the cell context keys
export type IPositronNotebookCellContextKeys = {
	readonly [K in keyof typeof POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS]: IContextKey<boolean>;
};


/**
 * Bind all cell context keys to a scoped context key service
 */
export function bindCellContextKeys(service: IScopedContextKeyService): IPositronNotebookCellContextKeys {
	const boundKeys: Partial<IPositronNotebookCellContextKeys> = {};

	for (const [key, rawKey] of Object.entries(POSITRON_NOTEBOOK_CELL_CONTEXT_KEYS)) {
		(boundKeys as any)[key] = rawKey.bindTo(service);
	}

	return boundKeys as IPositronNotebookCellContextKeys;
}


/**
 * Reset all cell context keys
 */
export function resetCellContextKeys(keys: IPositronNotebookCellContextKeys | undefined): void {
	if (!keys) {
		return;
	}
	for (const key of Object.keys(keys)) {
		(keys as any)[key].reset();
	}
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

	//#endregion Public Methods
}
