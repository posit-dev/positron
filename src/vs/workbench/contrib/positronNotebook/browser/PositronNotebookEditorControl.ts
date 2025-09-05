/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { autorun } from '../../../../base/common/observable.js';
import { Emitter, PauseableEmitter } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ICodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { Range } from '../../../../editor/common/core/range.js';
import { Selection } from '../../../../editor/common/core/selection.js';
import { TrackedRangeStickiness } from '../../../../editor/common/model.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IUndoRedoService } from '../../../../platform/undoRedo/common/undoRedo.js';
import { IInlineChatSessionService } from '../../inlineChat/browser/inlineChatSessionService.js';
import { CellFindMatchWithIndex, CellLayoutState, CodeCellLayoutChangeEvent, CodeCellLayoutInfo, IActiveNotebookEditor, IBaseCellEditorOptions, ICellOutputViewModel, ICellViewModel, IFocusNotebookCellOptions, IInsetRenderOutput, IModelDecorationsChangeAccessor, INotebookCellOverlayChangeAccessor, INotebookDeltaCellStatusBarItems, INotebookDeltaDecoration, INotebookDeltaViewZoneDecoration, INotebookEditor, INotebookEditorContribution, INotebookEditorMouseEvent, INotebookEditorOptions, INotebookEditorViewState, INotebookViewCellsUpdateEvent, INotebookViewModel, INotebookViewZoneChangeAccessor, INotebookWebviewMessage, MarkupCellLayoutChangeEvent } from '../../notebook/browser/notebookBrowser.js';
import { NotebookOptions } from '../../notebook/browser/notebookOptions.js';
import { NotebookCellStateChangedEvent, NotebookLayoutInfo } from '../../notebook/browser/notebookViewEvents.js';
import { INotebookEditorService } from '../../notebook/browser/services/notebookEditorService.js';
import { BaseCellViewModel } from '../../notebook/browser/viewModel/baseCellViewModel.js';
import { CellOutputViewModel } from '../../notebook/browser/viewModel/cellOutputViewModel.js';
import { NotebookEventDispatcher } from '../../notebook/browser/viewModel/eventDispatcher.js';
import { ViewContext } from '../../notebook/browser/viewModel/viewContext.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';
import { INotebookFindOptions } from '../../notebook/common/notebookCommon.js';
import { INotebookKernel } from '../../notebook/common/notebookKernelService.js';
import { ICellRange } from '../../notebook/common/notebookRange.js';
import { INotebookService } from '../../notebook/common/notebookService.js';
import { IWebviewElement } from '../../webview/browser/webview.js';
import { IPositronNotebookCell } from './PositronNotebookCells/IPositronNotebookCell.js';
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

	private readonly _viewModel = this._register(new MutableDisposable<PositronNotebookViewModel>());

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
		private readonly _notebookInstance: PositronNotebookInstance,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._notebookEditorService.addNotebookEditor(this);

		// Update the active code editor when the notebook selection state changes.
		this._register(autorun(reader => {
			const selectionStateMachine = this._notebookInstance.selectionStateMachine;
			selectionStateMachine.state.read(reader);
			this._activeCodeEditor = selectionStateMachine.getSelectedCells()[0]?.editor;
			this._onDidChangeActiveEditor.fire(this);
		}));
	}

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
		return this._activeCodeEditor;
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
		// TODO: Would be great if we could ensure textModel and therefore viewModel are always defined.
		// But need to rework some async handling that sets textModel in notebookInstance first.
		return this.getViewModel()?.getSelections() ?? [];
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
		if (this._notebookInstance.textModel && !this._viewModel.value) {
			// TODO: If the text model can change, we'll need to update the view model.
			this._viewModel.value = this._instantiationService.createInstance(PositronNotebookViewModel, this._notebookInstance, this._notebookInstance.textModel);
		}
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
		throw new Error('Method not implemented.');
		// const positronCells = this.toPositronCells(cells);
		// await this._notebookInstance.runCells(positronCells);
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
	//#endregion

	public override dispose(): void {
		this._notebookEditorService.removeNotebookEditor(this);

		super.dispose();
	}
}

class PositronNotebookViewModel extends Disposable implements INotebookViewModel {
	//#region Events
	private readonly _onDidChangeViewCells = this._register(new Emitter<INotebookViewCellsUpdateEvent>());
	private readonly _onDidChangeSelection = this._register(new Emitter<string>());
	private readonly onDidFoldingStateChangedEmitter = this._register(new Emitter<void>());

	public readonly onDidChangeViewCells = this._onDidChangeViewCells.event;
	public readonly onDidChangeSelection = this._onDidChangeSelection.event;
	public readonly onDidFoldingStateChanged = this.onDidFoldingStateChangedEmitter.event;
	//#endregion

	private _viewContext: ViewContext;
	private _viewCells: PositronNotebookCellViewModel[] = [];

	constructor(
		private readonly _notebookInstance: PositronNotebookInstance,
		private readonly _notebook: NotebookTextModel,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		const eventDispatcher = this._register(new NotebookEventDispatcher());
		this._viewContext = new ViewContext(
			this._notebookInstance.notebookOptions,
			eventDispatcher,
			language => this._notebookInstance.getBaseCellEditorOptions(language));

		for (const cell of this._notebookInstance.cells.get()) {
			const viewCell = this._instantiationService.createInstance(PositronNotebookCellViewModel, this._notebook.viewType, cell, this.layoutInfo, this._viewContext);
			this._viewCells.push(viewCell);
		}
	}

