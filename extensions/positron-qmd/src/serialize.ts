/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

const CELL_BOUNDARY_MARKER = '<!-- cell -->';

const VSCODE_TO_QUARTO_MAP: Record<string, string> = {
	'python': 'python',
	'r': 'r',
	'julia': 'julia',
	'javascript': 'ojs',
	'mermaid': 'mermaid',
	'dot': 'dot',
};

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

function serializeCodeCell(cell: vscode.NotebookCellData): string {
	const language = cell.languageId;
	const code = cell.value;

	const qmdFenceInfo = cell.metadata?.qmdFenceInfo as string | undefined;
	if (qmdFenceInfo) {
		return '```' + qmdFenceInfo + '\n' + code + '\n```';
	}

	const quartoLang = VSCODE_TO_QUARTO_MAP[language] || language;
	const fenceInfo = quartoLang ? `{${quartoLang}}` : '';

	return '```' + fenceInfo + '\n' + code + '\n```';
}
