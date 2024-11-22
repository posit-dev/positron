/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { PositronNotebookCellGeneral } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCells/PositronNotebookCell';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
import { PositronWebviewPreloadService } from 'vs/workbench/contrib/positronWebviewPreloads/browser/positronWebviewPreloadsService';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';
import { IPositronWebviewPreloadService } from 'vs/workbench/services/positronWebviewPreloads/browser/positronWebviewPreloadService';
import { pickPreferredOutputItem } from './notebookOutputUtils';

export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	outputs: ISettableObservable<NotebookCellOutputs[]>;

	constructor(
		cellModel: NotebookCellTextModel,
		private instance: PositronNotebookInstance,
		@ITextModelService _textModelResolverService: ITextModelService,
		@IPositronWebviewPreloadService private _webviewPreloadService: IPositronWebviewPreloadService,
	) {
		super(cellModel, instance, _textModelResolverService);

		this.outputs = observableValue<NotebookCellOutputs[], void>('cellOutputs', this.parseCellOutputs());

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.cellModel.onDidChangeOutputs(() => {
				this.outputs.set(this.parseCellOutputs(), undefined);
			})
		);
	}

	/**
	 * Turn the cell outputs into an array of NotebookCellOutputs objects that we know how to render
	 * @returns Output list with a prefered output item parsed for rendering
	 */
	parseCellOutputs(): NotebookCellOutputs[] {
		const parsedOutputs: NotebookCellOutputs[] = [];

		this.cellModel.outputs.forEach((output) => {
			const outputs = output.outputs || [];
			const preferredOutput = pickPreferredOutputItem(outputs);
			if (!preferredOutput) {
				return;
			}

			const parsedOutput: NotebookCellOutputs = {
				...output,
				// For some reason the outputs don't make it across the spread operator sometimes,
				// so we'll just set them explicitly.
				outputs,
				parsed: parseOutputData(preferredOutput),
			};

			const preloadMessageType = PositronWebviewPreloadService.getWebviewMessageType(outputs);

			if (preloadMessageType) {
				parsedOutput.preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this.instance,
					outputId: output.outputId,
					outputs,
				});
			}

			parsedOutputs.push(parsedOutput);
		});

		return parsedOutputs;
	}


	override run(): void {
		this._instance.runCells([this]);
	}
}




