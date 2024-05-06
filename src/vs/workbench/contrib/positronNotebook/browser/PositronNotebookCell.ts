/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ExecutionStatus, IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell, NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { CellSelectionType, SelectionState } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
import { disposableTimeout } from 'vs/base/common/async';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	kind!: CellKind;

	// Not marked as private so we can access it in subclasses
	readonly _disposableStore = new DisposableStore();

	private _container: HTMLElement | undefined;
	private _editor: CodeEditorWidget | undefined;

	selected = observableValue<boolean, void>('selected', false);
	editing: ISettableObservable<boolean> = observableValue<boolean, void>('editing', false);

	constructor(
		public cellModel: NotebookCellTextModel,
		public _instance: PositronNotebookInstance,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
	) {
		super();

		this._disposableStore.add(
			this._instance.selectionStateMachine.onNewState((state) => {

				if (state.type === SelectionState.NoSelection) {
					this.selected.set(false, undefined);
					this.editing.set(false, undefined);
					return;
				}

				if (state.type === SelectionState.EditingSelection) {
					const editingThisCell = state.selectedCell === this;
					this.selected.set(editingThisCell, undefined);
					this.editing.set(editingThisCell, undefined);
					return;
				}

				const cellIsSelected = state.selected.includes(this);
				this.selected.set(cellIsSelected, undefined);
				this.editing.set(false, undefined);
			}
			)
		);
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
		this._disposableStore.dispose();
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
		this._disposableStore.add(this.cellModel.onDidChangeContent(() => {
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



