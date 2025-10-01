/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { Mimes } from '../../../../../base/common/mime.js';
import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { IEditorCommentsOptions } from '../../../../../editor/common/config/editorOptions.js';
import { IPosition } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { ITextModel, IModelDeltaDecoration } from '../../../../../editor/common/model.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ICellViewModel, ICommonCellViewModelLayoutChangeInfo, INotebookCellDecorationOptions, CellLayoutState, IEditableCellViewModel, CellFocusMode, CodeCellLayoutInfo, ICellOutputViewModel, CellEditState } from '../../../notebook/browser/notebookBrowser.js';
import { CellViewModelStateChangeEvent, NotebookLayoutInfo } from '../../../notebook/browser/notebookViewEvents.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { INotebookCellStatusBarItem } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { IPositronNotebookCell } from '../PositronNotebookCells/IPositronNotebookCell.js';
import { PositronCellOutputViewModel } from './PositronCellOutputViewModel.js';

export class PositronNotebookCellViewModel extends Disposable implements ICellViewModel {
	//#region Events
	private readonly _onDidChangeLayout = this._register(new Emitter<ICommonCellViewModelLayoutChangeInfo>());
	private readonly _onDidChangeCellStatusBarItems = this._register(new Emitter<void>());
	private readonly _onCellDecorationsChanged = this._register(new Emitter<{ added: INotebookCellDecorationOptions[]; removed: INotebookCellDecorationOptions[] }>());
	private readonly _onDidChangeState = this._register(new Emitter<CellViewModelStateChangeEvent>());
	private readonly _onDidChangeEditorAttachState = this._register(new Emitter<void>());

	public readonly onDidChangeLayout = this._onDidChangeLayout.event;
	public readonly onDidChangeCellStatusBarItems = this._onDidChangeCellStatusBarItems.event;
	public readonly onCellDecorationsChanged = this._onCellDecorationsChanged.event;
	public readonly onDidChangeState = this._onDidChangeState.event;
	public readonly onDidChangeEditorAttachState = this._onDidChangeEditorAttachState.event;
	//#endregion
	public readonly id = generateUuid();

	/**
	 * Should be set by INotebookEditor.focusNotebookCell
	 */
	public focusedOutputId?: string | undefined;

