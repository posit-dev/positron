/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { autorun, ISettableObservable } from '../../../../../base/common/observable.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotebookViewModel, INotebookViewCellsUpdateEvent, ICellViewModel, INotebookDeltaViewZoneDecoration, INotebookDeltaCellStatusBarItems, CellFindMatchWithIndex } from '../../../notebook/browser/notebookBrowser.js';
import { NotebookLayoutInfo } from '../../../notebook/browser/notebookViewEvents.js';
import { NotebookTextModel } from '../../../notebook/common/model/notebookTextModel.js';
import { ICellRange } from '../../../notebook/common/notebookRange.js';
import { IPositronNotebookInstance } from '../IPositronNotebookInstance.js';
import { PositronNotebookCellViewModel } from './PositronNotebookCellViewModel.js';

export class PositronNotebookViewModel extends Disposable implements INotebookViewModel {
	//#region Events
	private readonly _onDidChangeViewCells = this._register(new Emitter<INotebookViewCellsUpdateEvent>());
	private readonly _onDidChangeSelection = this._register(new Emitter<string>());
	private readonly onDidFoldingStateChangedEmitter = this._register(new Emitter<void>());

	public readonly onDidChangeViewCells = this._onDidChangeViewCells.event;
	public readonly onDidChangeSelection = this._onDidChangeSelection.event;
	public readonly onDidFoldingStateChanged = this.onDidFoldingStateChangedEmitter.event;
	//#endregion

	//#region Private Properties
	private _selection: ICellRange[] = [];
	private _viewCells: PositronNotebookCellViewModel[] = [];
	//#endregion Private Properties

	constructor(
		private readonly _notebookInstance: IPositronNotebookInstance,
		private readonly _notebook: NotebookTextModel,
		private readonly _layoutInfo: ISettableObservable<NotebookLayoutInfo>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		// TODO: Should update view cells when base cells are added/removed/moved.
		for (const cell of this._notebookInstance.cells.get()) {
			const viewCell = this._instantiationService.createInstance(PositronNotebookCellViewModel, this._notebook.viewType, cell, this._notebookInstance, this._layoutInfo);
			this._viewCells.push(viewCell);
		}

		this._register(autorun(reader => {
			const selectionStateMachine = this._notebookInstance.selectionStateMachine;
			selectionStateMachine.state.read(reader);
			// TODO: Think this isn't handling single vs multi selections correctly.
			//       Can we have the right logic here and fix it in selection state machine later?
			this._selection = selectionStateMachine.getSelectedCells().map(cell => ({ start: cell.index, end: cell.index + 1 }));
			// TODO: Currently hardcoding source to 'view'
			this._onDidChangeSelection.fire('view');
		}));
	}

	get notebookDocument() {
		return this._notebook;
	}
	get viewCells() {
		return this._viewCells;
	}
	get layoutInfo(): NotebookLayoutInfo {
		return this._layoutInfo.get();
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
		return this._selection;
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
