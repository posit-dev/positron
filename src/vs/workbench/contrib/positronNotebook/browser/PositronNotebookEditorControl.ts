/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { autorun } from '../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { CellFindMatchWithIndex, IActiveNotebookEditor, IBaseCellEditorOptions, ICellOutputViewModel, ICellViewModel, IFocusNotebookCellOptions, IInsetRenderOutput, IModelDecorationsChangeAccessor, INotebookCellOverlayChangeAccessor, INotebookDeltaDecoration, INotebookEditor, INotebookEditorContribution, INotebookEditorMouseEvent, INotebookEditorOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent, INotebookViewModel, INotebookViewZoneChangeAccessor, INotebookWebviewMessage } from '../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { NotebookCellStateChangedEvent, NotebookLayoutInfo } from '../../notebook/browser/notebookViewEvents.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { INotebookFindOptions } from '../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../notebook/common/notebookKernelService.js';
import { ICellRange } from '../../notebook/common/notebookRange.js';
import { IWebviewElement } from '../../webview/browser/webview.js';
import { PositronNotebookInstance } from './PositronNotebookInstance.js';

/**
 * The PositronNotebookEditorControl is used by features like inline chat, debugging, and outlines
 * to access the code editor widget of the selected cell in a Positron notebook.
 *
 * TODO: Some notebook functionality (possibly debugging and outlines) require that the editor control
 * also have a `notebookEditor: INotebookEditor` property. We'll need to investigate what that unlocks,
 * whether to implement INotebookEditor, or find a different solution.
 */
export class PositronNotebookEditorControl extends Disposable implements INotebookEditor {
	//#region private properties
	/**
	 * The active cell's code editor.
	 */
	private _activeCodeEditor: ICodeEditor | undefined;

	/**
	 * The visible range of cells.
	 */
	private _visibleRanges: ICellRange[] = [];



	/**
	 * The scoped context key service.
	 */
	private _scopedContextKeyService: IContextKeyService = undefined!;

	/**
	 * The cell/code editor pairs.
	 */
	private _codeEditors: [ICellViewModel, ICodeEditor][] = [];

	/**
	 * The active cell and code editor pair.
	 */
	private _activeCellAndCodeEditor: [ICellViewModel, ICodeEditor] | undefined = undefined;
	//#endregion

