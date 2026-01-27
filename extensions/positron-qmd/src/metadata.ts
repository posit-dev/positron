/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/** Quarto-specific cell metadata */
export interface QuartoCellMetadata {
	/** Cell type discriminator */
	type?: 'frontmatter';
	/** Code fence length (only stored when > 3) */
	fenceLength?: number;
}

type CellMetadata = { [key: string]: any };

/** Cell metadata with Quarto-specific properties */
export interface CellMetadataWithQuarto extends CellMetadata {
	quarto: QuartoCellMetadata;
}

/** Type guard for cells with Quarto metadata */
export function hasQuartoMetadata(meta: CellMetadata | undefined): meta is CellMetadataWithQuarto {
	return meta !== null && typeof meta === 'object' && 'quarto' in meta;
}

/** Check if cell is a YAML frontmatter cell */
export function isFrontmatterCell(cell: vscode.NotebookCellData): boolean {
	return hasQuartoMetadata(cell.metadata) && cell.metadata.quarto.type === 'frontmatter';
}

/** Get the code fence length for a cell, if specified */
export function getFenceLength(cell: vscode.NotebookCellData): number | undefined {
	if (hasQuartoMetadata(cell.metadata)) {
		return cell.metadata.quarto.fenceLength;
	}
	return undefined;
}
