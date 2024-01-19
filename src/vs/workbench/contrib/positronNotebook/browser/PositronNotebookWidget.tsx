/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';
import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable } from 'vs/base/common/observableInternal/base';
import { InputObservable } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookEditor';
import { PositronNotebookComponent } from './PositronNotebookComponent';
import { INotebookEditorViewState } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';


export class PositronNotebookWidget extends Disposable {

	_baseElement: HTMLElement;
	_message: string;
	_size: ISettableObservable<ISize>;
	_input: InputObservable;

	/**
 * Keep track of if this editor has been disposed.
 */
	isDisposed: boolean = false;



	constructor(
		{ message, size, input, baseElement }: {
			message: string;
			size: ISettableObservable<ISize>;
			input: InputObservable;
			baseElement: HTMLElement;
		}
	) {
		super();

		this._message = message;
		this._size = size;
		this._input = input;
		this._baseElement = baseElement;
	}

	/**
	 * Gets or sets the PositronReactRenderer for the PositronNotebook component.
	 */
	private _positronReactRenderer?: PositronReactRenderer;


	/**
	 * Gets the PositronReactRenderer for the PositronNotebook component.
	 * Will create it if it doesn't exist.
	 */
	get positronReactRenderer() {
		if (this._positronReactRenderer) {
			return this._positronReactRenderer;
		}

		if (!this._baseElement) {
			throw new Error('Base element is not set.');
		}

		this._positronReactRenderer = new PositronReactRenderer(this._baseElement);

		return this._positronReactRenderer;
	}

	disposeReactRenderer() {
		this._positronReactRenderer?.dispose();
		this._positronReactRenderer = undefined;
	}

	renderReact() {
		this.positronReactRenderer.render(
			<PositronNotebookComponent
				message={this._message}
				size={this._size}
				input={this._input} />
		);
	}

	/**
	 * Gets the current state of the editor. This should
	 * fully determine the view we see.
	 */
	getEditorViewState(): INotebookEditorViewState {
		// TODO: Implement logic here.
		return {
			editingCells: {},
			cellLineNumberStates: {},
			editorViewStates: {},
			collapsedInputCells: {},
			collapsedOutputCells: {},
		};


	}

	override dispose() {
		super.dispose();
		this.disposeReactRenderer();
	}
}