	constructor(
		private readonly viewType: string,
		private readonly _cell: IPositronNotebookCell,
		private readonly _notebookInstance: IPositronNotebookInstance,
		private readonly _notebookLayoutInfo: ISettableObservable<NotebookLayoutInfo>,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();

		this._outputViewModels = this.model.outputs.map(output => new PositronCellOutputViewModel(this, output));

		const initialNotebookLayoutInfo = this._notebookLayoutInfo.get();
		this._layoutInfo = observableValue('cellLayoutInfo', {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorHeight: 0,
			editorWidth: initialNotebookLayoutInfo
				? this._notebookInstance.notebookOptions.computeCodeCellEditorWidth(initialNotebookLayoutInfo.width)
				: 0,
			chatHeight: 0,
			statusBarHeight: 0,
			commentOffset: 0,
			commentHeight: 0,
			outputContainerOffset: 0,
			outputTotalHeight: 0,
			outputShowMoreContainerHeight: 0,
			outputShowMoreContainerOffset: 0,
			totalHeight: this.computeTotalHeight(17, 0, 0, 0),
			codeIndicatorHeight: 0,
			outputIndicatorHeight: 0,
			bottomToolbarOffset: 0,
			layoutState: CellLayoutState.Uninitialized,
			estimatedHasHorizontalScrolling: false
		});

		this._commentOptions = this._configurationService.getValue<IEditorCommentsOptions>('editor.comments', { overrideIdentifier: this.language });
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.comments')) {
				this._commentOptions = this._configurationService.getValue<IEditorCommentsOptions>('editor.comments', { overrideIdentifier: this.language });
			}
		}));
	}
	get cellKind() {
		return this._cell.kind;
	}

	get model() {
		if (!(this._cell.cellModel instanceof NotebookCellTextModel)) {
			throw new Error(`Unexpected cell model type: ${typeof this._cell.cellModel}`);
		}
		return this._cell.cellModel;
	}

	//#region BaseCellViewModel
	get handle() {
		return this.model.handle;
	}

	get uri() {
		return this.model.uri;
	}

	// get lineCount() {
	// 	return this.model.textBuffer.getLineCount();
	// }
	get metadata() {
		return this.model.metadata;
	}

	get internalMetadata() {
		return this.model.internalMetadata;
	}

	get language() {
		return this.model.language;
	}

	get mime() {
		if (typeof this.model.mime === 'string') {
			return this.model.mime;
		}

		switch (this.language) {
			case 'markdown':
				return Mimes.markdown;

			default:
				return Mimes.text;
		}
	}

	get textBuffer() {
		return this.model.textBuffer;
	}

	get editorAttached(): boolean {
		return Boolean(this._cell.editor);
	}

	get textModel(): ITextModel | undefined {
		return this.model.textModel;
	}

	private _editStateSource: string = '';

	get editStateSource(): string {
		return this._editStateSource;
	}

	getText(): string {
		return this.model.getValue();
	}
	getAlternativeId(): number {
		return this.model.alternativeId;
	}
	getTextLength(): number {
		return this.model.getTextLength();
	}
	hasModel(): this is IEditableCellViewModel {
		return !!this.textModel;
	}
	getSelections(): Selection[] {
		// TODO: Check editor view state if no editor?
		return this._cell.editor?.getSelections() ?? [];
	}
	setSelections(selections: Selection[]): void {
		if (selections.length) {
			if (this._cell.editor) {
				this._cell.editor.setSelections(selections);
			}
			// TODO: Set in editor view state if no editor?
		}
	}
	getSelectionsStartPosition(): IPosition[] | undefined {
		if (this._cell.editor) {
			const selections = this._cell.editor.getSelections();
			return selections?.map(s => s.getStartPosition());
		}
		// TODO: Check editor view state if no editor?
		return undefined;
	}
	private _inputCollapsed: boolean = false;
	get isInputCollapsed(): boolean {
		return this._inputCollapsed;
	}
	set isInputCollapsed(v: boolean) {
		this._inputCollapsed = v;
		this._onDidChangeState.fire({ inputCollapsedChanged: true });
	}
	private _outputCollapsed: boolean = false;
	get isOutputCollapsed(): boolean {
		return this._outputCollapsed;
	}
	set isOutputCollapsed(v: boolean) {
		this._outputCollapsed = v;
		this._onDidChangeState.fire({ outputCollapsedChanged: true });
	}
	private _dragging: boolean = false;
	get dragging(): boolean {
		return this._dragging;
	}

	set dragging(v: boolean) {
		this._dragging = v;
		this._onDidChangeState.fire({ dragStateChanged: true });
	}
	private _lineNumbers: 'on' | 'off' | 'inherit' = 'inherit';
	get lineNumbers(): 'on' | 'off' | 'inherit' {
		return this._lineNumbers;
	}

	set lineNumbers(lineNumbers: 'on' | 'off' | 'inherit') {
		if (lineNumbers === this._lineNumbers) {
			return;
		}

		this._lineNumbers = lineNumbers;
		this._onDidChangeState.fire({ cellLineNumberChanged: true });
	}
	private _commentOptions: IEditorCommentsOptions;
	public get commentOptions(): IEditorCommentsOptions {
		return this._commentOptions;
	}

	public set commentOptions(newOptions: IEditorCommentsOptions) {
		this._commentOptions = newOptions;
	}
	private _focusMode: CellFocusMode = CellFocusMode.Container;
	get focusMode() {
		return this._focusMode;
	}
	set focusMode(newMode: CellFocusMode) {
		if (this._focusMode !== newMode) {
			this._focusMode = newMode;
			this._onDidChangeState.fire({ focusModeChanged: true });
		}
	}

	protected _commentHeight = 0;

	set commentHeight(height: number) {
		if (this._commentHeight === height) {
			return;
		}
		this._commentHeight = height;
		// this.layoutChange({ commentHeight: true }, 'BaseCellViewModel#commentHeight');
	}
	//#endregion
	//#region CodeCellViewModel
	private computeTotalHeight(editorHeight: number, outputsTotalHeight: number, outputShowMoreContainerHeight: number, chatHeight: number): number {
		const layoutConfiguration = this._notebookInstance.notebookOptions.getLayoutConfiguration();
		const { bottomToolbarGap } = this._notebookInstance.notebookOptions.computeBottomToolbarDimensions(this.viewType);
		return layoutConfiguration.editorToolbarHeight
			+ layoutConfiguration.cellTopMargin
			+ chatHeight
			+ editorHeight
			+ this._notebookInstance.notebookOptions.computeEditorStatusbarHeight(this.internalMetadata, this.uri)
			+ this._commentHeight
			+ outputsTotalHeight
			+ outputShowMoreContainerHeight
			+ bottomToolbarGap
			+ layoutConfiguration.cellBottomMargin;
	}
	private _chatHeight = 0;
	set chatHeight(height: number) {
		if (this._chatHeight === height) {
			return;
		}

		this._chatHeight = height;
		// this.layoutChange({ chatHeight: true }, 'CodeCellViewModel#chatHeight');
	}
	get chatHeight() {
		return this._chatHeight;
	}

	private _hoveringOutput: boolean = false;
	public get outputIsHovered(): boolean {
		return this._hoveringOutput;
	}

	public set outputIsHovered(v: boolean) {
		this._hoveringOutput = v;
		this._onDidChangeState.fire({ outputIsHoveredChanged: true });
	}

	private _focusOnOutput: boolean = false;
	public get outputIsFocused(): boolean {
		return this._focusOnOutput;
	}

	public set outputIsFocused(v: boolean) {
		this._focusOnOutput = v;
		this._onDidChangeState.fire({ outputIsFocusedChanged: true });
	}

	private _focusInputInOutput: boolean = false;
	public get inputInOutputIsFocused(): boolean {
		return this._focusInputInOutput;
	}

	public set inputInOutputIsFocused(v: boolean) {
		this._focusInputInOutput = v;
	}

	private _layoutInfo: ISettableObservable<CodeCellLayoutInfo>;

	get layoutInfo() {
		return this._layoutInfo.get();
	}

	private _outputViewModels: ICellOutputViewModel[];

	get outputsViewModels() {
		return this._outputViewModels;
	}
	//#endregion
	getHeight(lineHeight: number): number {
		throw new Error('Method not implemented.');
	}
	resolveTextModel(): Promise<ITextModel> {
		throw new Error('Method not implemented.');
	}
	getCellDecorations(): INotebookCellDecorationOptions[] {
		throw new Error('Method not implemented.');
	}
	getCellStatusBarItems(): INotebookCellStatusBarItem[] {
		throw new Error('Method not implemented.');
	}
	getEditState(): CellEditState {
		throw new Error('Method not implemented.');
	}
	updateEditState(state: CellEditState, source: string): void {
		throw new Error('Method not implemented.');
	}
	deltaModelDecorations(oldDecorations: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[] {
		throw new Error('Method not implemented.');
	}
	getCellDecorationRange(id: string): Range | null {
		throw new Error('Method not implemented.');
	}
	enableAutoLanguageDetection(): void {
		throw new Error('Method not implemented.');
	}
	getOutputOffset(index: number): number {
		throw new Error('Method not implemented.');
	}
	updateOutputHeight(index: number, height: number, source?: string): void {
		throw new Error('Method not implemented.');
	}
}
