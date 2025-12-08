/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../../base/common/async.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, IReference } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookCodeCell, IPositronNotebookCell, IPositronNotebookMarkdownCell, CellSelectionStatus, ExecutionStatus } from './IPositronNotebookCell.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { CellSelectionType } from '../selectionMachine.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { derived, IObservableSignal, observableFromEvent, observableSignal, observableValue } from '../../../../../base/common/observable.js';

/**
 * Minimum visibility ratio required for a cell to be considered visible in the viewport.
 * A cell is considered visible if at least this percentage of its height is within
 * the visible area of the notebook container.
 *
 * This value is also used to determine when a cell should be scrolled into view:
 * if a cell's visibility ratio is below this threshold, it will be scrolled to center.
 *
 * Value of 0.5 means 50% of the cell must be visible.
 */
const MIN_CELL_VISIBILITY_RATIO = 0.5;
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../../common/editor/editorOptions.js';
import { ScrollType } from '../../../../../editor/common/editorCommon.js';
import { CellRevealType, INotebookEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { INotebookCellExecution, INotebookExecutionStateService, NotebookExecutionType } from '../../../notebook/common/notebookExecutionStateService.js';
import { IContextKeysCellOutputViewModel } from '../IPositronNotebookEditor.js';

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	abstract readonly kind: CellKind;
	private _container: HTMLElement | undefined;
	private readonly _execution = observableValue<INotebookCellExecution | undefined, void>('cellExecution', undefined);
	protected readonly _editor = observableValue<ICodeEditor | undefined>('cellEditor', undefined);
	protected readonly _internalMetadata;
	private readonly _editorFocusRequested = observableSignal<void>('editorFocusRequested');
	private _modelRef: IReference<IResolvedTextEditorModel> | undefined;

	public readonly executionStatus;
	public readonly selectionStatus = observableValue<CellSelectionStatus, void>('cellSelectionStatus', CellSelectionStatus.Unselected);
	public readonly isActive = observableValue('cellIsActive', false);
	public readonly editorFocusRequested: IObservableSignal<void> = this._editorFocusRequested;

	constructor(
		public readonly model: NotebookCellTextModel,
		protected readonly _instance: PositronNotebookInstance,
		@INotebookExecutionStateService private readonly _executionStateService: INotebookExecutionStateService,
		@ITextModelService private readonly _textModelService: ITextModelService,
	) {
		super();

		// Observable of internal metadata to derive execution status and timing info
		// e.g. as used in PositronNotebookCodeCell
		this._internalMetadata = observableFromEvent(
			this,
			this.model.onDidChangeInternalMetadata,
			() => /** @description internalMetadata */ this.model.internalMetadata,
		);

		// Track this cell's current execution
		this._register(this._executionStateService.onDidChangeExecution(e => {
			if (e.type === NotebookExecutionType.cell && e.affectsCell(this.model.uri)) {
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

	get outputsViewModels(): IContextKeysCellOutputViewModel[] {
		return [];
	}

	get index(): number {
		return this._instance.cells.get().indexOf(this);
	}

	get editor(): ICodeEditor | undefined {
		return this._editor.get();
	}

	get uri(): URI {
		return this.model.uri;
	}

	get notebookUri(): URI {
		return this._instance.uri;
	}

	/**
	 * Get the handle number for cell from cell model
	 */
	get handle(): number {
		return this.model.handle;
	}

	getContent(): string {
		return this.model.getValue();
	}

	async getTextEditorModel(): Promise<ITextModel> {
		// Cache and reuse a single model reference for the lifetime of this cell.
		// This reference will be disposed when the cell is disposed.
		if (!this._modelRef) {
			this._modelRef = this._register(await this._textModelService.createModelReference(this.uri));
		}
		return this._modelRef.object.textEditorModel;
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

	get container(): HTMLElement | undefined {
		return this._container;
	}

	getNotebookContainer(): HTMLElement | undefined {
		return this._instance.container;
	}

	/**
	 * Check if this cell's container contains the given element.
	 * @param element The element to check
	 * @returns true if the element is contained within this cell's container, false otherwise
	 */
	containsElement(element: Element): boolean {
		return this._container?.contains(element) ?? false;
	}

	attachEditor(editor: CodeEditorWidget): void {
		this._editor.set(editor, undefined);
	}

	detachEditor(): void {
		this._editor.set(undefined, undefined);
	}

	/**
	 * Waits for the container to be available by polling.
	 * This handles the case where reveal/highlight is called before React mounts the cell.
	 * Uses disposableTimeout to ensure timeouts are cleaned up if the cell is disposed.
	 * @param maxWaitMs Maximum time to wait in milliseconds. Defaults to 100ms.
	 * @param intervalMs Polling interval in milliseconds. Defaults to 10ms.
	 * @returns Promise that resolves to true if container became available, false if timed out or disposed.
	 */
	private async _waitForContainer(maxWaitMs = 100, intervalMs = 10): Promise<boolean> {
		// Return early if already available
		if (this._container && this._instance.cellsContainer) {
			return true;
		}

		// Return early if already disposed
		if (this._store.isDisposed) {
			return false;
		}

		const startTime = Date.now();
		return new Promise(resolve => {
			const check = () => {
				// Check if disposed before continuing the polling loop
				if (this._store.isDisposed) {
					resolve(false);
					return;
				}

				if (this._container && this._instance.cellsContainer) {
					resolve(true);
				} else if (Date.now() - startTime >= maxWaitMs) {
					resolve(false);
				} else {
					// Use disposableTimeout registered with this._store so it's cancelled on disposal
					disposableTimeout(check, intervalMs, this._store);
				}
			};
			// Start the first poll using disposableTimeout
			disposableTimeout(check, intervalMs, this._store);
		});
	}

	/**
	 * Check if this cell is currently visible in the viewport.
	 * A cell is considered visible if at least {@link MIN_CELL_VISIBILITY_RATIO} of it is within the viewport.
	 * @returns true if the cell is visible, false otherwise
	 */
	isInViewport(): boolean {
		if (!this._container || !this._instance.cellsContainer) {
			return false;
		}

		const cellRect = this._container.getBoundingClientRect();
		const containerRect = this._instance.cellsContainer.getBoundingClientRect();

		const visibleTop = Math.max(containerRect.top, cellRect.top);
		const visibleBottom = Math.min(containerRect.bottom, cellRect.bottom);
		const visibleHeight = Math.max(0, visibleBottom - visibleTop);
		const visibilityRatio = visibleHeight / cellRect.height;

		return visibilityRatio >= MIN_CELL_VISIBILITY_RATIO;
	}

	async reveal(type?: CellRevealType): Promise<boolean> {
		// TODO: We may want to support type, but couldn't find any issues without it
		// Wait for container if not immediately available
		const hasContainer = await this._waitForContainer();
		if (!hasContainer || !this._container || !this._instance.cellsContainer) {
			return false;
		}

		// If the cell is not sufficiently visible, scroll it to center
		if (!this.isInViewport()) {
			// Use smooth scrolling for better UX when revealing cells
			this._container.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
		return true;
	}

	async highlightTemporarily(): Promise<boolean> {
		const hasContainer = await this._waitForContainer();
		if (!hasContainer || !this._container) {
			return false;
		}

		const container = this._container;

		// Remove class and wait for next frame to re-add. The animation ends
		// with no visual change so we can leave the class on. The class hanging
		// around is a tradeoff to avoid having to handle removing the class via
		// javascript which makes this more complex and fragile.
		container.classList.remove('assistant-highlight');
		DOM.getWindow(container).requestAnimationFrame(() => {
			container.classList.add('assistant-highlight');
		});

		return true;
	}

	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		if (!options) {
			return;
		}

		// Scroll the cell into view
		await this.reveal(options.cellRevealType);

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

	/**
	 * Request focus for the cell's editor.
	 * React will handle the actual focus operation via useLayoutEffect when the editor is mounted.
	 */
	requestEditorFocus(): void {
		this._editorFocusRequested.trigger(undefined, undefined);
	}

	async showEditor(): Promise<ICodeEditor | undefined> {
		// Returns the current editor (may be undefined if not yet mounted)
		// Focus is managed by React through the editorFocusRequested observable
		return this._editor.get();
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

	insertMarkdownCellAbove(): void {
		this._instance.insertMarkdownCellAndFocusContainer('above', this);
	}

	insertMarkdownCellBelow(): void {
		this._instance.insertMarkdownCellAndFocusContainer('below', this);
	}
}