	//#region Events
	private readonly _onDidChangeActiveEditor = this._register(new Emitter<this>());
	private readonly _onDidChangeCellState = this._register(new Emitter<NotebookCellStateChangedEvent>());
	private readonly _onDidChangeViewCells = this._register(new Emitter<INotebookViewCellsUpdateEvent>());
	private readonly _onDidChangeVisibleRanges = this._register(new Emitter<void>());
	private readonly _onDidChangeSelection = this._register(new Emitter<void>());
	private readonly _onDidChangeFocus = this._register(new Emitter<void>());
	private readonly _onDidChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());
	private readonly _onDidAttachViewModel = this._register(new Emitter<void>());
	private readonly _onDidFocusWidget = this._register(new Emitter<void>());
	private readonly _onDidBlurWidget = this._register(new Emitter<void>());
	private readonly _onDidScroll = this._register(new Emitter<void>());
	private readonly _onDidChangeLayout = this._register(new Emitter<void>());
	private readonly _onDidChangeActiveCell = this._register(new Emitter<void>());
	private readonly _onDidChangeActiveKernel = this._register(new Emitter<void>());
	private readonly _onMouseUp = this._register(new Emitter<INotebookEditorMouseEvent>());
	private readonly _onMouseDown = this._register(new Emitter<INotebookEditorMouseEvent>());
	private readonly _onDidReceiveMessage = this._register(new Emitter<INotebookWebviewMessage>());

	/**
	 * Event that fires when the active cell, and therefore the active code editor, changes.
	 */
	public readonly onDidChangeActiveEditor = this._onDidChangeActiveEditor.event;
	public readonly onDidChangeCellState = this._onDidChangeCellState.event;
	public readonly onDidChangeViewCells = this._onDidChangeViewCells.event;
	public readonly onDidChangeVisibleRanges = this._onDidChangeVisibleRanges.event;
	public readonly onDidChangeSelection = this._onDidChangeSelection.event;
	public readonly onDidChangeFocus = this._onDidChangeFocus.event;
	public readonly onDidChangeModel = this._onDidChangeModel.event;
	public readonly onDidAttachViewModel = this._onDidAttachViewModel.event;
	public readonly onDidFocusWidget = this._onDidFocusWidget.event;
	public readonly onDidBlurWidget = this._onDidBlurWidget.event;
	public readonly onDidScroll = this._onDidScroll.event;
	public readonly onDidChangeLayout = this._onDidChangeLayout.event;
	public readonly onDidChangeActiveCell = this._onDidChangeActiveCell.event;
	public readonly onDidChangeActiveKernel = this._onDidChangeActiveKernel.event;
	public readonly onMouseUp = this._onMouseUp.event;
	public readonly onMouseDown = this._onMouseDown.event;
	public readonly onDidReceiveMessage = this._onDidReceiveMessage.event;
	//#endregion

	constructor(
		private readonly _notebookInstance: PositronNotebookInstance,
	) {
		super();

		// TODO: Need to expose scopedContextKeyService from contextManager
		// this._scopedContextKeyService = this._notebookInstance.contextManager.scopedContextKeyService;

		// Update the active code editor when the notebook selection state changes.
		this._register(autorun(reader => {
			const selectionStateMachine = this._notebookInstance.selectionStateMachine;
			selectionStateMachine.state.read(reader);
			this._activeCodeEditor = selectionStateMachine.getSelectedCells()[0]?.editor;
			this._onDidChangeActiveEditor.fire(this);
		}));

		// Listen for model changes from the notebook instance
		this._register(this._notebookInstance.onDidChangeContent(() => {
			this._onDidChangeModel.fire(this._notebookInstance.textModel);
		}));
	}

	//#region readonly properties
	/**
	 * The visible range of cells.
	 */
	public get visibleRanges(): ICellRange[] {
		return this._visibleRanges;
	}

	/**
	 * The notebook text model.
	 */
	public get textModel(): NotebookTextModel | undefined {
		return this._notebookInstance.textModel;
	}

	/**
	 * Whether the notebook is visible.
	 */
	public get isVisible(): boolean {
		return this._notebookInstance.connectedToEditor;
	}

	/**
	 * Whether the notebook is read-only.
	 */
	public get isReadOnly(): boolean {
		return this._notebookInstance.isReadOnly;
	}

	/**
	 * The notebook options.
	 */
	public get notebookOptions(): NotebookOptions {
		return this._notebookInstance.notebookOptions;
	}

	/**
	 * Whether the notebook is disposed.
	 */
	public get isDisposed(): boolean {
		return this._notebookInstance.isDisposed;
	}

	/**
	 * The active kernel.
	 */
	public get activeKernel(): INotebookKernel | undefined {
		// TODO: Need to get kernel from notebook instance or kernel service
		return undefined;
	}

	/**
	 * The scoped context key service.
	 */
	public get scopedContextKeyService(): IContextKeyService {
		// TODO: Need to expose scopedContextKeyService from contextManager
		return this._scopedContextKeyService;
	}

	/**
	 * The scroll top position.
	 */
	public get scrollTop(): number {
		throw new Error('Method not implemented.');
	}

	/**
	 * The scroll bottom position.
	 */
	public get scrollBottom(): number {
		throw new Error('Method not implemented.');
	}

	/**
	 * The cell/code editor pairs.
	 */
	public get codeEditors(): [ICellViewModel, ICodeEditor][] {
		return this._codeEditors;
	}

	/**
	 * The active cell and code editor pair.
	 */
	public get activeCellAndCodeEditor(): [ICellViewModel, ICodeEditor] | undefined {
		return this._activeCellAndCodeEditor;
	}
	/**
	 * The active cell's code editor.
	 */
	public get activeCodeEditor(): ICodeEditor | undefined {
		// Required for Composite Editor check. The interface should not be changed.
		return this._activeCodeEditor;
	}
	getLength(): number {
		return this._notebookInstance.textModel?.cells.length ?? 0;
	}
	getSelections(): ICellRange[] {
		throw new Error('Method not implemented.');
	}
	setSelections(selections: ICellRange[]): void {
		throw new Error('Method not implemented.');
	}
	getFocus(): ICellRange {
		throw new Error('Method not implemented.');
	}
	setFocus(focus: ICellRange): void {
		throw new Error('Method not implemented.');
	}
	getId(): string {
		return this._notebookInstance.id;
	}
	getViewModel(): INotebookViewModel | undefined {
		throw new Error('Method not implemented.');
	}
	hasModel(): this is IActiveNotebookEditor {
		return this._notebookInstance.textModel !== undefined;
	}
	getDomNode(): HTMLElement {
		throw new Error('Method not implemented.');
	}
	getInnerWebview(): IWebviewElement | undefined {
		throw new Error('Method not implemented.');
	}
	getSelectionViewModels(): ICellViewModel[] {
		throw new Error('Method not implemented.');
	}
	getEditorViewState(): INotebookEditorViewState {
		return this._notebookInstance.getEditorViewState();
	}
	restoreListViewState(viewState: INotebookEditorViewState | undefined): void {
		throw new Error('Method not implemented.');
	}
	getBaseCellEditorOptions(language: string): IBaseCellEditorOptions {
		return this._notebookInstance.getBaseCellEditorOptions(language);
	}
	focus(): void {
		throw new Error('Method not implemented.');
	}
	focusContainer(clearSelection?: boolean): void {
		throw new Error('Method not implemented.');
	}
	hasEditorFocus(): boolean {
		throw new Error('Method not implemented.');
	}
	hasWebviewFocus(): boolean {
		throw new Error('Method not implemented.');
	}
	hasOutputTextSelection(): boolean {
		throw new Error('Method not implemented.');
	}
	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		return this._notebookInstance.setOptions(options);
	}
	focusElement(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}
	getLayoutInfo(): NotebookLayoutInfo {
		throw new Error('Method not implemented.');
	}
	getVisibleRangesPlusViewportAboveAndBelow(): ICellRange[] {
		throw new Error('Method not implemented.');
	}
	focusNotebookCell(cell: ICellViewModel, focus: 'editor' | 'container' | 'output', options?: IFocusNotebookCellOptions): Promise<void> {
		throw new Error('Method not implemented.');
	}
	async executeNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		// TODO: Need to convert ICellViewModel to IPositronNotebookCell
		// For now, run all cells if no specific cells provided
		if (!cells) {
			return this._notebookInstance.runAllCells();
		}
		// Need adapter to convert cells
		throw new Error('Cell conversion not yet implemented');
	}
	cancelNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		throw new Error('Method not implemented.');
	}
	getActiveCell(): ICellViewModel | undefined {
		throw new Error('Method not implemented.');
	}
	layoutNotebookCell(cell: ICellViewModel, height: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	createOutput(cell: ICellViewModel, output: IInsetRenderOutput, offset: number, createWhenIdle: boolean): Promise<void> {
		throw new Error('Method not implemented.');
	}
	updateOutput(cell: ICellViewModel, output: IInsetRenderOutput, offset: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	copyOutputImage(cellOutput: ICellOutputViewModel): Promise<void> {
		throw new Error('Method not implemented.');
	}
	selectOutputContent(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}
	selectInputContents(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}
	postMessage(message: any): void {
		throw new Error('Method not implemented.');
	}
	addClassName(className: string): void {
		throw new Error('Method not implemented.');
	}
	removeClassName(className: string): void {
		throw new Error('Method not implemented.');
	}
	setScrollTop(scrollTop: number): void {
		throw new Error('Method not implemented.');
	}
	revealCellRangeInView(range: ICellRange): void {
		throw new Error('Method not implemented.');
	}
	revealInView(cell: ICellViewModel): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealInViewAtTop(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}
	revealInCenter(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}
	revealInCenterIfOutsideViewport(cell: ICellViewModel): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealFirstLineIfOutsideViewport(cell: ICellViewModel): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealLineInViewAsync(cell: ICellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterAsync(cell: ICellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterIfOutsideViewportAsync(cell: ICellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealRangeInViewAsync(cell: ICellViewModel, range: Selection | Range): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenterAsync(cell: ICellViewModel, range: Selection | Range): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenterIfOutsideViewportAsync(cell: ICellViewModel, range: Selection | Range): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealCellOffsetInCenter(cell: ICellViewModel, offset: number): void {
		throw new Error('Method not implemented.');
	}
	revealOffsetInCenterIfOutsideViewport(offset: number): void {
		throw new Error('Method not implemented.');
	}
	getCellRangeFromViewRange(startIndex: number, endIndex: number): ICellRange | undefined {
		throw new Error('Method not implemented.');
	}
	setHiddenAreas(_ranges: ICellRange[]): boolean {
		throw new Error('Method not implemented.');
	}
	setCellEditorSelection(cell: ICellViewModel, selection: Range): void {
		throw new Error('Method not implemented.');
	}
	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[] {
		throw new Error('Method not implemented.');
	}
	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		throw new Error('Method not implemented.');
	}
	changeViewZones(callback: (accessor: INotebookViewZoneChangeAccessor) => void): void {
		throw new Error('Method not implemented.');
	}
	changeCellOverlays(callback: (accessor: INotebookCellOverlayChangeAccessor) => void): void {
		throw new Error('Method not implemented.');
	}
	getViewZoneLayoutInfo(id: string): { top: number; height: number } | null {
		throw new Error('Method not implemented.');
	}
	getContribution<T extends INotebookEditorContribution>(id: string): T {
		throw new Error('Method not implemented.');
	}
	getViewIndexByModelIndex(index: number): number {
		throw new Error('Method not implemented.');
	}
	getCellsInRange(range?: ICellRange): ReadonlyArray<ICellViewModel> {
		throw new Error('Method not implemented.');
	}
	cellAt(index: number): ICellViewModel | undefined {
		throw new Error('Method not implemented.');
	}
	getCellByHandle(handle: number): ICellViewModel | undefined {
		throw new Error('Method not implemented.');
	}
	getCellIndex(cell: ICellViewModel): number | undefined {
		throw new Error('Method not implemented.');
	}
	getNextVisibleCellIndex(index: number): number | undefined {
		throw new Error('Method not implemented.');
	}
	getPreviousVisibleCellIndex(index: number): number | undefined {
		throw new Error('Method not implemented.');
	}
	find(query: string, options: INotebookFindOptions, token: CancellationToken, skipWarmup?: boolean, shouldGetSearchPreviewInfo?: boolean, ownerID?: string): Promise<CellFindMatchWithIndex[]> {
		throw new Error('Method not implemented.');
	}
	findHighlightCurrent(matchIndex: number, ownerID?: string): Promise<number> {
		throw new Error('Method not implemented.');
	}
	findUnHighlightCurrent(matchIndex: number, ownerID?: string): Promise<void> {
		throw new Error('Method not implemented.');
	}
	findStop(ownerID?: string): void {
		throw new Error('Method not implemented.');
	}
	showProgress(): void {
		throw new Error('Method not implemented.');
	}
	hideProgress(): void {
		throw new Error('Method not implemented.');
	}
	getAbsoluteTopOfElement(cell: ICellViewModel): number {
		throw new Error('Method not implemented.');
	}
	getAbsoluteBottomOfElement(cell: ICellViewModel): number {
		throw new Error('Method not implemented.');
	}
	getHeightOfElement(cell: ICellViewModel): number {
		throw new Error('Method not implemented.');
	}
}
