/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Manages context keys for a positron notebook editor view.
 *
 * Binds focus-tracking and VS Code notebook context keys to the view's
 * scoped context key service. Created via the scoped instantiation service
 * so it receives the pane-level CKS through DI.
 */
export class PositronNotebookContextKeyManager extends Disposable {

	constructor(
		editorContainer: HTMLElement,
		private readonly _notebookInstance: IPositronNotebookInstance,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		const positronEditorFocus = NotebookContextKeys.editorFocused.bindTo(contextKeyService);
		this._register(toDisposable(() => positronEditorFocus.reset()));

		this._register(instantiationService.createInstance(NotebookEditorContextKeys, this._notebookInstance));

		const focusTracker = this._register(DOM.trackFocus(editorContainer));
		this._register(focusTracker.onDidFocus(() => {
			positronEditorFocus.set(true);
		}));
		this._register(focusTracker.onDidBlur(() => {
			positronEditorFocus.set(false);
		}));
	}
}
