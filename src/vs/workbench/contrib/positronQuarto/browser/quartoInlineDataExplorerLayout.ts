/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInlineGridMetrics } from '../../../services/positronDataExplorer/browser/inlineGridMetrics.js';

// CSS-derived constants. If you change these, update InlineDataExplorer.css to match:
//   TOOLBAR_HEIGHT  = .inline-data-explorer-header height (24px) + border-bottom (1px) + padding (1px)
//   BORDER          = .inline-data-explorer-container border (1px top + 1px bottom)
// The header uses the fixed workbench font (see quartoInlineDataExplorer.css),
// so unlike the grid metrics it does not scale with the editor font.
const TOOLBAR_HEIGHT = 26;
const BORDER = 2;

/**
 * Calculate the pixel height for a Quarto inline data explorer given the row
 * count, a configured maximum height, and the font-scaled grid metrics. Both
 * the view-zone pre-allocation (quartoOutputViewZone.ts) and the React
 * component (quartoInlineDataExplorer.tsx) must agree on this value so the
 * view zone is sized correctly before React renders.
 */
export function calculateInlineDataExplorerHeight(
	rowCount: number,
	maxHeight: number,
	metrics: IInlineGridMetrics
): number {
	const naturalHeight =
		TOOLBAR_HEIGHT +
		metrics.columnHeadersHeight +
		(rowCount * metrics.defaultRowHeight) +
		metrics.scrollbarThickness +
		BORDER;
	return Math.min(naturalHeight, maxHeight);
}
