/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellKind, ICellDto2, NotebookData } from '../../notebook/common/notebookCommon.js';
import { CellMetadataWithQuarto } from './quartoNotebookTypes.js';

/** HTML comment used to mark cell boundaries between consecutive markdown cells */
const CELL_BOUNDARY_MARKER = '<!-- cell -->';

/** Serialize notebook cells QMD text. */
export function notebookToQmd(notebook: NotebookData): string {
	const { cells } = notebook;
	if (cells.length === 0) {
		return '';
	}

	const parts: string[] = [];
	let startIndex = 0;

	if (isFrontmatterCell(cells[0])) {
		parts.push(cells[0].source);
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
			parts.push(codeCellToQmd(cell));
			prevWasMarkdown = false;
		}
	}

	return parts.join('\n\n') + '\n';
}

/** Serialize a code cell. */
function codeCellToQmd(cell: ICellDto2): string {
	const { source, language } = cell;
	const fenceInfo = language ? `{${language}}` : '';
	return `\`\`\`${fenceInfo}
${source}
\`\`\``;
}

/** Type guard for cells with Quarto metadata */
function hasQuartoMetadata(meta: Record<string, unknown> | undefined): meta is CellMetadataWithQuarto {
	return meta !== null && typeof meta === 'object' && 'quarto' in meta;
}

/** Check if cell metadata indicates a YAML frontmatter cell */
export function isFrontmatterCell({ metadata }: ICellDto2): boolean {
	return hasQuartoMetadata(metadata) && metadata.quarto.type === 'frontmatter';
}
