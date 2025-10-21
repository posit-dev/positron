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

	async toggleEditor(): Promise<void> {
		const editorStartingOpen = this.editorShown.get();
		if (editorStartingOpen) {
			// Closing the editor - exit editing mode and return to selected state
			this._instance.selectionStateMachine.exitEditor(this);
			this.editorShown.set(false, undefined);
		} else {
			// Opening the editor - enter editing mode through the selection machine
			// This will properly handle state transitions and focus management
			await this._instance.selectionStateMachine.enterEditor(this);
		}
	}

	override async showEditor(): Promise<ICodeEditor | undefined> {
		this.editorShown.set(true, undefined);
		await waitForState(this._editor, (editor) => editor !== undefined);
		// Wait for the text model to be loaded before returning
		// This ensures the editor is fully ready for focus operations
		await this.getTextEditorModel();
		return super.showEditor();
	}

	override run(): void {
		this.toggleEditor();
	}
}
