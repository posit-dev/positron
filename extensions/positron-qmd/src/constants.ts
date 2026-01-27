/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** HTML comment used to mark cell boundaries between consecutive markdown cells */
export const CELL_BOUNDARY_MARKER = '<!-- cell -->';

/** Regex to match cell boundary markers with surrounding whitespace */
export const CELL_MARKER_REGEX = /\s*<!-- cell -->\s*/;

/** Map Quarto language identifiers to VS Code language IDs */
export const QUARTO_TO_VSCODE_LANGUAGE: Record<string, string> = {
	'ojs': 'javascript',
};

/** Map VS Code language IDs to Quarto language identifiers */
export const VSCODE_TO_QUARTO_LANGUAGE: Record<string, string> = Object.fromEntries(
	Object.entries(QUARTO_TO_VSCODE_LANGUAGE).map(([k, v]) => [v, k])
);

/** Default number of backticks in a code fence */
export const DEFAULT_FENCE_LENGTH = 3;
