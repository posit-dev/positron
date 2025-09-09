/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as DOM from '../../../../../base/browser/dom.js';
import { PixelRatio } from '../../../../../base/browser/pixelRatio.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { FontMeasurements } from '../../../../../editor/browser/config/fontMeasurements.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { BareFontInfo, FontInfo } from '../../../../../editor/common/config/fontInfo.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { CellFindMatchWithIndex, IActiveNotebookEditor, IBaseCellEditorOptions, ICellOutputViewModel, ICellViewModel, IFocusNotebookCellOptions, IInsetRenderOutput, IModelDecorationsChangeAccessor, INotebookCellOverlayChangeAccessor, INotebookDeltaDecoration, INotebookEditor, INotebookEditorContribution, INotebookEditorMouseEvent, INotebookEditorOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent, INotebookViewModel, INotebookViewZoneChangeAccessor, INotebookWebviewMessage } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../../notebook/browser/notebookOptions.js';
import { NotebookCellStateChangedEvent, NotebookLayoutInfo } from '../../../notebook/browser/notebookViewEvents.js';
import { INotebookEditorService } from '../../../notebook/browser/services/notebookEditorService.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { INotebookFindOptions } from '../../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../../notebook/common/notebookKernelService.js';
import { ICellRange } from '../../../notebook/common/notebookRange.js';
import { IWebviewElement } from '../../../webview/browser/webview.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { PositronNotebookViewModel } from './PositronNotebookViewModel.js';

/**
 * The PositronNotebookEditorControl is used by features like inline chat, debugging, and outlines
 * to access the code editor widget of the selected cell in a Positron notebook.
 */
export class PositronNotebookEditorControl extends Disposable implements INotebookEditor {
	//#region private properties
	private _fontInfo: FontInfo | undefined;
	private _dimension?: DOM.Dimension;
	private _layoutInfo: ISettableObservable<NotebookLayoutInfo>;

	private readonly _viewModel = this._register(new MutableDisposable<PositronNotebookViewModel>());
	private readonly _viewModelDisposables = this._register(new DisposableStore());

	/**
	 * A unique identifier for this notebook editor control.
	 */
	private readonly _uuid = generateUuid();
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
		private readonly _notebookInstance: IPositronNotebookInstance,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		const editorOptions = this._configurationService.getValue<IEditorOptions>('editor');
		// TODO: Pass this dom node?
		const activeWindow = DOM.getActiveWindow();
		this._fontInfo = FontMeasurements.readFontInfo(activeWindow, BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.getInstance(activeWindow).value));
		this._layoutInfo = observableValue('layoutInfo', {
			width: this._dimension?.width ?? 0,
			height: this._dimension?.height ?? 0,
			scrollHeight: 0,
			// TODO: Implement this
			// scrollHeight: this._list?.getScrollHeight() ?? 0,
			fontInfo: this._fontInfo,
			stickyHeight: 0,
			// TODO: Implement this
			// stickyHeight: this._notebookStickyScroll?.getCurrentStickyHeight() ?? 0
			listViewOffsetTop: 0
		});

		this._notebookEditorService.addNotebookEditor(this);

		// Update the active code editor when the notebook selection state changes.
		const selectionStateMachine = this._notebookInstance.selectionStateMachine;
		this._register(autorun(reader => {
			selectionStateMachine.state.read(reader);
			this._onDidChangeActiveEditor.fire(this);
		}));
	}

	//#region Custom Public Methods
	// TODO: Would be great if we could ensure textModel and therefore viewModel are always defined.
	//       But need to rework some async handling that sets textModel in notebookInstance first.
	public setTextModel(textModel: NotebookTextModel | undefined): void {
		this._viewModelDisposables.clear();

		if (!textModel) {
			this._viewModel.clear();
			return;
		}

		const viewModel = this._instantiationService.createInstance(PositronNotebookViewModel, this._notebookInstance, textModel, this._layoutInfo);
		this._viewModel.value = viewModel;

		// Forward view model events.
		this._viewModelDisposables.add(viewModel.onDidChangeSelection(() => {
			this._onDidChangeSelection.fire();
		}));
	}

	//#endregion Custom Public Methods

	//#region readonly properties
	/**
	 * The visible range of cells.
	 */
	public get visibleRanges(): ICellRange[] {
		// TODO: Implement visible ranges
		return [];
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
		throw new Error('Method not implemented.');
	}

	/**
	 * The scoped context key service.
	 */
	public get scopedContextKeyService(): IContextKeyService {
		throw new Error('Method not implemented.');
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
		throw new Error('Method not implemented.');
	}

	/**
	 * The active cell and code editor pair.
	 */
	public get activeCellAndCodeEditor(): [ICellViewModel, ICodeEditor] | undefined {
		throw new Error('Method not implemented.');
	}
	/**
	 * The active cell's code editor.
	 */
	public get activeCodeEditor(): ICodeEditor | undefined {
		// Required for Composite Editor check. The interface should not be changed.
		const activeCell = this._notebookInstance.selectionStateMachine.getSelectedCells()[0];
		return activeCell?.editor;
	}

	//#region Private methods
	// private toPositronCells(cells?: Iterable<ICellViewModel>): IPositronNotebookCell[] {
	// 	const allPositronCells = this._notebookInstance.cells.get();
	// 	if (!cells) {
	// 		return allPositronCells;
	// 	}

	// 	const positronCells: IPositronNotebookCell[] = [];
	// 	for (const cell of cells) {
	// 		// TODO: Worth making a map of handleId to cell for performance?
	// 		const positronCell = allPositronCells.find(c => c.handleId === cell.handle);
	// 		if (!positronCell) {
	// 			throw new Error(`Cell with handleId ${cell.handle} not found in Positron notebook instance`);
	// 		}
	// 		positronCells.push(positronCell);
	// 	}
	// 	return positronCells;
	// }
	//#endregion

	//#region Public methods
	getLength(): number {
		return this._notebookInstance.cells.get().length;
	}
	getSelections(): ICellRange[] {
		return this._viewModel.value?.getSelections() ?? [];
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
		return this._uuid;
	}
	getViewModel(): INotebookViewModel | undefined {
		return this._viewModel.value;
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
	/**
	 * Gather info about editor layout such as width, height, and scroll behavior.
	 * @returns The current layout info for the editor.
	 */
	getLayoutInfo(): NotebookLayoutInfo {
		return this._layoutInfo.get();
	}
	getVisibleRangesPlusViewportAboveAndBelow(): ICellRange[] {
		throw new Error('Method not implemented.');
	}
	focusNotebookCell(cell: ICellViewModel, focus: 'editor' | 'container' | 'output', options?: IFocusNotebookCellOptions): Promise<void> {
		throw new Error('Method not implemented.');
	}
	async executeNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		throw new Error('Method not implemented.');
		// const positronCells = this.toPositronCells(cells);
		// await this._notebookInstance.runCells(positronCells);
	}
	cancelNotebookCells(cells?: Iterable<ICellViewModel>): Promise<void> {
		throw new Error('Method not implemented.');
	}
	getActiveCell(): ICellViewModel | undefined {
		if (this._viewModel.value) {
			const activeCell = this._notebookInstance.selectionStateMachine.getSelectedCells()[0];
			if (activeCell) {
				return this._viewModel.value.viewCells[activeCell.index];
			}
		}
		return undefined;
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
	//#endregion

	public override dispose(): void {
		this._notebookEditorService.removeNotebookEditor(this);

		super.dispose();
	}
}
