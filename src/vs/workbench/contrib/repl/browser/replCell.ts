/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IReplInputSubmitEvent, ReplInput } from 'vs/workbench/contrib/repl/browser/replInput';
import { ReplOutput } from 'vs/workbench/contrib/repl/browser/replOutput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { NotebookCellOutputsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';

export class ReplCell extends Disposable {

	readonly onDidSubmitInput: Event<IReplInputSubmitEvent>;

	private _container: HTMLElement;

	private _input: ReplInput;

	private _output: ReplOutput;

	private _handle: number;

	private static _counter: number = 0;

	constructor(
		private readonly _language: string,
		private readonly _parentElement: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		// Create unique handle
		this._handle = ReplCell._counter++;

		// Create host element
		this._container = document.createElement('div');
		this._container.classList.add('repl-cell');

		// Create output
		this._output = this._instantiationService.createInstance(
			ReplOutput,
			this._container);
		this._register(this._output);

		// Create input
		this._input = this._instantiationService.createInstance(
			ReplInput,
			this._handle,
			this._language,
			this._parentElement);
		this._register(this._input);

		// Copy the editor's font settings to the output area
		const fontInfo = this._input.getFontInfo();
		applyFontInfo(this._output.getDomNode(), fontInfo);

		// Event forwarding for input submission
		this.onDidSubmitInput = this._input.onDidSubmitInput;

		// Inject the input/output pair to the parent
		this._parentElement.appendChild(this._container);
	}

	/**
	 * Updates output in the cell
	 *
	 * @param splice The cell output updates
	 */
	changeOutput(splice: NotebookCellOutputsSplice) {
		for (const output of splice.newOutputs) {
			for (const o of output.outputs) {
				let output = '';
				let error = false;
				let isText = true;
				if (o.mime === 'text/html') {
					this._output.emitHtml(o.data.toString());
					isText = false;
				} else if (o.mime.startsWith('text')) {
					output = o.data.toString();
				} else if (o.mime === 'application/vnd.code.notebook.stdout') {
					output = o.data.toString();
				} else if (o.mime === 'application/vnd.code.notebook.stderr') {
					output = o.data.toString();
					error = true;
				} else if (o.mime === 'application/vnd.code.notebook.error') {
					this._output.emitError(o.data.toString());
					isText = false;
				} else {
					output = `Result type ${o.mime}`;
				}
				if (isText) {
					this._output.emitOutput(output, error);
				}
			}
		}
	}

	/**
	 * Forward focus the cell's input control
	 */
	focus() {
		this._input.focus();
	}
}
