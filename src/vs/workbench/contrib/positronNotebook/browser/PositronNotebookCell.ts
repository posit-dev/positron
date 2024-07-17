/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ExecutionStatus, IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell, NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { CellSelectionType } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
import { disposableTimeout } from 'vs/base/common/async';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	kind!: CellKind;


	private _container: HTMLElement | undefined;
	private _editor: CodeEditorWidget | undefined;

	constructor(
		public cellModel: NotebookCellTextModel,
		public _instance: PositronNotebookInstance,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
	) {
		super();
	}

	get uri(): URI {
		return this.cellModel.uri;
	}

	get notebookUri(): URI {
		return this._instance.uri;
	}

	get handleId(): number {

		const notebookViewModel = this._instance.viewModel;
		if (!notebookViewModel) {
			throw new Error('Notebook view model not found');
		}

		const viewCells = notebookViewModel.viewCells;

		const cell = viewCells.find(cell => cell.uri.toString() === this.cellModel.uri.toString());

		if (cell) {
			return cell.handle;
		}

		throw new Error('Cell view model not found');
	}

	getContent(): string {
		return this.cellModel.getValue();
	}

	async getTextEditorModel(): Promise<ITextModel> {
		const modelRef = await this.textModelResolverService.createModelReference(this.uri);
		return modelRef.object.textEditorModel;
	}

	delete(): void {
		this._instance.deleteCell(this);
	}

	// Add placeholder run method to be overridden by subclasses
	abstract run(): void;

	override dispose(): void {
		super.dispose();
	}

	isMarkdownCell(): this is IPositronNotebookMarkdownCell {
		return this.kind === CellKind.Markup;
	}

	isCodeCell(): this is IPositronNotebookCodeCell {
		return this.kind === CellKind.Code;
	}

	select(type: CellSelectionType): void {
		this._instance.selectionStateMachine.selectCell(this, type);
	}

	attachContainer(container: HTMLElement): void {
		this._container = container;
	}


	attachEditor(editor: CodeEditorWidget): void {
		this._editor = editor;
	}

	detachEditor(): void {
		this._editor = undefined;
	}

	focus(): void {
		if (this._container) {
			this._container.focus();
		}
	}

	focusEditor(): void {
		this._editor?.focus();
	}

	defocusEditor(): void {
		// Send focus to the enclosing cell itself to blur the editor
		this.focus();
	}

	deselect(): void {
		this._instance.selectionStateMachine.deselectCell(this);
	}
}


export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	outputs: ISettableObservable<NotebookCellOutputs[]>;
	executionStatus: ISettableObservable<ExecutionStatus> = observableValue<ExecutionStatus, void>('cellExecutionStatus', 'idle');

	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		textModelResolverService: ITextModelService,
	) {
		super(cellModel, instance, textModelResolverService);

		this.outputs = observableValue<NotebookCellOutputs[], void>('cellOutputs', this.cellModel.outputs);

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.cellModel.onDidChangeOutputs(() => {
				// By unpacking the array and repacking we make sure that
				// the React component will rerender when the outputs change. Probably not
				// great to have this leak here.
				this.outputs.set([...this.cellModel.outputs], undefined);
			})
		);
	}


	override run(): void {
		this._instance.runCells([this]);
	}
}


export class PositronNotebookMarkdownCell extends PositronNotebookCellGeneral implements IPositronNotebookMarkdownCell {

	markdownString: ISettableObservable<string | undefined> = observableValue<string | undefined, void>('markdownString', undefined);
	editorShown: ISettableObservable<boolean> = observableValue<boolean, void>('editorShown', false);
	override kind: CellKind.Markup = CellKind.Markup;


	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		textModelResolverService: ITextModelService,
	) {
		super(cellModel, instance, textModelResolverService);

		// Render the markdown content and update the observable when the cell content changes
		this._register(this.cellModel.onDidChangeContent(() => {
			this.markdownString.set(this.getContent(), undefined);
		}));

		this._updateContent();
	}

	private _updateContent(): void {
		this.markdownString.set(this.getContent(), undefined);
	}

	toggleEditor(): void {
		this.editorShown.set(!this.editorShown.get(), undefined);
	}

	override run(): void {
		this.toggleEditor();
	}

	override focusEditor(): void {
		this.editorShown.set(true, undefined);
		// Need a timeout here so that the editor is shown before we try to focus it.
		this._register(disposableTimeout(() => {
			super.focusEditor();
		}, 0));

	}
}

/**
 * Instantiate a notebook cell based on the cell's kind
 * @param cell Text model for the cell
 * @param instance The containing Positron notebook instance that this cell resides in.
 * @param instantiationService The instantiation service to use to create the cell
 * @returns The instantiated notebook cell of the correct type.
 */
export function createNotebookCell(cell: NotebookCellTextModel, instance: PositronNotebookInstance, instantiationService: IInstantiationService) {
	if (cell.cellKind === CellKind.Code) {
		return instantiationService.createInstance(PositronNotebookCodeCell, cell, instance);
	} else {
		return instantiationService.createInstance(PositronNotebookMarkdownCell, cell, instance);
	}
}


/**
 * Get the priority of a mime type for sorting purposes
 * @param mime The mime type to get the priority of
 * @returns A number representing the priority of the mime type. Lower numbers are higher priority.
 */
function getMimeTypePriority(mime: string): number {
	if (mime.includes('application')) {
		return 1;
	}

	switch (mime) {
		case 'text/html':
			return 2;
		case 'image/png':
			return 3;
		case 'text/plain':
			return 4;
		default:
			// Dont know what this is, so mark it as special so we know something went wrong
			return -1;
	}
}

/**
 * Pick the output with the highest priority mime type from a cell output object
 * @param outputs Array of outputs data from a cell output object
 * @returns The output data with the highest priority mime type. If there's a tie, the first one is
 * returned. If there's an unknown mime type, the first one is returned.
 */
export function pickPreferredOutput(outputs: NotebookCellOutputs['outputs']): NotebookCellOutputs['outputs'][number] | undefined {

	if (outputs.length === 0) {
		return undefined;
	}
	let preferredOutput = outputs[0];
	let highestPriorty = getMimeTypePriority(preferredOutput.mime);

	for (let i = 1; i < outputs.length; i++) {
		const output = outputs[i];
		const priority = getMimeTypePriority(output.mime);

		if (priority < highestPriorty) {
			preferredOutput = output;
			highestPriorty = priority;
		}
	}

	if (highestPriorty === -1) {
		// There is an output that we don't have a defined priority for, so just fall back
		// to returning the very first output.
		return outputs[0];
	}

	return preferredOutput;
}
