/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';

/**
	 * Context key that is set when the Positron notebook editor container is focused. This will _not_ be true when the user is editing a cell.
 */
export const POSITRON_NOTEBOOK_EDITOR_CONTAINER_FOCUSED = new RawContextKey<boolean>('positronNotebookEditorContainerFocused', false);

/**
 * Context key that is set when a cell editor (Monaco editor within a notebook cell) is focused.
 * This is more specific than EditorContextKeys.editorTextFocus which applies to ANY Monaco editor.
 */
export const POSITRON_NOTEBOOK_CELL_EDITOR_FOCUSED = new RawContextKey<boolean>('positronNotebookCellEditorFocused', false);

/**
 * Class to handle context keys for positron notebooks
 *
 * This class is responsible for setting up context keys for the positron notebook editor.
 * The context keys are made available for setting in appropriate places.
 */
export class PositronNotebookContextKeyManager extends Disposable {
	//#region Private Properties
	private _container?: HTMLElement;
	private _scopedContextKeyService?: IContextKeyService;
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
	setContainer(container: HTMLElement) {
		this._container = container;
		this._scopedContextKeyService = this._contextKeyService.createScoped(this._container);

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
