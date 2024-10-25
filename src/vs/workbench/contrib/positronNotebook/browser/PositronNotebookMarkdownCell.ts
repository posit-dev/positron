/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from 'vs/base/common/async';
import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { PositronNotebookCellGeneral } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
import { IPositronNotebookMarkdownCell } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';

export class PositronNotebookMarkdownCell extends PositronNotebookCellGeneral implements IPositronNotebookMarkdownCell {

	markdownString: ISettableObservable<string | undefined> = observableValue<string | undefined, void>('markdownString', undefined);
	editorShown: ISettableObservable<boolean> = observableValue<boolean, void>('editorShown', false);
	override kind: CellKind.Markup = CellKind.Markup;

	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		textModelResolverService: ITextModelService
	) {
		super(cellModel, instance, textModelResolverService);

		// Render the markdown content and update the observable when the cell content changes
		this._register(this.cellModel.onDidChangeContent(() => {
			this.markdownString.set(this.getContent(), undefined);
		}));

		this._updateContent();
	}

	private _updateContent(): void {
		this.markdownString.set(this.getContent(), undefined);
	}

	toggleEditor(): void {
		this.editorShown.set(!this.editorShown.get(), undefined);
	}

	override run(): void {
		this.toggleEditor();
	}

	override focusEditor(): void {
		this.editorShown.set(true, undefined);
		// Need a timeout here so that the editor is shown before we try to focus it.
		this._register(disposableTimeout(() => {
			super.focusEditor();
		}, 0));
	}
}
