/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	INLINE_GRID_COLUMN_HEADERS_HEIGHT,
	INLINE_GRID_DEFAULT_ROW_HEIGHT,
	INLINE_GRID_SCROLLBAR_THICKNESS,
} from '../../../services/positronDataExplorer/browser/inlineTableDataGridInstance.js';

// CSS-derived constants. If you change these, update InlineDataExplorer.css to match:
//   TOOLBAR_HEIGHT  = .inline-data-explorer-header height (24px) + border-bottom (1px) + padding (1px)
//   BORDER          = .inline-data-explorer-container border (1px top + 1px bottom)
const TOOLBAR_HEIGHT = 26;
const BORDER = 2;

/**
 * Calculate the pixel height for a Quarto inline data explorer given the row
 * count and a configured maximum height. Both the view-zone pre-allocation
 * (quartoOutputViewZone.ts) and the React component
 * (quartoInlineDataExplorer.tsx) must agree on this value so the view zone
 * is sized correctly before React renders.
 */
export function calculateInlineDataExplorerHeight(rowCount: number, maxHeight: number): number {
	const naturalHeight =
		TOOLBAR_HEIGHT +
		INLINE_GRID_COLUMN_HEADERS_HEIGHT +
		(rowCount * INLINE_GRID_DEFAULT_ROW_HEIGHT) +
		INLINE_GRID_SCROLLBAR_THICKNESS +
		BORDER;
	return Math.min(naturalHeight, maxHeight);
}
