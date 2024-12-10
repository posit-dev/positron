/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ISettableObservable, observableValue } from '../../../../../base/common/observableInternal/base.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { ExecutionStatus, IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { CellSelectionType } from '../../../../services/positronNotebook/browser/selectionMachine.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';

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
		return this.cellModel.handle;
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



