/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';

/**
 * Line interface.
 */
export interface Line {
	id: string;
	text: string;
}

/**
 * Splits a string or array of strings into lines.
 * @param value The string or array of strings.
 * @returns An array of the lines.
 */
export const lineSplitter = (value: string | string[]): Line[] => {
	// If an array of lines was supplied, process and split them. Otherwise,
	// split the string that was presented into lines.
	const lines: Line[] = [];
	if (Array.isArray(value)) {
		value.forEach(line => {
			lines.push(...lineSplitter(line));
		});
	} else {
		value.split('\n').forEach((line, index, splitLines) => {
			if (!(splitLines.length > 1 && index === splitLines.length - 1 && line.length === 0)) {
				lines.push({ id: generateUuid(), text: line });
			}
		});
	}

	// Done. Return the lines.
	return lines;
};
