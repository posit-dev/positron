/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotebookCellOutputItem } from './IPositronNotebookCell.js';
import { isDataExplorerMimeType } from '../getOutputContents.js';

/**
 * Options for getting MIME type priority
 */
interface MimeTypePriorityOptions {
	/** Skip the inline data explorer MIME type (treat as unknown) */
	skipDataExplorer?: boolean;
}

/**
 * Get the priority of a mime type for sorting purposes
 * @param mime The mime type to get the priority of
 * @param options Optional settings for MIME type handling
 * @returns A number representing the priority of the mime type. Lower numbers are higher priority.
 */
function getMimeTypePriority(mime: string, options?: MimeTypePriorityOptions): number | null {
	// Positron inline data explorer has highest priority (if not skipped)
	if (isDataExplorerMimeType(mime)) {
		if (options?.skipDataExplorer) {
			return null; // Treat as unknown, will fall back to HTML
		}
		return 0;
	}

	if (mime.includes('application')) {
		return 1;
	}

	switch (mime) {
		case 'text/html':
			return 2;
		case 'text/markdown':
			return 2.5;
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
 * Options for picking preferred output
 */
export interface PickPreferredOutputOptions {
	/** Skip the inline data explorer MIME type (will fall back to HTML) */
	skipDataExplorer?: boolean;
	/** Function to log warnings */
	logWarning?: (msg: string) => void;
}

/**
 * Pick the output item with the highest priority mime type from a cell output object
 * @param outputItems Array of outputs items data from a cell output object
 * @param options Options for output selection
 * @returns The output item with the highest priority mime type. If there's a tie, the first one is
 * returned. If there's an unknown mime type we defer to ones we do know about.
 */
export function pickPreferredOutputItem(outputItems: NotebookCellOutputItem[], options?: PickPreferredOutputOptions): NotebookCellOutputItem | undefined {

	if (outputItems.length === 0) {
		return undefined;
	}

	let highestPriority: number | null = null;
	let preferredOutput = outputItems[0];

	for (const item of outputItems) {
		const priority = getMimeTypePriority(item.mime, {
			skipDataExplorer: options?.skipDataExplorer
		});

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
		options?.logWarning?.('Could not determine preferred output for notebook cell with mime types' +
			outputItems.map(item => item.mime).join(', ')
		);
	}

	return preferredOutput;
}
