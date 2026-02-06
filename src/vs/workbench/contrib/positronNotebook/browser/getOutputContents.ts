/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { encodeBase64, VSBuffer } from '../../../../base/common/buffer.js';
import { localize } from '../../../../nls.js';
import { NotebookCellOutputTextModel } from '../../notebook/common/model/notebookCellOutputTextModel.js';
import { NotebookCellTextModel } from '../../notebook/common/model/notebookCellTextModel.js';
import { ICellOutput, IOutputItemDto } from '../../notebook/common/notebookCommon.js';
import { ParsedDataExplorerOutput, ParsedOutput, ParsedTextOutput } from './PositronNotebookCells/IPositronNotebookCell.js';

/**
 * MIME type for Positron inline data explorer
 */
export const DATA_EXPLORER_MIME_TYPE = 'application/vnd.positron.dataExplorer+json';

/**
 * Case-insensitive check for the data explorer MIME type. Needed because
 * MIME types are case-insensitive per RFC 2045, and VS Code's
 * normalizeMimeType lowercases the type/subtype when loading notebooks from
 * disk, while live kernel execution preserves the original casing.
 */
export function isDataExplorerMimeType(mime: string): boolean {
	return mime.toLowerCase() === DATA_EXPLORER_MIME_TYPE.toLowerCase();
}

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
 * @param outputItem Contents of a cells output
 * @returns The output parsed to the known types.
 */
export function parseOutputData(outputItem: IOutputItemDto): ParsedOutput {
	const { data, mime } = outputItem;
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

	// Handle Positron inline data explorer MIME type
	if (isDataExplorerMimeType(mime)) {
		try {
			const payload = JSON.parse(message);
			return {
				type: 'dataExplorer',
				commId: payload.comm_id,
				shape: payload.shape,
				title: payload.title,
				version: payload.version,
				source: payload.source,
			} satisfies ParsedDataExplorerOutput;
		} catch {
			// Fall through to unknown if parsing fails
		}
	}

	if (mime === 'text/html') {
		return { type: 'html', content: message };
	}

	if (mime === 'text/markdown') {
		return { type: 'markdown', content: message };
	}

	if (mime === 'image/png') {
		return {
			type: 'image',
			dataUrl: `data:image/png;base64,${encodeBase64(VSBuffer.wrap(data.buffer))}`
		};
	}

	return {
		type: 'unknown',
		content: localize('cellExecutionUnknownMimeType', 'Can\'t handle mime type "{0}" yet', mime)
	};
}
