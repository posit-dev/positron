/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellOutputTextModel } from '../../notebook/common/model/notebookCellOutputTextModel.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { ICellOutput } from '../../notebook/common/notebookCommon.js';
import { ParsedOutput, ParsedTextOutput } from '../../../services/positronNotebook/browser/IPositronNotebookCell.js';

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
 * The MIME types we know how to render in-house.
 */
export type OutputMimeTypes = |
	'application/vnd.code.notebook.stdout' |
	'application/vnd.code.notebook.stderr' |
	'application/vnd.code.notebook.error';

/**
 * The MIME types we know how to render in-house.
 */
export const outputMimeTypes: string[] = [
	'application/vnd.code.notebook.stdout',
	'application/vnd.code.notebook.stderr',
	'application/vnd.code.notebook.error'
] satisfies OutputMimeTypes[];

export function isKnownMimeType(mimeType: string): mimeType is OutputMimeTypes {
	return outputMimeTypes.includes(mimeType);
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
	return output.outputs.map(({ data, mime }) => {
		return outputMimeTypes.includes(mime) ? data.toString() : `Cant handle mime type yet: ${mime}`;
	}).join('\n');
}


const textOutputTypes: ParsedTextOutput['type'][] = ['stdout', 'text', 'stderr', 'error'];

export function isParsedTextOutput(output: ParsedOutput): output is ParsedTextOutput {
	return (textOutputTypes as string[]).includes(output.type);
}

/**
 * Parse cell output into standard serializable js objects.
 * @param output Contents of a cells output
 * @returns The output parsed to the known types.
 */
export function parseOutputData(output: ICellOutput['outputs'][number]): ParsedOutput {
	const { data, mime } = output;
	const message = data.toString();

	try {
		const parsedMessage = JSON.parse(message);

		if (parsedMessage?.name === 'KeyboardInterrupt') {
			return { type: 'interupt', trace: parsedMessage.traceback };
		}

		if (parsedMessage?.name === 'Runtime Error') {
			return { type: 'error', content: parsedMessage.message };
		}

		if (mime === 'application/vnd.code.notebook.error') {
			return { type: 'error', content: parsedMessage.stack };
		}

	} catch (e) {
	}

	if (mime === 'application/vnd.code.notebook.stdout') {
		return { type: 'stdout', content: message };
	}

	if (mime === 'application/vnd.code.notebook.stderr') {
		return { type: 'stderr', content: message };
	}

	if (mime === 'text/plain') {
		return { type: 'text', content: message };
	}

	if (mime === 'image/png') {
		return {
			type: 'image',
			dataUrl: `data:image/png;base64,${uint8ToBase64(data.buffer)}`
		};
	}

	return { type: 'unknown', contents: message };
}


/**
 * Convert a Uint8Array to a base64 encoded string.
 * @param u8 Uint8Array to convert to base64
 * @returns The base64 encoded string
 */
function uint8ToBase64(u8: Uint8Array) {
	const output = new Array(u8.length);

	for (let i = 0, length = u8.length; i < length; i++) {
		output[i] = String.fromCharCode(u8[i]);
	}

	// btoa() is deprecated but there doesn't seem to be a better way to do this
	return btoa(output.join(''));
}
