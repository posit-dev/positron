/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableFromEvent } from '../../../../../base/common/observable.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { parseOutputData } from '../getOutputContents.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from './IPositronNotebookCell.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { pickPreferredOutputItem } from './notebookOutputUtils.js';
import { getWebviewMessageType } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';

export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	outputs;

	// Execution timing observables
	lastExecutionDuration;
	lastExecutionOrder;
	lastRunSuccess;
	lastRunEndTime;

	constructor(
		cellModel: NotebookCellTextModel,
		private instance: PositronNotebookInstance,
		@INotebookExecutionStateService _executionStateService: INotebookExecutionStateService,
		@ITextModelService _textModelResolverService: ITextModelService,
		@IPositronWebviewPreloadService private _webviewPreloadService: IPositronWebviewPreloadService,
	) {
		super(cellModel, instance, _executionStateService, _textModelResolverService);

		this.outputs = observableFromEvent(this, this.cellModel.onDidChangeOutputs, () => {
			/** @description cellOutputs */
			return this.parseCellOutputs();
		});

		// Execution timing observables
		this.lastExecutionDuration = this._internalMetadata.map(({ runStartTime, runEndTime }) => {
			/** @description lastExecutionDuration */
			if (typeof runStartTime === 'number' && typeof runEndTime === 'number') {
				return Math.max(0, runEndTime - runStartTime);
			}
			return undefined;
		});
		this.lastExecutionOrder = this._internalMetadata.map(m => /** @description lastExecutionOrder */ m.executionOrder);
		this.lastRunSuccess = this._internalMetadata.map(m => /** @description lastRunSuccess */ m.lastRunSuccess);
		this.lastRunEndTime = this._internalMetadata.map(m => /** @description lastRunEndTime */ m.runEndTime);
	}

	/**
	 * Turn the cell outputs into an array of NotebookCellOutputs objects that we know how to render
	 * @returns Output list with a prefered output item parsed for rendering
	 */
	parseCellOutputs(): NotebookCellOutputs[] {
		const parsedOutputs: NotebookCellOutputs[] = [];

		this.cellModel.outputs.forEach((output) => {
			const outputItems = output.outputs || [];
			const preferredOutputItem = pickPreferredOutputItem(outputItems);
			if (!preferredOutputItem) {
				return;
			}

			const parsedOutput: NotebookCellOutputs = {
				outputId: output.outputId,
				outputs: outputItems,
				parsed: parseOutputData(preferredOutputItem),
			};

			const preloadMessageType = getWebviewMessageType(outputItems);

			if (preloadMessageType) {
				parsedOutput.preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this.instance,
					outputId: output.outputId,
					outputs: outputItems,
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




