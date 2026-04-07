/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../../base/common/event.js';
import { ISettableObservable, observableFromEvent, observableValue } from '../../../../../base/common/observable.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { NotebookCellTextModel } from '../../../notebook/common/model/notebookCellTextModel.js';
import { CellKind } from '../../../notebook/common/notebookCommon.js';
import { parseOutputData } from '../getOutputContents.js';
import { PositronNotebookCellGeneral } from './PositronNotebookCell.js';
import { PositronNotebookInstance } from '../PositronNotebookInstance.js';
import { IPositronNotebookCodeCell, NotebookCellOutputs } from './IPositronNotebookCell.js';
import { IPositronWebviewPreloadService } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';
import { pickPreferredOutputItem } from './notebookOutputUtils.js';
import { getWebviewMessageType, isComplexHtml } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { IPositronCellOutputViewModel } from '../IPositronNotebookEditor.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';

export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	private readonly _outputs;

	// Output collapse state
	private readonly _outputIsCollapsed: ISettableObservable<boolean>;

	// Per-cell output scrolling override (undefined = use global setting)
	private readonly _outputScrolling: ISettableObservable<boolean | undefined>;

	// Execution timing observables
	lastExecutionDuration;
	lastExecutionOrder;
	lastRunSuccess;
	lastRunEndTime;

	constructor(
		cellModel: NotebookCellTextModel,
		private instance: PositronNotebookInstance,
		@INotebookExecutionStateService _executionStateService: INotebookExecutionStateService,
		@ITextModelService _textModelService: ITextModelService,
		@IPositronWebviewPreloadService private _webviewPreloadService: IPositronWebviewPreloadService,
		@IWorkspaceTrustManagementService private _workspaceTrustManagementService: IWorkspaceTrustManagementService,
	) {
		super(cellModel, instance, _executionStateService, _textModelService);

		// Initialize output collapse state from cell model if available
		this._outputIsCollapsed = observableValue<boolean>(
			'outputIsCollapsed',
			cellModel.collapseState?.outputCollapsed ?? false
		);

		// Per-cell output scrolling override (undefined = use global setting)
		this._outputScrolling = observableValue<boolean | undefined>(
			'outputScrolling',
			undefined
		);

		this._outputs = observableFromEvent(this, Event.any(
			this.model.onDidChangeOutputs,
			this.model.onDidChangeOutputItems,
			this._workspaceTrustManagementService.onDidChangeTrust,
		), () => {
			/** @description cellOutputs */
			return this.parseCellOutputs();
		});

		// Reset collapse state when outputs are cleared so new outputs aren't born collapsed
		this._register(this.model.onDidChangeOutputs(() => {
			if (this.model.outputs.length === 0) {
				this._outputIsCollapsed.set(false, undefined);
			}

			// Reset per-cell scrolling override when outputs change (clear or re-run)
			this._outputScrolling.set(undefined, undefined);
		}));

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

	override get outputsViewModels(): IPositronCellOutputViewModel[] {
		return this._outputs.get();
	}

	override get outputs() {
		return this._outputs;
	}

	get outputIsCollapsed(): ISettableObservable<boolean> {
		return this._outputIsCollapsed;
	}

	collapseOutput(): void {
		this._outputIsCollapsed.set(true, undefined);
	}

	expandOutput(): void {
		this._outputIsCollapsed.set(false, undefined);
	}

	toggleOutputCollapse(): void {
		this._outputIsCollapsed.set(!this._outputIsCollapsed.get(), undefined);
	}

	get outputScrolling(): ISettableObservable<boolean | undefined> {
		return this._outputScrolling;
	}

	truncateOutput(): void {
		this._outputScrolling.set(false, undefined);
	}

	showFullOutput(): void {
		this._outputScrolling.set(true, undefined);
	}

	resetOutputScrolling(): void {
		this._outputScrolling.set(undefined, undefined);
	}

	/**
	 * Turn the cell outputs into an array of NotebookCellOutputs objects that we know how to render
	 * @returns Output list with a prefered output item parsed for rendering
	 */
	parseCellOutputs(): NotebookCellOutputs[] {
		const parsedOutputs: NotebookCellOutputs[] = [];

		this.model.outputs.forEach((output) => {
			const outputItems = output.outputs || [];
			const preferredOutputItem = pickPreferredOutputItem(outputItems);
			if (!preferredOutputItem) {
				return;
			}

			let parsed = parseOutputData(preferredOutputItem);
			let preloadMessageResult: NotebookCellOutputs['preloadMessageResult'];
			const removeRawHtmlOutput = () => this._webviewPreloadService.removeRawHtmlOutput({
				instance: this.instance,
				outputId: output.outputId,
			});

			const preloadMessageType = getWebviewMessageType(outputItems);

			if (preloadMessageType) {
				removeRawHtmlOutput();
				preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this.instance,
					outputId: output.outputId,
					outputs: outputItems,
				});

				// Don't add widget outputs when there's no session available.
				if (preloadMessageResult === undefined) {
					return;
				}
			}

			// Complex HTML (scripts, iframes, full documents) can't render inline
			// due to Trusted Types / CSP restrictions. Route through an overlay
			// webview where scripts execute in an isolated process.
			// Only do this in trusted workspaces. In Restricted Mode, block the
			// complex output entirely instead of falling through to inline HTML.
			if (!preloadMessageType && preferredOutputItem.mime === 'text/html') {
				const htmlContent = preferredOutputItem.data.toString();
				if (isComplexHtml(htmlContent)) {
					if (this._workspaceTrustManagementService.isWorkspaceTrusted()) {
						preloadMessageResult = this._webviewPreloadService.addRawHtmlOutput({
							instance: this.instance,
							outputId: output.outputId,
							html: htmlContent,
						});
					} else {
						removeRawHtmlOutput();
						parsed = { type: 'htmlBlocked' };
					}
				} else {
					removeRawHtmlOutput();
				}
			} else {
				removeRawHtmlOutput();
			}

			parsedOutputs.push({
				outputId: output.outputId,
				outputs: outputItems,
				parsed,
				preloadMessageResult,
			});
		});

		return parsedOutputs;
	}


	override run(): void {
		this._instance.runCells([this]);
	}
}


