/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable, observableValue } from '../../../../../base/common/observable.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { parseOutputData } from '../getOutputContents.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from '../../../../services/positronNotebook/browser/IPositronNotebookCell.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { pickPreferredOutputItem } from './notebookOutputUtils.js';
import { getWebviewMessageType } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { INotebookExecutionStateService, NotebookExecutionType } from '../../../notebook/common/notebookExecutionStateService.js';

export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	outputs: ISettableObservable<NotebookCellOutputs[]>;

	// Execution timing observables
	lastExecutionDuration: ISettableObservable<number | undefined>;
	lastExecutionOrder: ISettableObservable<number | undefined>;
	lastRunSuccess: ISettableObservable<boolean | undefined>;
	lastRunEndTime: ISettableObservable<number | undefined>;

	constructor(
		cellModel: NotebookCellTextModel,
		private instance: PositronNotebookInstance,
		@ITextModelService _textModelResolverService: ITextModelService,
		@IPositronWebviewPreloadService private _webviewPreloadService: IPositronWebviewPreloadService,
		@INotebookExecutionStateService private _executionStateService: INotebookExecutionStateService
	) {
		super(cellModel, instance, _textModelResolverService);

		this.outputs = observableValue<NotebookCellOutputs[], void>('cellOutputs', this.parseCellOutputs());

		// Initialize execution timing observables
		this.lastExecutionDuration = observableValue<number | undefined, void>('positronNotebookCodeCell.lastExecutionDuration', this.calculateExecutionDuration());
		this.lastExecutionOrder = observableValue<number | undefined, void>('positronNotebookCodeCell.lastExecutionOrder', cellModel.internalMetadata.executionOrder);
		this.lastRunSuccess = observableValue<boolean | undefined, void>('positronNotebookCodeCell.lastRunSuccess', cellModel.internalMetadata.lastRunSuccess ?? undefined);
		this.lastRunEndTime = observableValue<number | undefined, void>('positronNotebookCodeCell.lastRunEndTime', cellModel.internalMetadata.runEndTime ?? undefined);

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.cellModel.onDidChangeOutputs(() => {
				this.outputs.set(this.parseCellOutputs(), undefined);
			})
		);

		// Listen for changes to the internal metadata to update execution timing
		this._register(
			this.cellModel.onDidChangeInternalMetadata(() => {
				this.updateExecutionInfo();
			})
		);

		// Listen for execution state changes
		this._register(
			this._executionStateService.onDidChangeExecution(e => {
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




