/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { GOLDEN_LINE_HEIGHT_RATIO } from '../../../../../editor/common/config/fontInfo.js';
import {
	computeInlineGridMetrics,
	INLINE_GRID_COLUMN_HEADERS_HEIGHT,
	INLINE_GRID_DEFAULT_ROW_HEIGHT,
	INLINE_GRID_SCROLLBAR_THICKNESS,
	REFERENCE_FONT_SIZE,
} from '../../browser/inlineGridMetrics.js';

describe('computeInlineGridMetrics', () => {
	it('returns the designed layout at the reference font size', () => {
		const metrics = computeInlineGridMetrics(REFERENCE_FONT_SIZE, 0);
		expect(metrics.fontScale).toBe(1);
		expect(metrics.defaultRowHeight).toBe(INLINE_GRID_DEFAULT_ROW_HEIGHT);
		expect(metrics.columnHeadersHeight).toBe(INLINE_GRID_COLUMN_HEADERS_HEIGHT);
		expect(metrics.scrollbarThickness).toBe(INLINE_GRID_SCROLLBAR_THICKNESS);
	});

	it('scales linearly with the font size', () => {
		// Use a font size large enough that the line-height floor does not
		// take over the row height.
		const base = computeInlineGridMetrics(REFERENCE_FONT_SIZE, 0);
		const doubled = computeInlineGridMetrics(REFERENCE_FONT_SIZE * 2, 0);
		expect(doubled.fontScale).toBe(2);
		expect(doubled.defaultRowHeight).toBe(base.defaultRowHeight * 2);
		expect(doubled.columnHeadersHeight).toBe(base.columnHeadersHeight * 2);
		expect(doubled.defaultColumnWidth).toBe(base.defaultColumnWidth * 2);
		expect(doubled.rowHeadersWidth).toBe(base.rowHeadersWidth * 2);
	});

	it('floors the row height at the line height plus padding', () => {
		// A 12px font with a custom 40px line height must not get ~22px rows,
		// or text overlaps adjacent rows. Platform-independent: the floor
		// wins over font-size scaling on every platform.
		const metrics = computeInlineGridMetrics(12, 40);
		expect(metrics.defaultRowHeight).toBe(43);
	});

	it('tracks editor.lineHeight independently of font size', () => {
		const smaller = computeInlineGridMetrics(12, 30);
		const larger = computeInlineGridMetrics(12, 50);
		expect(smaller.defaultRowHeight).toBe(33);
		expect(larger.defaultRowHeight).toBe(53);
		// Widths are unaffected by line height.
		expect(larger.defaultColumnWidth).toBe(smaller.defaultColumnWidth);
	});

	it('derives the line height from the font size when it is 0', () => {
		const derived = computeInlineGridMetrics(12, 0);
		const explicit = computeInlineGridMetrics(12, 12 * GOLDEN_LINE_HEIGHT_RATIO);
		expect(derived.defaultRowHeight).toBe(explicit.defaultRowHeight);
	});
});
