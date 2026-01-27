/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { CELL_BOUNDARY_MARKER, VSCODE_TO_QUARTO_LANGUAGE } from './constants.js';

/** Convert VS Code NotebookData to QMD string */
export function serialize(data: vscode.NotebookData): string {
	const parts: string[] = [];
	let cellIndex = 0;

	const firstCell = data.cells[0];
	if (firstCell?.metadata?.qmdCellType === 'frontmatter') {
		const content = firstCell.value.trim();
		if (content) {
			parts.push(content);
		}
		cellIndex = 1;
	}

	let prevCellWasMarkdown = false;

	for (let i = cellIndex; i < data.cells.length; i++) {
		const cell = data.cells[i];

		if (cell.kind === vscode.NotebookCellKind.Markup && !cell.value.trim()) {
			continue;
		}

		if (cell.kind === vscode.NotebookCellKind.Markup) {
			if (prevCellWasMarkdown) {
				parts.push(CELL_BOUNDARY_MARKER);
			}
			parts.push(cell.value);
			prevCellWasMarkdown = true;
		} else {
			parts.push(serializeCodeCell(cell));
			prevCellWasMarkdown = false;
		}
	}

	return parts.join('\n\n') + '\n';
}

/** Serialize code cell to fenced code block */
function serializeCodeCell(cell: vscode.NotebookCellData): string {
	const code = cell.value;
	const language = cell.languageId;
	const quartoLang = VSCODE_TO_QUARTO_LANGUAGE[language] || language;
	const fenceInfo = quartoLang ? `{${quartoLang}}` : '';

	return '```' + fenceInfo + '\n' + code + '\n```';
}
