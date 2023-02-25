/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';

/**
 * OutputLine interface.
 */
export interface OutputLine {
	id: string;
	text: string;
}

/**
 * Splits a string or array of strings into an OutputLine array.
 * @param value The string or array of strings.
 * @returns An OutputLine array.
 */
export const outputLineSplitter = (value: string | string[]): OutputLine[] => {
	// If an array was supplied, recursively split each string. Otherwise,
	// split the string.
	const outputLines: OutputLine[] = [];
	if (Array.isArray(value)) {
		value.forEach(line => {
			outputLines.push(...outputLineSplitter(line));
		});
	} else {
		value.split('\n').forEach((line, index, splitLines) => {
			if (!(splitLines.length > 1 && index === splitLines.length - 1 && line.length === 0)) {
				outputLines.push({ id: generateUuid(), text: line });
			}
		});
	}

	// Done. Return the output lines.
	return outputLines;
};
