/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISettableObservable, observableValue } from 'vs/base/common/observable';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { parseOutputData } from 'vs/workbench/contrib/positronNotebook/browser/getOutputContents';
import { PositronNotebookCellGeneral } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookCell';
import { PositronNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/PositronNotebookInstance';
import { IPositronNotebookCodeCell, NotebookCellOutputItem, NotebookCellOutputs } from 'vs/workbench/services/positronNotebook/browser/IPositronNotebookCell';



export class PositronNotebookCodeCell extends PositronNotebookCellGeneral implements IPositronNotebookCodeCell {
	override kind: CellKind.Code = CellKind.Code;
	outputs: ISettableObservable<NotebookCellOutputs[]>;

	constructor(
		cellModel: NotebookCellTextModel,
		instance: PositronNotebookInstance,
		textModelResolverService: ITextModelService
	) {
		super(cellModel, instance, textModelResolverService);

		this.outputs = observableValue<NotebookCellOutputs[], void>('cellOutputs', parseCellOutputs(this.cellModel.outputs));

		// Listen for changes to the cell outputs and update the observable
		this._register(
			this.cellModel.onDidChangeOutputs(() => {
				// By unpacking the array and repacking we make sure that
				// the React component will rerender when the outputs change. Probably not
				// great to have this leak here.
				this.outputs.set(parseCellOutputs(this.cellModel.outputs), undefined);
			})
		);
	}

	override run(): void {
		this._instance.runCells([this]);
	}
}

/**
 * Turn the cell outputs into an array of NotebookCellOutputs objects that we know how to render
 * @param outputList The list of cell outputs to parse from the cell model
 * @returns Output list with a prefered output item parsed for rendering
 */
function parseCellOutputs(outputList: ICellOutput[]): NotebookCellOutputs[] {

	const toReturn: NotebookCellOutputs[] = [];

	outputList.forEach(({ outputs, outputId }) => {

		const preferredOutput = pickPreferredOutputItem(outputs);
		if (!preferredOutput) {
			return;
		}

		const parsed = parseOutputData(preferredOutput);

		toReturn.push({
			outputId,
			outputs,
			parsed
		});
	});

	return toReturn;
}
/**
 * Get the priority of a mime type for sorting purposes
 * @param mime The mime type to get the priority of
 * @returns A number representing the priority of the mime type. Lower numbers are higher priority.
 */
function getMimeTypePriority(mime: string): number | null {
	if (mime.includes('application')) {
		return 1;
	}

	switch (mime) {
		case 'text/html':
			return 2;
		case 'image/png':
			return 3;
		case 'text/plain':
			return 4;
		default:
			// Dont know what this is, so mark it as special so we know something went wrong
			return null;
	}
}




/**
 * Pick the output item with the highest priority mime type from a cell output object
 * @param outputItems Array of outputs items data from a cell output object
 * @returns The output item with the highest priority mime type. If there's a tie, the first one is
 * returned. If there's an unknown mime type we defer to ones we do know about.
 */
function pickPreferredOutputItem(outputItems: NotebookCellOutputItem[], logWarning?: (msg: string) => void): NotebookCellOutputItem | undefined {

	if (outputItems.length === 0) {
		return undefined;
	}

	let highestPriority: number | null = null;
	let preferredOutput = outputItems[0];

	for (const item of outputItems) {
		const priority = getMimeTypePriority(item.mime);

		// If we don't know how to render any of the mime types, we'll return the first one and hope
		// for the best!
		if (priority === null) {
			continue;
		}

		if (priority < (highestPriority ?? Infinity)) {
			preferredOutput = item;
			highestPriority = priority;
		}
	}

	if (highestPriority === null) {
		logWarning?.('Could not determine preferred output for notebook cell with mime types' +
			outputItems.map(item => item.mime).join(', ')
		);
	}

	return preferredOutput;
}
