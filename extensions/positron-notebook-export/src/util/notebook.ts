/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * Try to determine the language of a notebook by inspecting its metadata and cells.
 * @param notebook The notebook document to inspect.
 * @returns The language ID of the notebook, or `undefined` if it cannot be determined.
 */
export function getNotebookLanguage(notebook: vscode.NotebookDocument): string | undefined {
	// First try the notebook metadata.
	// eslint-disable-next-line local/code-no-any-casts
	const metadata = notebook.metadata?.metadata as any;
	const languageId = metadata?.language_info?.name ?? metadata?.kernelspec?.language;
	if (languageId &&
		languageId !== 'raw' &&
		languageId !== 'plaintext'
	) {
		return languageId;
	}

	// Fall back to the first cell's language, if available.
	for (const cell of notebook.getCells()) {
		if (cell.kind === vscode.NotebookCellKind.Code &&
			cell.document.languageId !== 'raw' &&
			cell.document.languageId !== 'plaintext') {
			return cell.document.languageId;
		}
	}

	// Could not determine the notebook's language.
	return undefined;
}
