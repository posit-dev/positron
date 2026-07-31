/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
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
import { htmlRenderMode, resolvePreferredOutputItem } from './notebookOutputUtils.js';
import { getWebviewMessageType } from '../../../../services/positronIPyWidgets/common/webviewPreloadUtils.js';
import { INotebookExecutionStateService } from '../../../notebook/common/notebookExecutionStateService.js';
import { INotebookService } from '../../../notebook/common/notebookService.js';
import { IPositronCellOutputViewModel } from '../IPositronNotebookEditor.js';

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
		instance: PositronNotebookInstance,
		@INotebookExecutionStateService _executionStateService: INotebookExecutionStateService,
		@ITextModelService _textModelService: ITextModelService,
		@IPositronWebviewPreloadService private _webviewPreloadService: IPositronWebviewPreloadService,
		@INotebookService private _notebookService: INotebookService,
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

		this._outputs = observableFromEvent(this, Event.any(this.model.onDidChangeOutputs, this.model.onDidChangeOutputItems), () => {
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

	toggleOutputScroll(): void {
		const effective = this._outputScrolling.get()
			?? this._instance.notebookOptions.getLayoutConfiguration().outputScrolling;
		this._outputScrolling.set(!effective, undefined);
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

			// Order the output's mime types by the notebook renderer registry --
			// the same machinery the upstream editor uses -- so the preferred
			// item is picked with renderer availability in mind. The view type
			// is deliberately undefined: it only scopes the legacy editor's
			// per-notebook-type renderer preferences, which Positron notebooks
			// don't use (same as INotebookService.getPreferredRenderer).
			const orderedMimeTypes = this._notebookService.getMimeTypeInfo(
				undefined,
				undefined,
				outputItems.map(item => item.mime),
			);
			const preferredOutput = resolvePreferredOutputItem(outputItems, orderedMimeTypes);
			if (!preferredOutput) {
				return;
			}
			const preferredOutputItem = preferredOutput.item;

			const parsedOutput: NotebookCellOutputs = {
				outputId: output.outputId,
				outputs: outputItems,
				parsed: parseOutputData(preferredOutputItem, output.metadata),
			};

			const preloadMessageType = getWebviewMessageType(outputItems);
			const rawOutput = preferredOutputItem.data.toString();

			if (preloadMessageType) {
				parsedOutput.preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this._instance,
					outputId: output.outputId,
					outputs: outputItems,
				});

				// Don't add widget outputs when there's no session available.
				if (parsedOutput.preloadMessageResult === undefined) {
					return;
				}
			} else if (preferredOutput.rendererId) {
				// A registered notebook renderer extension can render this
				// output; host it in the shared renderer-runtime webview (the
				// generic fallback for mime types we don't render natively).
				parsedOutput.preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this._instance,
					outputId: output.outputId,
					outputs: outputItems,
					rendererMime: preferredOutputItem.mime,
				});
			} else if (preferredOutputItem.mime === 'text/html' && htmlRenderMode(rawOutput) === 'webview') {
				// Route complex HTML (iframe, script) to a sandboxed webview. Inert full
				// documents (e.g. Great Tables) fall through and render inline.
				parsedOutput.preloadMessageResult = this._webviewPreloadService.addNotebookOutput({
					instance: this._instance,
					outputId: output.outputId,
					outputs: outputItems,
					rawHtml: rawOutput,
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




