/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { combinedDisposable, Disposable, DisposableMap, IDisposable } from '../../../../base/common/lifecycle.js';
import { ICellRange } from '../../../contrib/notebook/common/notebookRange.js';
import { editorGroupToColumn } from '../../../services/editor/common/editorGroupColumn.js';
import { IEditorGroupsService } from '../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { ExtHostContext, ExtHostNotebookEditorsShape, INotebookDocumentShowOptions, INotebookEditorPropertiesChangeData, INotebookEditorViewColumnInfo, MainThreadNotebookEditorsShape, NotebookEditorRevealType } from '../../common/extHost.protocol.js';
import { IPositronNotebookInstance } from '../../../contrib/positronNotebook/browser/IPositronNotebookInstance.js';
import { runOnChange } from '../../../../base/common/observable.js';
import { getSelectedCells, SelectionStates } from '../../../contrib/positronNotebook/browser/selectionMachine.js';
import { equals } from '../../../../base/common/objects.js';
import { UriComponents } from '../../../../base/common/uri.js';
import { Emitter } from '../../../../base/common/event.js';
import { IEditorPane } from '../../../common/editor.js';
import { PositronNotebookEditor } from '../../../contrib/positronNotebook/browser/PositronNotebookEditor.js';
import { getNotebookInstanceFromEditorPane } from '../../../contrib/positronNotebook/browser/positronNotebookBrowser.js';

//#region MainThreadPositronNotebookInstance
/**
 * Represents a PositronNotebookInstance on the main thread.
 */
export class MainThreadPositronNotebookInstance extends Disposable {
	private readonly _onDidChangeProperties = this._register(new Emitter<INotebookEditorPropertiesChangeData>());

	/** Event that fires when the notebook editor properties change */
	readonly onDidChangeProperties = this._onDidChangeProperties.event;

	constructor(
		private readonly _instance: IPositronNotebookInstance,
	) {
		super();

		// Fire an event when selections change
		this._register(runOnChange(this._instance.selectionStateMachine.state, (state) => {
			const selections = this.getSelections(state);
			this._onDidChangeProperties.fire({ selections: { selections } });
		}));

		// TODO: Fire an event when visible ranges change
		// this._onDidChangeProperties.fire({ visibleRanges: { ranges: [] } });
	}

	getId(): string {
		return this._instance.id;
	}

	getDocumentUri(): UriComponents {
		return this._instance.uri;
	}

	getViewType(): string {
		return this._instance.textModel.get()?.viewType ?? 'jupyter-notebook';
	}

	getSelections(state?: SelectionStates): ICellRange[] {
		// TODO: Double check this
		state = state ?? this._instance.selectionStateMachine.state.get();
		const selectedCells = getSelectedCells(state);

		if (selectedCells.length === 0) {
			return [];
		}

		// Group consecutive cells into ranges
		const ranges: ICellRange[] = [];
		let currentStart = selectedCells[0].index;
		let currentEnd = currentStart + 1;

		for (let i = 1; i < selectedCells.length; i++) {
			const cellIndex = selectedCells[i].index;
			if (cellIndex === currentEnd) {
				// Consecutive cell, extend the range
				currentEnd++;
			} else {
				// Non-consecutive, save current range and start new one
				ranges.push({ start: currentStart, end: currentEnd });
				currentStart = cellIndex;
				currentEnd = currentStart + 1;
			}
		}

		// Add the last range
		ranges.push({ start: currentStart, end: currentEnd });

		return ranges;
	}

	getVisibleRanges(): ICellRange[] {
		// For now, return all cells as visible if we have a container
		// TODO: Implement actual viewport calculation based on scroll position
		if (this._instance.cellsContainer && this._instance.cells.get().length > 0) {
			return [{ start: 0, end: this._instance.cells.get().length }];
		}
		return [];
	}

	setSelections(selections: readonly ICellRange[]): void {
		// TODO: Implement set selections
	}

	revealRange(range: ICellRange, revealType: NotebookEditorRevealType): void {
		// TODO: Implement reveal range
	}

	matches(editor: IEditorPane): boolean {
		return editor instanceof PositronNotebookEditor && editor.notebookInstance === this._instance;
	}
}
//#endregion MainThreadPositronNotebookInstance

