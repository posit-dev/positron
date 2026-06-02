/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { NotebookContextKeys } from '../common/notebookContextKeys.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';

/**
 * Manages context keys for the Positron notebook editor.
 */
export class NotebookContextKeyManager extends Disposable {
	private readonly editorFocused: IContextKey<boolean>;

	constructor(
		focusTracker: DOM.IFocusTracker,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this.editorFocused = NotebookContextKeys.editorFocused.bindTo(contextKeyService);

		this._register(focusTracker.onDidFocus(() => {
			this.editorFocused.set(true);
		}));

		this._register(focusTracker.onDidBlur(() => {
			this.editorFocused.set(false);
		}));
	}
}
