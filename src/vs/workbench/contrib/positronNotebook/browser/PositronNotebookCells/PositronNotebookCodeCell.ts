/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { parseOutputData } from '../getOutputContents.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { PositronWebviewPreloadService } from '../../../positronWebviewPreloads/browser/positronWebviewPreloadsService.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { pickPreferredOutputItem } from './notebookOutputUtils.js';

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




