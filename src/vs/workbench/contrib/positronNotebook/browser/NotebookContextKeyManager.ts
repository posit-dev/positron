/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';

/**
 * Manages context keys for a Positron notebook editor widget.
 */
export class NotebookContextKeyManager extends Disposable {
	private readonly editorFocused: IContextKey<boolean>;

	constructor(
		editorContainer: HTMLElement,
		private readonly notebookInstance: IPositronNotebookInstance,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this.editorFocused = NotebookContextKeys.editorFocused.bindTo(this.contextKeyService);

		// TODO: Once we complete moving over the IPositronNotebookEditor implementation
		//   to the widget, we'll pass the widget instead of the instance here.
		this._register(instantiationService.createInstance(NotebookEditorContextKeys, this.notebookInstance));

		const focusTracker = this._register(DOM.trackFocus(editorContainer));
		this._register(focusTracker.onDidFocus(() => {
			this.editorFocused.set(true);
		}));
		this._register(focusTracker.onDidBlur(() => {
			this.editorFocused.set(false);
		}));
	}

	public override dispose(): void {
		super.dispose();
		this.editorFocused.reset();
	}
}
