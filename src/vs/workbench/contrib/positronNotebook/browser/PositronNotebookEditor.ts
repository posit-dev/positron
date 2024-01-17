/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';

import { ISize } from 'vs/base/browser/positronReactRenderer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorOpenContext } from 'vs/workbench/common/editor';
import { PositronNotebookEditorInput } from './PositronNotebookEditorInput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { PositronNotebookWidget } from './PositronNotebookWidget';

/**
 * Observable value for the notebook editor.
 */
export type InputObservable = ISettableObservable<PositronNotebookEditorInput | undefined, void>;

export class PositronNotebookEditor
	extends EditorPane {
	_parentDiv: HTMLElement | undefined;

	/**
	 * Size as an observable so it can be lazily passed into the React component.
	 */
	private _size = observableValue<ISize>('size', { width: 0, height: 0 });

	/**
	 * Input as an observable so it can be lazily passed into the React component.
	 */
	private _inputObservable: InputObservable = observableValue('input', undefined);

	/**
	 * The main UI center of command for the notebooks.
	 * The logic for syncing react main UI and the outputs go here.
	 */
	private _notebookWidget: PositronNotebookWidget | undefined;

	protected override createEditor(parent: HTMLElement): void {
		const myDiv = parent.ownerDocument.createElement('div');
		this._parentDiv = myDiv;

		parent.appendChild(myDiv);

		this._notebookWidget = this._instantiationService.createInstance(PositronNotebookWidget, {
			message: 'Hello Positron!',
			size: this._size,
			input: this._inputObservable,
			baseElement: myDiv,
		});
	}

	override clearInput(): void {

		// Clear the input observable.
		this._inputObservable.set(undefined, undefined);

		// Call the base class's method.
		super.clearInput();
	}

	override layout(
		dimension: DOM.Dimension,
		position?: DOM.IDomPosition | undefined
	): void {

		if (!this._parentDiv) {
			return;
		}
		DOM.size(this._parentDiv, dimension.width, dimension.height);

		this._size.set(dimension, undefined);
	}


	override async setInput(
		input: PositronNotebookEditorInput,
		options: unknown | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
		noRetry?: boolean
	): Promise<void> {
		this._input = input;
		this._inputObservable.set(input, undefined);
		this._notebookWidget?.renderReact();
	}

	constructor(
		@IClipboardService readonly _clipboardService: IClipboardService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService
	) {
		// Call the base class's constructor.
		super(
			PositronNotebookEditorInput.EditorID,
			telemetryService,
			themeService,
			storageService
		);
	}

	/**
	 * dispose override method.
	 */
	public override dispose(): void {
		// Dispose of the notebook widget.
		this._notebookWidget?.dispose();

		// Call the base class's dispose method.
		super.dispose();
	}
}