	get notebookDocument() {
		return this._notebook;
	}
	get viewCells(): ICellViewModel[] {
		return this._viewCells;
	}
	get layoutInfo(): NotebookLayoutInfo {
		throw new Error('Method not implemented.');
	}
	get viewType(): string {
		return this._notebook.viewType;
	}
	getNearestVisibleCellIndexUpwards(index: number): number {
		throw new Error('Method not implemented.');
	}
	getTrackedRange(id: string): ICellRange | null {
		throw new Error('Method not implemented.');
	}
	setTrackedRange(id: string | null, newRange: ICellRange | null, newStickiness: TrackedRangeStickiness): string | null {
		throw new Error('Method not implemented.');
	}
	getOverviewRulerDecorations(): INotebookDeltaViewZoneDecoration[] {
		throw new Error('Method not implemented.');
	}
	getSelections(): ICellRange[] {
		// TODO: Implement selections
		return [];
	}
	getCellIndex(cell: ICellViewModel): number {
		throw new Error('Method not implemented.');
	}
	getMostRecentlyExecutedCell(): ICellViewModel | undefined {
		throw new Error('Method not implemented.');
	}
	deltaCellStatusBarItems(oldItems: string[], newItems: INotebookDeltaCellStatusBarItems[]): string[] {
		throw new Error('Method not implemented.');
	}
	getFoldedLength(index: number): number {
		throw new Error('Method not implemented.');
	}
	getFoldingStartIndex(index: number): number {
		throw new Error('Method not implemented.');
	}
	replaceOne(cell: ICellViewModel, range: Range, text: string): Promise<void> {
		throw new Error('Method not implemented.');
	}
	replaceAll(matches: CellFindMatchWithIndex[], texts: string[]): Promise<void> {
		throw new Error('Method not implemented.');
	}
}

class PositronNotebookCellViewModel extends BaseCellViewModel implements ICellViewModel {
	// TODO: Needs to be codecell or markdown cell event?
	protected _pauseableEmitter = this._register(new PauseableEmitter<CodeCellLayoutChangeEvent | MarkupCellLayoutChangeEvent>());

	public readonly onDidChangeLayout = this._pauseableEmitter.event;

	public focusedOutputId?: string | undefined;

	constructor(
		viewType: string,
		private readonly _cell: IPositronNotebookCell,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		readonly viewContext: ViewContext,
		@IConfigurationService configurationService: IConfigurationService,
		@ITextModelService modelService: ITextModelService,
		@IUndoRedoService undoRedoService: IUndoRedoService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IInlineChatSessionService inlineChatSessionService: IInlineChatSessionService,
		@INotebookService private readonly _notebookService: INotebookService,
	) {
		super(
			viewType,
			_cell.cellModel,
			generateUuid(),
			viewContext,
			configurationService,
			modelService,
			undoRedoService,
			codeEditorService,
			inlineChatSessionService
		);

		this._outputViewModels = this.model.outputs.map(output => new CellOutputViewModel(this, output, this._notebookService));

		this._layoutInfo = {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorHeight: 0,
			editorWidth: initialNotebookLayoutInfo
				? this.viewContext.notebookOptions.computeCodeCellEditorWidth(initialNotebookLayoutInfo.width)
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
		};
	}

	//#region BaseCellViewModel
	get cellKind() {
		return this._cell.kind;
	}
	override onDeselect(): void {
		throw new Error('Method not implemented.');
	}
	override layoutChange(change: CodeCellLayoutChangeEvent | MarkupCellLayoutChangeEvent, source?: string): void {
		throw new Error('Method not implemented.');
	}
	protected override onDidChangeTextModelContent(): void {
		throw new Error('Method not implemented.');
	}
	//#endregion

	//#region CodeCellViewModel
	private computeTotalHeight(editorHeight: number, outputsTotalHeight: number, outputShowMoreContainerHeight: number, chatHeight: number): number {
		const layoutConfiguration = this.viewContext.notebookOptions.getLayoutConfiguration();
		const { bottomToolbarGap } = this.viewContext.notebookOptions.computeBottomToolbarDimensions(this.viewType);
		return layoutConfiguration.editorToolbarHeight
			+ layoutConfiguration.cellTopMargin
			+ chatHeight
			+ editorHeight
			+ this.viewContext.notebookOptions.computeEditorStatusbarHeight(this.internalMetadata, this.uri)
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
		this.layoutChange({ chatHeight: true }, 'CodeCellViewModel#chatHeight');
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

	private _layoutInfo: CodeCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	private _outputViewModels: ICellOutputViewModel[];

	get outputsViewModels() {
		return this._outputViewModels;
	}
	//#endregion
	getHeight(lineHeight: number): number {
		throw new Error('Method not implemented.');
	}
	getOutputOffset(index: number): number {
		throw new Error('Method not implemented.');
	}
	updateOutputHeight(index: number, height: number, source?: string): void {
		throw new Error('Method not implemented.');
	}
}
