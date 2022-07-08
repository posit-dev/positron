/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorConstructionOptions } from 'vs/editor/browser/config/editorConfiguration';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

/**
 * The ReplInstanceView class is the view that hosts an individual REPL instance.
 */
export class ReplInstanceView extends Disposable {
	private _editor?: CodeEditorWidget;

	constructor(private readonly _kernel: INotebookKernel,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService readonly _instantiationService: IInstantiationService) {
		super();
	}

	render() {
		const h1 = document.createElement('h3');
		h1.innerText = this._kernel.label;
		this._parentElement.appendChild(h1);

		const ed = document.createElement('div');
		this._parentElement.appendChild(ed);

		const editorOptions = <IEditorConstructionOptions>{};

		const widgetOptions = <ICodeEditorWidgetOptions>{};

		this._editor = this._instantiationService.createInstance(
			CodeEditorWidget,
			ed,
			editorOptions,
			widgetOptions);

		this._register(this._editor);

		this._editor.layout();
	}
}
