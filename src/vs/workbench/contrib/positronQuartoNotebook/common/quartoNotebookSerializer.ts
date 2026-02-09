/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';
import {
	CELL_BOUNDARY_MARKER,
	DEFAULT_FENCE_LENGTH,
	VSCODE_TO_QUARTO_LANGUAGE,
	isFrontmatterCell,
	getFenceLength,
} from '../../positronQuarto/common/quartoConstants.js';

/**
 * Serialize notebook cells back to QMD text.
 */
export function serializeNotebookCells(cells: ICellDto2[]): string {
	const parts: string[] = [];
	let startIndex = 0;

	// Handle frontmatter
	if (cells.length > 0 && isFrontmatterCell(cells[0].metadata)) {
		const content = cells[0].source.trim();
		if (content) {
			parts.push(content);
		}
		startIndex = 1;
	}

	let prevWasMarkdown = false;

	for (let i = startIndex; i < cells.length; i++) {
		const cell = cells[i];

		if (cell.cellKind === CellKind.Markup) {
			if (prevWasMarkdown) {
				parts.push(CELL_BOUNDARY_MARKER);
			}
			parts.push(cell.source);
			prevWasMarkdown = true;
		} else {
			parts.push(serializeCodeCell(cell));
			prevWasMarkdown = false;
		}
	}

	return parts.join('\n\n') + '\n';
}

/**
 * Serialize a single code cell to a fenced code block.
 */
function serializeCodeCell(cell: ICellDto2): string {
	const code = cell.source;
	const language = cell.language;
	const quartoLang = VSCODE_TO_QUARTO_LANGUAGE[language] || language;
	const fenceInfo = quartoLang ? `{${quartoLang}}` : '';
	const fenceLength = getFenceLength(cell.metadata) ?? DEFAULT_FENCE_LENGTH;
	const fence = '`'.repeat(fenceLength);

	return fence + fenceInfo + '\n' + code + '\n' + fence;
}
