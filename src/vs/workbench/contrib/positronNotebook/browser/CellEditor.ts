/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../base/browser/dom.js';
import { IDisposable, Disposable } from '../../../../base/common/lifecycle.js';

export class CellEditor extends Disposable {
	/**
	 * The editor's DOM node. The editor owns its node (rather than React)
	 * so that it can be reparented to another React component.
	 */
	public readonly element: HTMLElement;

	constructor() {
		super();

		// Create the editor's DOM node.
		this.element = $('.positron-cell-editor-monaco-widget');
		this.element.className = 'positron-cell-editor-monaco-widget';
		this.element.tabIndex = -1;
	}

	/**
	 * Register a disposable to be disposed with the cell editor.
	 */
	register<T extends IDisposable>(disposable: T): T {
		return this._register(disposable);
	}
}
