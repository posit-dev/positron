/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { ICellOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';

type CellOutputInfo = { id: string; content: string };

/**
 * Traverse through all the outputs for a given notebook cell and gather their info into an
 * array of simple objects.
 * @param cell A notebook cell
 * @returns An array of objects containing the output id and the output contents
 */
export function gatherOutputContents(cell: NotebookCellTextModel): CellOutputInfo[] {
	return cell.outputs
		.map(output => (
			{
				id: output.outputId,
				content: getOutputContents(output)

			}
		));
}

/**
 * Display the contents of a notebook cell output.
 *
 * This function will be expanded to handle more output types as they are added to the notebook.
 * Currently only supports text output.
 * @param output An output of a notebook cell
 * @returns The contents of the output for display
 */
function getOutputContents(output: ICellOutput): string {

	if (output instanceof NotebookCellOutputTextModel) {
		return getTextOutputContents(output);
	}

	return `Cant handle output type yet: OutputId: ${output.outputId}`;
}
/**
 * Get the contents of a text output as a string
 * @param output An output object of type NotebookCellOutputTextModel
 * @returns The text contents of the output concatenated together with newlines
 */
function getTextOutputContents(output: NotebookCellOutputTextModel): string {
	return output.outputs.map(({ data }) => data.toString()).join('\n');
}
