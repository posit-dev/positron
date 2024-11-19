/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { ISettableObservable, observableValue } from 'vs/base/common/observableInternal/base';
import { URI } from 'vs/base/common/uri';
import { ITextModel } from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ExecutionStatus, IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditor/codeEditorWidget';
import { CellSelectionType } from 'vs/workbench/services/positronNotebook/browser/selectionMachine';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	kind!: CellKind;
	private _container: HTMLElement | undefined;
	private _editor: CodeEditorWidget | undefined;

	executionStatus: ISettableObservable<ExecutionStatus> = observableValue<ExecutionStatus, void>('cellExecutionStatus', 'idle');

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



