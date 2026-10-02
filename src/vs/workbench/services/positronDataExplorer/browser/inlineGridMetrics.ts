/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FontConfigurationManager } from '../../../browser/fontConfigurationManager.js';

/**
 * Base grid layout constants, designed at the platform's default editor font
 * size. Use {@link getInlineGridMetrics} to get these scaled to the user's
 * actual editor font size.
 */
export const INLINE_GRID_COLUMN_HEADERS_HEIGHT = 34;
export const INLINE_GRID_DEFAULT_ROW_HEIGHT = 22;
export const INLINE_GRID_SCROLLBAR_THICKNESS = 10;
const INLINE_GRID_ROW_HEADERS_WIDTH = 50;
const INLINE_GRID_DEFAULT_COLUMN_WIDTH = 150;
const INLINE_GRID_HORIZONTAL_CELL_PADDING = 5;

/**
 * The reference editor font size at which the base constants above render
 * correctly. Matches the platform defaults in EDITOR_FONT_DEFAULTS so the
 * grid renders unchanged when the user has not customized the editor font
 * size.
 */
const REFERENCE_FONT_SIZE = isMacintosh ? 12 : 14;

/**
 * Inline grid metrics interface. Layout dimensions for the inline data
 * explorer grid, scaled to the editor font size.
 */
export interface IInlineGridMetrics {
	/**
	 * The font scale factor relative to the reference font size.
	 */
	readonly fontScale: number;

	/**
	 * The height of the column headers.
	 */
	readonly columnHeadersHeight: number;

	/**
	 * The default row height.
	 */
	readonly defaultRowHeight: number;

	/**
	 * The width of the row headers.
	 */
	readonly rowHeadersWidth: number;

	/**
	 * The default column width.
	 */
	readonly defaultColumnWidth: number;

	/**
	 * The horizontal cell padding.
	 */
	readonly horizontalCellPadding: number;

	/**
	 * The scrollbar thickness. Not scaled: scrollbars are workbench chrome.
	 */
	readonly scrollbarThickness: number;
}

/**
 * Computes the inline grid layout metrics scaled to the user's editor font
 * size. The inline data explorer renders cell text in the editor font (see
 * `useEditorFont` in InlineTableDataGridInstance), so its layout dimensions
 * must grow with the editor font size or text overflows its cells. Monospace
 * advance width scales linearly with font size, so a simple ratio is exact
 * for both heights and widths.
 * @param configurationService The configuration service, if available. When
 * undefined, unscaled metrics are returned.
 * @returns The inline grid metrics for the current editor font.
 */
export function getInlineGridMetrics(configurationService: IConfigurationService | undefined): IInlineGridMetrics {
	let fontSize = REFERENCE_FONT_SIZE;
	if (configurationService) {
		const measuredFontSize = FontConfigurationManager.getFontInfo(configurationService, 'editor').fontSize;
		if (measuredFontSize > 0) {
			fontSize = measuredFontSize;
		}
	}
	const fontScale = fontSize / REFERENCE_FONT_SIZE;
	return {
		fontScale,
		columnHeadersHeight: Math.round(INLINE_GRID_COLUMN_HEADERS_HEIGHT * fontScale),
		defaultRowHeight: Math.round(INLINE_GRID_DEFAULT_ROW_HEIGHT * fontScale),
		rowHeadersWidth: Math.round(INLINE_GRID_ROW_HEADERS_WIDTH * fontScale),
		defaultColumnWidth: Math.round(INLINE_GRID_DEFAULT_COLUMN_WIDTH * fontScale),
		horizontalCellPadding: Math.round(INLINE_GRID_HORIZONTAL_CELL_PADDING * fontScale),
		scrollbarThickness: INLINE_GRID_SCROLLBAR_THICKNESS,
	};
}
