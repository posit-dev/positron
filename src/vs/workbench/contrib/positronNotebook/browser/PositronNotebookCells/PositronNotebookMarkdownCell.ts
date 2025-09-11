/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableFromEvent, observableValue, waitForState } from '../../../../../base/common/observable.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { IPositronNotebookMarkdownCell } from './IPositronNotebookCell.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';

export class PositronNotebookMarkdownCell extends PositronNotebookCellGeneral implements IPositronNotebookMarkdownCell {

	readonly markdownString;
	readonly editorShown = observableValue<boolean>('editorShown', false);
	override kind: CellKind.Markup = CellKind.Markup;

	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		textModelResolverService: ITextModelService
	) {
		super(cellModel, instance, textModelResolverService);

		// Create the markdown string observable
		this.markdownString = observableFromEvent(this, this.cellModel.onDidChangeContent, () => {
			/** @description markdownString */
			return this.getContent();
		});
	}

	toggleEditor(): void {
		this.editorShown.set(!this.editorShown.get(), undefined);
	}

	override async showEditor(focus = false): Promise<ICodeEditor | undefined> {
		this.editorShown.set(true, undefined);
		await waitForState(this._editor, (editor) => editor !== undefined);
		return super.showEditor(focus);
	}

	override run(): void {
		this.toggleEditor();
	}
}
