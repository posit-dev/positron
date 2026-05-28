/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Class to handle context keys for positron notebook editor
 *
 * This class is responsible for setting up context keys for the positron notebook editor.
 * The context keys are made available for setting in appropriate places.
 */
export class PositronNotebookContextKeyManager extends Disposable {
	//#region Private Properties
	private readonly _containerDisposables = this._register(new DisposableStore());
	//#endregion Private Properties

	//#region Constructor & Dispose
	constructor(
		private readonly _notebookInstance: IPositronNotebookInstance,
	) {
		super();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods
	setContainer(container: HTMLElement) {
		this._containerDisposables.clear();
		const disposables = this._containerDisposables;

		const { scopedContextKeyService, scopedInstantiationService } = this._notebookInstance;

		const positronEditorFocus = NotebookContextKeys.editorFocused.bindTo(scopedContextKeyService);

		disposables.add(toDisposable(() => positronEditorFocus.reset()));

		// Create the manager for VSCode notebook editor context keys
		// Extensions may depend on these familiar context keys
		disposables.add(scopedInstantiationService.createInstance(NotebookEditorContextKeys, this._notebookInstance));

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