//#region MainThreadPositronNotebookEditors
export interface IMainThreadPositronNotebookInstanceLocator {
	getInstance(id: string): MainThreadPositronNotebookInstance | undefined;
}

export class MainThreadPositronNotebookEditors extends Disposable implements MainThreadNotebookEditorsShape {
	/**
	 * Proxy object to communicate with the extension host.
	 */
	private readonly _proxy: ExtHostNotebookEditorsShape;

	/**
	 * Map of main thread notebook instances exposed to the extension host:
	 * notebook instance ID → main thread notebook instance.
	 */
	private readonly _listenersByInstanceId = this._register(new DisposableMap<string, IDisposable>());

	/**
	 * Map of main thread notebook instance ID → editor group column
	 * exposed to the extension host.
	 */
	private _currentViewColumnInfo?: INotebookEditorViewColumnInfo;

	constructor(
		private readonly _instanceLocator: IMainThreadPositronNotebookInstanceLocator,
		extHostContext: IExtHostContext,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
	) {
		super();

		// Setup extension host proxies
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebookEditors);

		// Setup listeners to update view column info in the extension host
		this._register(this._editorService.onDidActiveEditorChange(() => this._updateEditorViewColumns()));
		this._register(this._editorGroupService.onDidRemoveGroup(() => this._updateEditorViewColumns()));
		this._register(this._editorGroupService.onDidMoveGroup(() => this._updateEditorViewColumns()));
	}

	/**
	 * Called by MainThreadPositronNotebooksAndEditors when notebook instances are added.
	 */
	handleNotebookInstanceAdded(instance: MainThreadPositronNotebookInstance): void {
		const id = instance.getId();
		this._listenersByInstanceId.set(id, combinedDisposable(
			// Notify the extension host when properties change
			instance.onDidChangeProperties((e) => {
				this._proxy.$acceptEditorPropertiesChanged(id, e);
			})
		));
	}

	/**
	 * Called by MainThreadPositronNotebooksAndEditors when notebook instances are removed.
	 */
	handleNotebookInstanceRemoved(id: string): void {
		this._listenersByInstanceId.deleteAndDispose(id);
	}

	/**
	 * Update the view column info for all notebook instances in the extension host.
	 */
	private _updateEditorViewColumns(): void {
		// Determine new view column info: notebook instance ID → editor group column
		const viewColumnInfo: INotebookEditorViewColumnInfo = Object.create(null);
		for (const editorPane of this._editorService.visibleEditorPanes) {
			const notebookInstance = getNotebookInstanceFromEditorPane(editorPane);
			if (notebookInstance) {
				viewColumnInfo[notebookInstance.id] = editorGroupToColumn(this._editorGroupService, editorPane.group);
			}
		}

		// Notify the extension host if the view column info changed
		if (!equals(viewColumnInfo, this._currentViewColumnInfo)) {
			this._currentViewColumnInfo = viewColumnInfo;
			this._proxy.$acceptEditorViewColumns(viewColumnInfo);
		}
	}

	/**
	 * Called by the extension host to try to show a notebook document.
	 */
	async $tryShowNotebookDocument(uriComponents: UriComponents, viewType: string, options: INotebookDocumentShowOptions): Promise<string> {
		// It's simpler to let MainThreadNotebookEditors handle $tryShowNotebookDocument
		// with patches to support IPositronNotebookInstance.
		throw new Error('Method not implemented.');
	}

	/**
	 * Called by the extension host to try to reveal a range in a notebook.
	 */
	async $tryRevealRange(id: string, range: ICellRange, revealType: NotebookEditorRevealType): Promise<void> {
		const instance = this._instanceLocator.getInstance(id);
		if (!instance) {
			return;
		}
		instance.revealRange(range, revealType);
	}

	/**
	 * Called by the extension host to try to select cells in a notebook.
	 */
	async $trySetSelections(id: string, selections: readonly ICellRange[]): Promise<void> {
		const instance = this._instanceLocator.getInstance(id);
		if (!instance) {
			return;
		}
		instance.setSelections(selections);
	}
}
//#endregion MainThreadPositronNotebookEditors
