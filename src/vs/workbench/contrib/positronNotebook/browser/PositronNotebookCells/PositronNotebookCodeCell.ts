/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { observableFromEvent, observableValue } from '../../../../../base/common/observable.js';
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
import { INotebookExecutionStateService, NotebookExecutionType } from '../../../notebook/common/notebookExecutionStateService.js';

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

		// Initialize execution timing observables
		this.lastExecutionDuration = observableValue('positronNotebookCodeCell.lastExecutionDuration', this.calculateExecutionDuration());
		this.lastExecutionOrder = observableValue('positronNotebookCodeCell.lastExecutionOrder', cellModel.internalMetadata.executionOrder);
		this.lastRunSuccess = observableValue('positronNotebookCodeCell.lastRunSuccess', cellModel.internalMetadata.lastRunSuccess);
		this.lastRunEndTime = observableValue('positronNotebookCodeCell.lastRunEndTime', cellModel.internalMetadata.runEndTime);

		// Listen for changes to the internal metadata to update execution timing
		this._register(
			this.cellModel.onDidChangeInternalMetadata(() => {
				this.updateExecutionInfo();
			})
		);

		// Listen for execution state changes
		this._register(
			_executionStateService.onDidChangeExecution(e => {
				if (e.type === NotebookExecutionType.cell && e.affectsCell(this.cellModel.uri)) {
					this.updateExecutionInfo();
				}
			})
		);
	}

	private calculateExecutionDuration(): number | undefined {
		const { runStartTime, runEndTime } = this.cellModel.internalMetadata;
		if (typeof runStartTime === 'number' && typeof runEndTime === 'number') {
			return Math.max(0, runEndTime - runStartTime);
		}
		return undefined;
	}

	private updateExecutionInfo(): void {
		const metadata = this.cellModel.internalMetadata;
		this.lastExecutionDuration.set(this.calculateExecutionDuration(), undefined);
		this.lastExecutionOrder.set(metadata.executionOrder ?? undefined, undefined);
		this.lastRunSuccess.set(metadata.lastRunSuccess ?? undefined, undefined);
		this.lastRunEndTime.set(metadata.runEndTime ?? undefined, undefined);
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

			const preloadMessageType = getWebviewMessageType(outputs);

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




