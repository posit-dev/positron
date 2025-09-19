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
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { CellSelectionType } from '../selectionMachine.js';

export class PositronNotebookMarkdownCell extends PositronNotebookCellGeneral implements IPositronNotebookMarkdownCell {

	readonly markdownString;
	readonly editorShown = observableValue('editorShown', false);
	override kind: CellKind.Markup = CellKind.Markup;

	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		executionStateService: INotebookExecutionStateService,
		textModelResolverService: ITextModelService,
	) {
		super(cellModel, instance, executionStateService, textModelResolverService);

		// Create the markdown string observable
		this.markdownString = observableFromEvent(
			this,
			this.cellModel.onDidChangeContent,
			() => /** @description markdownString */ this.getContent()
		);
	}

	toggleEditor(): void {
		const editorStartingOpen = this.editorShown.get();
		this.editorShown.set(!editorStartingOpen, undefined);
		// Make sure cell stays selected if we're closing the editor
		if (editorStartingOpen) {
			this.select(CellSelectionType.Normal);
		}
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
