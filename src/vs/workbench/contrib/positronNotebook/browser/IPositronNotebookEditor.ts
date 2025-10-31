/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { ICellViewModel, INotebookEditor, INotebookViewModel } from '../../notebook/browser/notebookBrowser.js';
import { NotebookTextModel } from '../../notebook/common/model/notebookTextModel.js';

/**
 * This module is our solution to partially implementing INotebookEditor
 * to benefit from upstream features, as required.
 *
 * The idea is as follows:
 *
 * 1. We define narrower interfaces per feature e.g. IExtensionApiNotebookEditor
 *    for integrating with the extension API.
 * 2. We update features to depend on our narrower interfaces e.g. IExtensionApiNotebookEditor
 *    as INotebookEditor.
 * 3. We define a single union of all per-feature interfaces e.g. IPositronNotebookEditor.
 * 4. Our main interfaces extend these union interfaces e.g. IPositronNotebookInstance
 *    extends IPositronNotebookEditor.
 *
 * See also INotebookEditorServiceProxy.
 */

//#region Extension API
export type IExtensionApiNotebookViewModel = Pick<INotebookViewModel, 'viewType'>;
export type IExtensionApiCellViewModel = Pick<ICellViewModel, 'handle'>;
export interface IExtensionApiNotebookEditor extends Pick<
	INotebookEditor,
	// Basic
	| 'getId'
	// Text model
	| 'textModel'
	| 'onDidChangeModel'
	// Selected cells: vscode.NotebookEditor.selections
	| 'getSelections'
	| 'setSelections'
	| 'onDidChangeSelection'
	// Visible cells: vscode.NotebookEditor.visibleRanges
	| 'visibleRanges'
	| 'onDidChangeVisibleRanges'
	// Cell structure: to retrieve a cell to be revealed and to ensure the revealed range is within the notebook length
	| 'getLength'
	// Reveal: to reveal a cell
	| 'revealCellRangeInView'
	// Focus
	| 'onDidFocusWidget'
> {
	hasModel(): this is IExtensionApiActiveNotebookEditor;
	cellAt(index: number): IExtensionApiCellViewModel | undefined;
	getViewModel(): IExtensionApiNotebookViewModel | undefined;
	revealInCenter(cell: IExtensionApiCellViewModel): void;
	revealInCenterIfOutsideViewport(cell: IExtensionApiCellViewModel): Promise<void>;
	revealInViewAtTop(cell: IExtensionApiCellViewModel): void;
}
export interface IExtensionApiActiveNotebookEditor extends IExtensionApiNotebookEditor {
	cellAt(index: number): IExtensionApiCellViewModel;
	textModel: NotebookTextModel;
	getViewModel(): IExtensionApiNotebookViewModel;
}
//#endregion Extension API

//#region Context keys
export interface IContextKeysCellOutputViewModel {
}
export interface IContextKeysCellViewModel extends Pick<
	ICellViewModel,
	| 'model'
> {
	outputsViewModels: IContextKeysCellOutputViewModel[];
}
export type ContextKeysNotebookViewCellsSplice = [
	number,
	number,
	IContextKeysCellViewModel[],
];
export interface IContextKeysNotebookViewCellsUpdateEvent {
	readonly splices: readonly ContextKeysNotebookViewCellsSplice[];
}
export interface IContextKeysNotebookEditor extends Pick<
	INotebookEditor,
	| 'onDidChangeModel'
	| 'textModel'
	| 'notebookOptions'
	| 'getDomNode'
	| 'getLength'
> {
	readonly onDidChangeViewCells: Event<IContextKeysNotebookViewCellsUpdateEvent>;
	hasModel(): this is IContextKeysActiveNotebookEditor;
	readonly scopedContextKeyService: IContextKeyService | undefined;
}
export interface IContextKeysActiveNotebookEditor extends IContextKeysNotebookEditor {
	cellAt(index: number): IContextKeysCellViewModel;
	textModel: NotebookTextModel;
}
//#endregion Context keys

//#region Combined
export interface IPositronCellOutputViewModel extends IContextKeysCellOutputViewModel {
}
export interface IPositronCellViewModel extends IExtensionApiCellViewModel, IContextKeysCellViewModel {
	outputsViewModels: IPositronCellOutputViewModel[];
}

export interface IPositronActiveNotebookEditor extends IExtensionApiActiveNotebookEditor, IContextKeysActiveNotebookEditor {
	cellAt(index: number): IPositronCellViewModel;
	hasModel(): this is IPositronActiveNotebookEditor;
}

export interface IPositronNotebookEditor extends IExtensionApiNotebookEditor, IContextKeysNotebookEditor {
	cellAt(index: number): IPositronCellViewModel | undefined;
	hasModel(): this is IPositronActiveNotebookEditor;
}
//#endregion Combined
