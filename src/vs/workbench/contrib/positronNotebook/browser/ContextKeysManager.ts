/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Manages context keys for a positron notebook editor view.
 *
 * Binds focus-tracking and VS Code notebook context keys to the view's
 * scoped context key service. The scoped services are passed explicitly
 * to `setContainer` so the manager doesn't depend on instance getter
 * timing (the view may not yet be assigned to the instance when this runs).
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
	/**
	 * Bind context keys to the given container using the provided scoped services.
	 */
	setContainer(
		container: HTMLElement,
		scopedContextKeyService: IContextKeyService,
		scopedInstantiationService: IInstantiationService,
	) {
		this._containerDisposables.clear();
		const disposables = this._containerDisposables;

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
