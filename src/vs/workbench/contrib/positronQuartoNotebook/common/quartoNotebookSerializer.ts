/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';

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

/** Type guard for cells with Quarto metadata */
function hasQuartoMetadata(meta: Record<string, unknown> | undefined): meta is CellMetadataWithQuarto {
	return meta !== null && typeof meta === 'object' && 'quarto' in meta;
}

/** Check if cell metadata indicates a YAML frontmatter cell */
export function isFrontmatterCell(meta: Record<string, unknown> | undefined): boolean {
	return hasQuartoMetadata(meta) && meta.quarto.type === 'frontmatter';
}

/** Get the code fence length for a cell, if specified in metadata */
function getFenceLength(meta: Record<string, unknown> | undefined): number | undefined {
	return hasQuartoMetadata(meta) ? meta.quarto.fenceLength : undefined;
}

// --- Cell metadata types ---

/** Cell metadata with Quarto-specific properties */
export interface CellMetadataWithQuarto {
	quarto: QuartoCellMetadata;
	[key: string]: unknown;
}

/** Quarto-specific cell metadata stored on NotebookCellData */
export interface QuartoCellMetadata {
	/** Cell type discriminator */
	type?: 'frontmatter';
	/** Code fence length (only stored when > 3) */
	fenceLength?: number;
}

// --- Defaults ---

/** Default number of backticks in a code fence */
export const DEFAULT_FENCE_LENGTH = 3;

// --- Language mappings ---

/** Map Quarto language identifiers to VS Code language IDs */
export const QUARTO_TO_VSCODE_LANGUAGE: Record<string, string> = {
	'ojs': 'javascript',
};

/** Map VS Code language IDs to Quarto language identifiers */
export const VSCODE_TO_QUARTO_LANGUAGE: Record<string, string> = Object.fromEntries(
	Object.entries(QUARTO_TO_VSCODE_LANGUAGE).map(([k, v]) => [v, k])
);

// --- Cell boundary markers ---

/** HTML comment used to mark cell boundaries between consecutive markdown cells */
export const CELL_BOUNDARY_MARKER = '<!-- cell -->';

