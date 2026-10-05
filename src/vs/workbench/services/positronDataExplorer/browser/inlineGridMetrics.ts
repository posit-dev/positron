/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from '../../../../base/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { FontConfigurationManager } from '../../../browser/fontConfigurationManager.js';
import { GOLDEN_LINE_HEIGHT_RATIO } from '../../../../editor/common/config/fontInfo.js';

/**
 * Base grid layout constants, designed at the platform's default editor font
 * size. Use {@link getInlineGridMetrics} to get these scaled to the user's
 * actual editor font size. The header sizes do not scale: the headers use the
 * workbench font, same as the full Data Explorer.
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
export const REFERENCE_FONT_SIZE = isMacintosh ? 12 : 14;

/**
 * Vertical breathing room in a data row beyond the text's line height.
 * Chosen so that, at the reference font size with the default line height,
 * the line-height floor (line height + padding) stays at or below the
 * designed row height: 21px on macOS and 22px elsewhere.
 */
const INLINE_GRID_ROW_VERTICAL_PADDING = 3;

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
	 * The height of the column headers. Not scaled: headers use the workbench
	 * font.
	 */
	readonly columnHeadersHeight: number;

	/**
	 * The default row height.
	 */
	readonly defaultRowHeight: number;

	/**
	 * The width of the row headers. Not scaled: headers use the workbench font.
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
 * Computes the inline grid layout metrics for the given editor font size and
 * line height. Data cell widths scale with the font size (monospace advance
 * width is linear in font size), while the header sizes stay fixed. The row
 * height additionally takes a floor of the
 * line height plus padding, since a row must fit a full text line: a large
 * custom editor.lineHeight would otherwise make text overlap adjacent rows.
 * @param fontSize The editor font size in pixels.
 * @param lineHeight The editor line height in pixels, or 0 to derive it from
 * the font size using the editor's default line height ratio.
 * @returns The inline grid metrics.
 */
export function computeInlineGridMetrics(fontSize: number, lineHeight: number): IInlineGridMetrics {
	const fontScale = fontSize / REFERENCE_FONT_SIZE;
	const effectiveLineHeight = lineHeight > 0 ? lineHeight : fontSize * GOLDEN_LINE_HEIGHT_RATIO;
	return {
		fontScale,
		columnHeadersHeight: INLINE_GRID_COLUMN_HEADERS_HEIGHT,
		defaultRowHeight: Math.max(
			Math.round(INLINE_GRID_DEFAULT_ROW_HEIGHT * fontScale),
			Math.ceil(effectiveLineHeight) + INLINE_GRID_ROW_VERTICAL_PADDING,
		),
		rowHeadersWidth: INLINE_GRID_ROW_HEADERS_WIDTH,
		defaultColumnWidth: Math.round(INLINE_GRID_DEFAULT_COLUMN_WIDTH * fontScale),
		horizontalCellPadding: Math.round(INLINE_GRID_HORIZONTAL_CELL_PADDING * fontScale),
		scrollbarThickness: INLINE_GRID_SCROLLBAR_THICKNESS,
	};
}

/**
 * Computes the inline grid layout metrics scaled to the user's editor font.
 * The inline data explorer renders cell text in the editor font (see
 * `useEditorFont` in InlineTableDataGridInstance), so its layout dimensions
 * must grow with the editor font size or text overflows its cells.
 * @param configurationService The configuration service, if available. When
 * undefined, unscaled metrics are returned.
 * @returns The inline grid metrics for the current editor font.
 */
export function getInlineGridMetrics(configurationService: IConfigurationService | undefined): IInlineGridMetrics {
	if (!configurationService) {
		return computeInlineGridMetrics(REFERENCE_FONT_SIZE, 0);
	}
	const fontInfo = FontConfigurationManager.getFontInfo(configurationService, 'editor');
	return computeInlineGridMetrics(
		fontInfo.fontSize > 0 ? fontInfo.fontSize : REFERENCE_FONT_SIZE,
		fontInfo.lineHeight,
	);
}
