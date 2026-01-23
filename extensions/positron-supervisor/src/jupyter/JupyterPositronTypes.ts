/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export interface JupyterPositronLocation {
	uri: string;
	range: JupyterPositronRange;
}

export interface JupyterPositronRange {
	start: JupyterPositronPosition;
	end: JupyterPositronPosition;
}

/**
 * A position in a document for Jupyter/kernel communication.
 *
 * Note: Unlike VS Code positions which use UTF-16 code units, and unlike the
 * Jupyter protocol which uses unicode code points, we use UTF-8 byte offsets
 * for `character`. This is the only representation that is not lossy when you
 * don't have access to the whole line (e.g. with a partial line selection).
 *
 * The conversion from UTF-16 to UTF-8 byte offsets happens at the source where
 * the document text is available, since this conversion is lossy without the
 * actual text.
 */
export interface JupyterPositronPosition {
	/** 0-based line number */
	line: number;
	/** 0-based column offset in UTF-8 bytes */
	character: number;
}
