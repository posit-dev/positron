/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { NOTEBOOK_EDITOR_FOCUSED } from 'vs/workbench/contrib/notebook/common/notebookContextKeys';

/**
 * Context key that is set when the Positron notebook editor is focused. Used for rerouting
 * actions meant for vscode notebooks.
 */
export const POSITRON_NOTEBOOK_EDITOR_FOCUSED = new RawContextKey<boolean>('positronNotebookEditorFocused', false);

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
	editorFocus?: IContextKey<boolean>;
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

		this.positronEditorFocus = POSITRON_NOTEBOOK_EDITOR_FOCUSED.bindTo(this._scopedContextKeyService);
		this.editorFocus = NOTEBOOK_EDITOR_FOCUSED.bindTo(this._scopedContextKeyService);

		const focusTracker = this._register(DOM.trackFocus(container));
		this._register(focusTracker.onDidFocus(() => {
			this.positronEditorFocus?.set(true);
			this.editorFocus?.set(true);
		}));

		this._register(focusTracker.onDidBlur(() => {
			this.positronEditorFocus?.set(false);
			this.editorFocus?.set(false);
		}));
	}

	//#endregion Public Methods
}
