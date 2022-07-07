/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {
	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement) {
		super();
	}

	render() {
		const h1 = document.createElement('h3');
		h1.innerText = this._kernel.label;
		this._parentElement.appendChild(h1);
	}

	override dispose() {
		super.dispose();
	}
}
