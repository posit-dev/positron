/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from '../../../../../base/common/async.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { Disposable, DisposableStore, IReference } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IModelDeltaDecoration, ITextModel } from '../../../../../editor/common/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellDecorationManager } from './CellDecorationManager.js';
import { CellEditType, CellKind, NotebookCellExecutionState } from '../../../notebook/common/notebookCommon.js';
import { IPositronNotebookCell, CellSelectionStatus, ExecutionStatus, NotebookCellOutputs, TagWriteResult } from './IPositronNotebookCell.js';
import { CellSelectionType } from '../selectionMachine.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { derived, IObservable, IObservableSignal, observableFromEvent, observableFromEventOpts, observableSignal, observableValue } from '../../../../../base/common/observable.js';
import { equals as arraysEqual } from '../../../../../base/common/arrays.js';
import { applyTagsToNestedMetadata } from './cellTagsMetadata.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { applyTextEditorOptions } from '../../../../common/editor/editorOptions.js';
import { ScrollType } from '../../../../../editor/common/editorCommon.js';
import { INotebookEditorOptions } from '../../../notebook/browser/notebookBrowser.js';
import { INotebookCellExecution, INotebookExecutionStateService, NotebookExecutionType } from '../../../notebook/common/notebookExecutionStateService.js';
import { IContextKeysCellOutputViewModel } from '../IPositronNotebookEditor.js';
import { CellContextKeyManager } from './CellContextKeyManager.js';
import { PositronNotebookCodeCell } from './PositronNotebookCodeCell.js';
import { PositronNotebookMarkdownCell } from './PositronNotebookMarkdownCell.js';

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

/**
 * Reason for revealing a cell - determines the scroll behavior
 */
export type CellRevealReason = 'keyboardNavigation' | 'programmatic';

/**
 * Direction of keyboard navigation - used for oversized cell handling
 */
export type CellNavigationDirection = 'up' | 'down';

/**
 * Options for revealing a cell with reason-aware behavior
 */
export interface ICellRevealOptions {
	/**
	 * The reason for revealing the cell - determines scroll behavior
	 */
	reason: CellRevealReason;
	/**
	 * The direction of keyboard navigation (only applicable when reason is 'keyboardNavigation')
	 */
	direction?: CellNavigationDirection;
}

export abstract class PositronNotebookCellGeneral extends Disposable implements IPositronNotebookCell {
	abstract readonly kind: CellKind;
	private _container: HTMLElement | undefined;
	private readonly _containerDisposables = this._register(new DisposableStore());
	private _scopedContextKeyService: IScopedContextKeyService | undefined;
	private _contextKeys: CellContextKeyManager | undefined;
	private readonly _execution = observableValue<INotebookCellExecution | undefined, void>('cellExecution', undefined);
	protected readonly _editor = observableValue<ICodeEditor | undefined>('cellEditor', undefined);
	public readonly editor: IObservable<ICodeEditor | undefined> = this._editor;
	protected readonly _internalMetadata;
	/** Cell tags, derived from the nested nbformat `metadata.metadata.tags`. */
	public readonly tags: IObservable<string[]>;
	/** Whether the inline tag-add input is currently requested for this cell. */
	private readonly _isAddingTag = observableValue<boolean>('cellIsAddingTag', false);
	public readonly isAddingTag: IObservable<boolean> = this._isAddingTag;
	/**
	 * The single visibility predicate for this cell's tag UI (pills + inline add
	 * input); see {@link IPositronNotebookCell.tagUIVisible}.
	 */
	public readonly tagUIVisible: IObservable<boolean>;
	private readonly _editorFocusRequested = observableSignal<void>('editorFocusRequested');
	private _modelRef: IReference<IResolvedTextEditorModel> | undefined;

	/** Decoration manager that handles mount/unmount automatically */
	private readonly _decorationManager: CellDecorationManager;

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

		// Initialize decoration manager with editor observable
		this._decorationManager = this._register(new CellDecorationManager(this.editor));

		// Observable of internal metadata to derive execution status and timing info
		// e.g. as used in PositronNotebookCodeCell
		this._internalMetadata = observableFromEvent(
			this,
			this.model.onDidChangeInternalMetadata,
			() => /** @description internalMetadata */ this.model.internalMetadata,
		);

		// Read tags from the nested nbformat metadata (see applyTagsToNestedMetadata).
		// This is untrusted file data, so normalize on read: ignore a non-array,
		// drop non-string entries, and dedupe -- the tag bar relies on values being
		// unique (React keys, edit/remove targeting). equalsFn keeps the observable
		// stable since onDidChangeMetadata fires on any metadata change, not just tags.
		this.tags = observableFromEventOpts(
			{ owner: this, debugName: 'cellTags', equalsFn: arraysEqual },
			this.model.onDidChangeMetadata,
			() => {
				const raw = (this.model.metadata.metadata as Record<string, unknown> | undefined)?.tags;
				if (!Array.isArray(raw)) {
					return [];
				}
				return [...new Set(raw.filter((tag): tag is string => typeof tag === 'string'))];
			},
		);

