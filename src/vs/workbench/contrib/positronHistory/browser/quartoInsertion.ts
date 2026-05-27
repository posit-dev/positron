/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Build the text to insert when creating a new Quarto code cell at the end of
 * the cursor's line. The leading and trailing newlines are chosen so the new
 * cell is always separated from surrounding content by exactly one blank line.
 *
 * @param code The code content to place inside the cell.
 * @param language The cell language id (e.g. 'r', 'python').
 * @param currentLineEmpty True if the cursor's line has no non-whitespace content.
 * @param nextLineEmpty True if the line after the cursor is empty or there is no next line.
 */
export function buildQuartoCellInsertion(
	code: string,
	language: string,
	currentLineEmpty: boolean,
	nextLineEmpty: boolean,
): string {
	const leading = currentLineEmpty ? '\n' : '\n\n';
	const trailing = nextLineEmpty ? '\n' : '\n\n';
	return `${leading}\`\`\`{${language}}\n${code}\n\`\`\`${trailing}`;
}
