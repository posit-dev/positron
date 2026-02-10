/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Cell metadata with Quarto-specific properties */
export interface CellMetadataWithQuarto {
	quarto: QuartoCellMetadata;
	[key: string]: unknown;
}

/** Quarto-specific cell metadata stored on NotebookCellData */
export interface QuartoCellMetadata {
	/** Cell type discriminator */
	type?: 'frontmatter';
}
