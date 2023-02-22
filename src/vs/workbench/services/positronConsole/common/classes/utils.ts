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
 * Splits a text string into lines.
 * @param text The text string to split.
 * @returns An array of the lines.
 */
export const lineSplitter = (text: string): readonly Line[] => {
	const lines: Line[] = [];

	text.split('\n').forEach((text, index, textLines) => {
		if (!(textLines.length > 1 && index === textLines.length - 1 && text.length === 0)) {
			lines.push({ id: generateUuid(), text });
		}
	});

	return lines;
};
