/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellKind } from '../../../../notebook/common/notebookCommon.js';
import { IPositronNotebookInstance } from '../../IPositronNotebookInstance.js';
import { PositronNotebookCodeCell } from '../../PositronNotebookCells/PositronNotebookCodeCell.js';
import { CodeSnippet, codeSnippetToCellSource } from './generateVizCode.js';

export type InsertMode = 'newCell' | 'append';

/**
 * Heuristic: returns true when every line of the import block already appears
 * as its own line in the cell. Line-anchored to avoid matching a prefix of
 * a longer import (e.g. `import pandas` should not match `import pandas as pd`).
 * Misses formatting variations like `import x as y` vs `import x`; if a
 * stricter check is needed, replace this with an AST-based pass.
 */
export function hasImportsVerbatim(existing: string, imports: string): boolean {
	const existingLines = new Set(existing.split('\n').map(l => l.trim()).filter(Boolean));
	const importLines = imports.split('\n').map(l => l.trim()).filter(Boolean);
	return importLines.every(line => existingLines.has(line));
}

/**
 * Build the text to append to an existing cell. Prepends the imports if they
 * don't already appear verbatim, otherwise just adds the body.
 */
export function buildAppendText(existing: string, snippet: CodeSnippet): string {
	if (hasImportsVerbatim(existing, snippet.imports)) {
		return `\n\n${snippet.body}\n`;
	}
	return `\n\n${snippet.imports}\n\n${snippet.body}\n`;
}

/**
 * Apply a visualize result to the source cell. Inserts a new code cell below
 * the source cell, or appends the generated code to it, depending on the
 * chosen mode.
 */
export async function applyVisualizeResult(
	notebookInstance: IPositronNotebookInstance,
	cell: PositronNotebookCodeCell,
	snippet: CodeSnippet,
	mode: InsertMode,
): Promise<void> {
	if (mode === 'newCell') {
		notebookInstance.addCell(
			CellKind.Code,
			cell.index + 1,
			false,
			codeSnippetToCellSource(snippet),
			cell.model.language,
		);
		return;
	}

	const textModel = await cell.getTextEditorModel();
	const lineCount = textModel.getLineCount();
	const endCol = textModel.getLineMaxColumn(lineCount);
	const existing = textModel.getValue();
	const toAppend = buildAppendText(existing, snippet);
	// pushEditOperations (rather than applyEdits) so the user can Undo the
	// append in a single step.
	textModel.pushEditOperations(
		null,
		[{
			range: {
				startLineNumber: lineCount,
				startColumn: endCol,
				endLineNumber: lineCount,
				endColumn: endCol,
			},
			text: toAppend,
		}],
		() => null,
	);
}
