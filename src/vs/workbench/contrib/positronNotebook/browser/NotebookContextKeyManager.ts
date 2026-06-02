/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { NotebookEditorContextKeys } from '../../notebook/browser/viewParts/notebookEditorWidgetContextKeys.js';
import { IPositronNotebookInstance } from './IPositronNotebookInstance.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Manages context keys for the Positron notebook editor.
 */
export class NotebookContextKeyManager extends Disposable {
	private readonly editorFocused: IContextKey<boolean>;

	constructor(
		parentContainer: HTMLElement,
		notebookInstance: IPositronNotebookInstance,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this.editorFocused = NotebookContextKeys.editorFocused.bindTo(contextKeyService);

		// Create the manager for VSCode notebook editor context keys
		// Extensions may depend on these familiar context keys
		this._register(instantiationService.createInstance(
			NotebookEditorContextKeys,
			notebookInstance
		));

		const focusTracker = this._register(DOM.trackFocus(parentContainer));
		this._register(focusTracker.onDidFocus(() => {
			this.editorFocused.set(true);
		}));

		this._register(focusTracker.onDidBlur(() => {
			this.editorFocused.set(false);
		}));
	}
}
