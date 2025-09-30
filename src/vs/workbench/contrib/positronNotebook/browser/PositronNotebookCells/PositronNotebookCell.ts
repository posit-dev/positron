/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell, CellSelectionStatus, ExecutionStatus } from './IPositronNotebookCell.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { CellSelectionType } from '../selectionMachine.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { derived, observableFromEvent, observableValue } from '../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../../common/editor/editorOptions.js';
import { ScrollType } from '../../../../../editor/common/editorCommon.js';
import { CellRevealType, INotebookEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { INotebookCellExecution, INotebookExecutionStateService, NotebookExecutionType } from '../../../notebook/common/notebookExecutionStateService.js';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	abstract readonly kind: CellKind;
	private _container: HTMLElement | undefined;
	private readonly _execution = observableValue<INotebookCellExecution | undefined, void>('cellExecution', undefined);
	protected readonly _editor = observableValue<ICodeEditor | undefined>('cellEditor', undefined);
	protected readonly _internalMetadata;
	private readonly _editorFocusRequested = observableValue<boolean>('editorFocusRequested', false);

	public readonly executionStatus;
	public readonly selectionStatus = observableValue<CellSelectionStatus, void>('cellSelectionStatus', CellSelectionStatus.Unselected);
	public readonly editorFocusRequested = this._editorFocusRequested;

	constructor(
		public readonly cellModel: NotebookCellTextModel,
		protected readonly _instance: PositronNotebookInstance,
		@INotebookExecutionStateService private readonly _executionStateService: INotebookExecutionStateService,
		@ITextModelService private readonly _textModelService: ITextModelService,
	) {
		super();

		// Observable of internal metadata to derive execution status and timing info
		// e.g. as used in PositronNotebookCodeCell
		this._internalMetadata = observableFromEvent(
			this,
			this.cellModel.onDidChangeInternalMetadata,
			() => /** @description internalMetadata */ this.cellModel.internalMetadata,
		);

		// Track this cell's current execution
		this._register(this._executionStateService.onDidChangeExecution(e => {
			if (e.type === NotebookExecutionType.cell && e.affectsCell(this.cellModel.uri)) {
				const execution = e.changed ?? this._executionStateService.getCellExecution(this.uri);
				this._execution.set(execution, undefined);
			}
		}));

		// Derive the execution status from the current execution and internal metadata
		this.executionStatus = derived(this, (reader): ExecutionStatus => {
			/** @description cellExecutionStatus */
			const execution = this._execution.read(reader);
			const { lastRunSuccess } = this._internalMetadata.read(reader);
			const state = execution?.state;
			if (!state) {
				// TODO: Should we have separate "success" and "error" states?
				return lastRunSuccess ? 'idle' : 'idle';
			}
			if (state === NotebookCellExecutionState.Pending || state === NotebookCellExecutionState.Unconfirmed) {
				return 'pending';
			} else if (state === NotebookCellExecutionState.Executing) {
				return 'running';
			} else {
				throw new Error(`Unknown execution state: ${state}`);
			}
		});
	}

	get index(): number {
		return this._instance.cells.get().indexOf(this);
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
		const modelRef = await this._textModelService.createModelReference(this.uri);
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

	isLastCell(): boolean {
		const cells = this._instance.cells.get();
		return this.index === cells.length - 1;
	}

	isOnlyCell(): boolean {
		const cells = this._instance.cells.get();
		return cells.length === 1;
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
		// TODO: We may want to support type, but couldn't find any issues without it
		if (this._container && this._instance.cellsContainer) {
			// If the cell is less than 50% visible, scroll it to center
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

	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		if (!options) {
			return;
		}

		// Scroll the cell into view
		this.reveal(options.cellRevealType);

		// Select the cell in edit mode
		this.select(CellSelectionType.Edit);

		// Apply any editor options
		await this.setEditorOptions(options.cellOptions?.options);
	}

	async setEditorOptions(options: ITextEditorOptions | undefined): Promise<void> {
		if (options) {
			const editor = await this.showEditor();
			if (editor && !(options.preserveFocus ?? true)) {
				// Request focus through the observable if preserveFocus is false
				this.requestEditorFocus();
			}
			if (editor) {
				applyTextEditorOptions(options, editor, ScrollType.Immediate);
			}
		}
	}

	focus(): void {
		if (this._container) {
			this._container.focus();
		}
	}

	requestEditorFocus(): void {
		this._editorFocusRequested.set(true, undefined);
		// Auto-reset after a short delay to make it a one-shot signal
		setTimeout(() => {
			this._editorFocusRequested.set(false, undefined);
		}, 100);
	}

	async showEditor(): Promise<ICodeEditor | undefined> {
		// Remove focus parameter and direct focus call
		// Focus will be managed by React through the editorFocusRequested observable
		return this._editor.get();
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