		// The tag UI shows when the cell has a tag or an inline add is in
		// progress, unless the notebook-wide toggle hides tags.
		this.tagUIVisible = derived(this, reader =>
			!this._instance.cellTagsHidden.read(reader) &&
			(this.tags.read(reader).length > 0 || this._isAddingTag.read(reader))
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

	/**
	 * Current cell outputs as an observable.
	 * Base implementation returns undefined; code cells override this.
	 */
	get outputs(): IObservable<NotebookCellOutputs[]> | undefined {
		return undefined;
	}

	get index(): number {
		return this._instance.cells.get().indexOf(this);
	}

	get currentEditor(): ICodeEditor | undefined {
		return this._editor.get();
	}

	get uri(): URI {
		return this.model.uri;
	}

	get notebookUri(): URI {
		return this._instance.uri;
	}

	get instance(): IPositronNotebookInstance {
		return this._instance;
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

	getLineCount(): number {
		return this.model.textBuffer.getLineCount();
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

	private setTags(tags: string[]): boolean {
		// Skip no-op writes: applyEdits replaces the metadata object and fires a
		// change even for identical content, which would add an undo entry and
		// dirty the notebook. A no-op leaves the desired state in place, so report
		// success without writing (e.g. committing a tag edit without changes).
		if (arraysEqual(this.tags.get(), tags)) {
			return true;
		}
		// Tag edits are document mutations, so respect a read-only notebook
		// (mirrors the reorder guard in PositronNotebookComponent).
		if (this._instance.isReadOnly) {
			return false;
		}
		const textModel = this._instance.textModel;
		if (!textModel) {
			return false;
		}
		const index = this.index;
		if (index < 0) {
			return false;
		}
		// Write to the nested nbformat location (see applyTagsToNestedMetadata). The
		// trailing `true` is computeUndoRedo, so tag changes remain undoable.
		const nestedMetadata = applyTagsToNestedMetadata(this.model.metadata.metadata, tags);
		textModel.applyEdits([
			{
				editType: CellEditType.PartialMetadata,
				index,
				metadata: { metadata: nestedMetadata }
			}
		], true, undefined, () => undefined, undefined, true);
		return true;
	}

	addTag(tag: string): TagWriteResult {
		const value = tag.trim();
		if (!value) {
			// Blank input: nothing to add, the desired state already holds.
			return 'ok';
		}
		const existing = this.tags.get();
		if (existing.includes(value)) {
			return 'duplicate';
		}
		// setTags reports false if the write was skipped; surface that as 'failed'.
		return this.setTags([...existing, value]) ? 'ok' : 'failed';
	}

	removeTag(tag: string): TagWriteResult {
		const existing = this.tags.get();
		if (!existing.includes(tag)) {
			// Already absent: the desired state holds without writing (mirrors the
			// no-op skip in setTags).
			return 'ok';
		}
		return this.setTags(existing.filter(t => t !== tag)) ? 'ok' : 'failed';
	}

	renameTag(oldTag: string, newTag: string): TagWriteResult {
		const value = newTag.trim();
		if (!value) {
			// Blank input: nothing to rename to, the desired state already holds.
			return 'ok';
		}
		const existing = this.tags.get();
		const index = existing.indexOf(oldTag);
		if (index < 0) {
			// The tag being renamed is gone (the cell changed underneath us).
			return 'failed';
		}
		// Reject a rename onto a different existing tag. Renaming to the unchanged
		// value matches only its own index, so it falls through to a setTags no-op.
		if (existing.some((t, i) => i !== index && t === value)) {
			return 'duplicate';
		}
		const next = [...existing];
		next[index] = value;
		// setTags reports false if the write was skipped; surface that as 'failed'.
		return this.setTags(next) ? 'ok' : 'failed';
	}

	beginAddTag(): void {
		this._isAddingTag.set(true, undefined);
	}

	endAddTag(): void {
		this._isAddingTag.set(false, undefined);
	}

	// Add placeholder run method to be overridden by subclasses
	abstract run(): void;

	override dispose(): void {
		// Clean up any animation classes if present
		if (this._container) {
			this._container.classList.remove('assistant-highlight', 'assistant-highlight-add', 'assistant-highlight-modify');
		}

		super.dispose();
	}

	isMarkdownCell(): this is PositronNotebookMarkdownCell {
		return this.kind === CellKind.Markup;
	}

	isCodeCell(): this is PositronNotebookCodeCell {
		return this.kind === CellKind.Code && this.model.language !== 'raw';
	}

	isRawCell(): this is PositronNotebookCodeCell {
		return this.kind === CellKind.Code && this.model.language === 'raw';
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

	get scopedContextKeyService(): IScopedContextKeyService | undefined {
		return this._scopedContextKeyService;
	}

	/** Context keys scoped to this cell, available after container attachment. */
	get contextKeys(): CellContextKeyManager | undefined {
		return this._contextKeys;
	}

	attachContainer(container: HTMLElement): void {
		if (this._container === container) {
			return;
		}
		this._containerDisposables.clear();
		this._container = container;

		this._scopedContextKeyService = this._containerDisposables.add(
			this._instance.scopedContextKeyService.createScoped(container)
		);
		this._contextKeys = this._containerDisposables.add(
			new CellContextKeyManager(this, this._scopedContextKeyService, this._instance)
		);
	}

	get container(): HTMLElement | undefined {
		return this._container;
	}

	attachEditor(editor: ICodeEditor): void {
		this._editor.set(editor, undefined);
	}

	detachEditor(): void {
		this._editor.set(undefined, undefined);
	}

	deltaModelDecorations(oldDecorations: readonly string[], newDecorations: readonly IModelDeltaDecoration[]): string[] {
		return this._decorationManager.deltaModelDecorations(oldDecorations, newDecorations);
	}

	getCellDecorationRange(id: string): Range | null {
		return this._decorationManager.getCellDecorationRange(id);
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

	/**
	 * Per-notebook generation counter to cancel stale reveal operations during rapid keyboard
	 * navigation. Keyed by notebook instance so reveals in one notebook don't cancel reveals
	 * in another.
	 */
	private static _revealGenerationByInstance = new WeakMap<object, number>();

	async reveal(options: ICellRevealOptions): Promise<boolean> {
		const resolvedOptions = options;

		// Capture per-notebook generation so we can bail if a newer reveal starts while we await
		const genMap = PositronNotebookCellGeneral._revealGenerationByInstance;
		const prevGen = genMap.get(this._instance) ?? 0;
		const generation = prevGen + 1;
		genMap.set(this._instance, generation);

		// Wait for container if not immediately available
		const hasContainer = await this._waitForContainer();
		if (!hasContainer || !this._container || !this._instance.cellsContainer) {
			return false;
		}

		// A newer reveal was triggered in this notebook while we were waiting -- let it win
		if (generation !== genMap.get(this._instance)) {
			return false;
		}

		// Two scroll strategies depending on how the reveal was triggered:
		//
		// Keyboard navigation uses an instant jump. The user is driving the
		// navigation themselves so each step moves at most one cell -- the
		// scroll distance is small and predictable, and an instant snap keeps
		// repeated key-presses feeling responsive without disorienting the user.
		//
		// Programmatic reveals (e.g. an agent editing a cell elsewhere in the
		// notebook) use a smooth, centered scroll. The destination may be far
		// from the current viewport, so the animation gives the user a sense of
		// direction and helps them re-orient spatially within the document.
		if (resolvedOptions.reason === 'keyboardNavigation') {
			// We always call scrollIntoView here (skipping isInViewport()) because
			// the 50% visibility threshold used by isInViewport() would leave
			// partially-visible cells un-scrolled. scrollIntoView with 'nearest'
			// is a no-op when the cell is already fully visible.
			const cellRect = this._container.getBoundingClientRect();
			const containerRect = this._instance.cellsContainer.getBoundingClientRect();
			const isOversized = cellRect.height > containerRect.height;

			if (isOversized && resolvedOptions.direction) {
				// Oversized cell: show top when navigating down, bottom when navigating up
				const block = resolvedOptions.direction === 'down' ? 'start' : 'end';
				this._container.scrollIntoView({ behavior: 'instant', block });
			} else {
				// Normal cell: scroll minimum distance to make fully visible
				this._container.scrollIntoView({ behavior: 'instant', block: 'nearest' });
			}
		} else {
			if (!this.isInViewport()) {
				this._container.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}

		return true;
	}

	async highlightTemporarily(operationType?: 'add' | 'delete' | 'modify', maxWaitMs?: number): Promise<boolean> {
		// Default to longer timeout for add operations since React needs time to render new cells
		const timeout = maxWaitMs ?? (operationType === 'add' ? 500 : 100);
		const hasContainer = await this._waitForContainer(timeout);
		if (!hasContainer || !this._container) {
			return false;
		}

		const container = this._container;

		// Remove all highlight classes
		container.classList.remove('assistant-highlight', 'assistant-highlight-add', 'assistant-highlight-delete', 'assistant-highlight-modify');

		// Use requestAnimationFrame to defer re-adding (existing pattern)
		DOM.getWindow(container).requestAnimationFrame(() => {
			container.classList.add('assistant-highlight');
			if (operationType) {
				container.classList.add(`assistant-highlight-${operationType}`);
			}
		});

		return true;
	}

	async setOptions(options: INotebookEditorOptions | undefined): Promise<void> {
		if (!options) {
			return;
		}

		// Scroll the cell into view
		await this.reveal({ reason: 'programmatic' });

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
		return this.currentEditor;
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

	insertRawCellAbove(): void {
		this._instance.insertRawCellAndFocusContainer('above', this);
	}

	insertRawCellBelow(): void {
		this._instance.insertRawCellAndFocusContainer('below', this);
	}
}

