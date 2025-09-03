/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { ExecutionStatus, IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { CellSelectionType } from '../../../../services/positronNotebook/browser/selectionMachine.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../../common/editor/editorOptions.js';
import { ScrollType } from '../../../../../editor/common/editorCommon.js';
import { CellRevealType, INotebookEditorOptions } from '../../../notebook/browser/notebookBrowser.js';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	kind!: CellKind;
	private _container: HTMLElement | undefined;
	protected _editor = observableValue<ICodeEditor | undefined, void>('cellEditor', undefined);

	executionStatus = observableValue<ExecutionStatus, void>('cellExecutionStatus', 'idle');

	constructor(
		public cellModel: NotebookCellTextModel,
		public _instance: PositronNotebookInstance,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
	) {
		super();
	}

	get editor(): ICodeEditor | undefined {
		return this._editor.get();
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
		this._editor.set(editor, undefined);
	}

	detachEditor(): void {
		this._editor.set(undefined, undefined);
	}

	reveal(type?: CellRevealType): void {
		// TODO: Support type?
		if (this._container && this._instance.cellsContainer) {
			// TODO: Extract helper. is there one already?
			const rect = this._container.getBoundingClientRect();
			const parentRect = this._instance.cellsContainer.getBoundingClientRect();
			const visibleTop = Math.max(parentRect.top, rect.top);
			const visibleBottom = Math.min(parentRect.bottom, rect.bottom);
			const visibleHeight = Math.max(0, visibleBottom - visibleTop);
			const visibilityRatio = visibleHeight / rect.height;
			if (visibilityRatio < 0.5) {
				this._container.scrollIntoView({ behavior: 'instant', block: 'center' });
			}
		}
	}

	async setOptions(options: INotebookEditorOptions): Promise<void> {
		// Scroll the cell into view.
		this.reveal(options.cellRevealType);

		// Select the cell in edit mode.
		this.select(CellSelectionType.Edit);

		const editorOptions = options.cellOptions?.options;
		if (editorOptions) {
			this.setEditorOptions(editorOptions);
		}
	}

	async setEditorOptions(options: ITextEditorOptions): Promise<void> {
		const editor = await this.showEditor(!options.preserveFocus);
		if (editor) {
			applyTextEditorOptions(options, editor, ScrollType.Immediate);
		}
	}

	focus(): void {
		if (this._container) {
			this._container.focus();
		}
	}

	async showEditor(focus = false): Promise<ICodeEditor | undefined> {
		const editor = this._editor.get();
		if (editor && focus) {
			editor.focus();
		}
		return editor;
	}

	defocusEditor(): void {
		// Send focus to the enclosing cell itself to blur the editor
		this.focus();
	}

	deselect(): void {
		this._instance.selectionStateMachine.deselectCell(this);
	}

	insertCodeCellAbove(): void {
		this._instance.insertCodeCellAndFocusContainer('above', this);
	}

	insertCodeCellBelow(): void {
		this._instance.insertCodeCellAndFocusContainer('below', this);
	}

}



