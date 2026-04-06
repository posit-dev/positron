/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/// <reference types="vitest/globals" />

import { Range } from '../../../../../../editor/common/core/range.js';
import { CellEditorRange } from '../../../common/editor/range.js';
import { CellEditorPosition } from '../../../common/editor/position.js';

/** Shorthand to create a CellEditorRange. */
/// <reference types="vitest/globals" />
function r(cellIndex: number, startLine: number, startCol: number, endLine: number, endCol: number): CellEditorRange {
	return new CellEditorRange(cellIndex, new Range(startLine, startCol, endLine, endCol));
}

/** Shorthand to create a CellEditorPosition. */
/// <reference types="vitest/globals" />
function p(cellIndex: number, lineNumber: number, column: number): CellEditorPosition {
	return new CellEditorPosition(cellIndex, { lineNumber, column });
}

describe('CellEditorPosition', () => {
	describe('equals', () => {
		it('returns true for identical positions', () => {
			expect(p(0, 1, 1).equals(p(0, 1, 1))).toBe(true);
		});

		it('returns false when cellIndex differs', () => {
			expect(p(0, 1, 1).equals(p(1, 1, 1))).toBe(false);
		});

		it('returns false when line differs', () => {
			expect(p(0, 1, 1).equals(p(0, 2, 1))).toBe(false);
		});

		it('returns false when column differs', () => {
			expect(p(0, 1, 1).equals(p(0, 1, 5))).toBe(false);
		});

		it('static: returns true for both null', () => {
			expect(CellEditorPosition.equals(null, null)).toBe(true);
		});

		it('static: returns false when only first is null', () => {
			expect(CellEditorPosition.equals(null, p(0, 1, 1))).toBe(false);
		});

		it('static: returns false when only second is null', () => {
			expect(CellEditorPosition.equals(p(0, 1, 1), null)).toBe(false);
		});
	});

	describe('isBefore', () => {
		it('returns true when cellIndex is smaller', () => {
			expect(p(0, 5, 5).isBefore(p(1, 1, 1))).toBe(true);
		});

		it('returns false when cellIndex is larger', () => {
			expect(p(2, 1, 1).isBefore(p(1, 5, 5))).toBe(false);
		});

		it('same cellIndex: returns true when position is before', () => {
			expect(p(0, 1, 1).isBefore(p(0, 1, 5))).toBe(true);
		});

		it('same cellIndex: returns true when line is before', () => {
			expect(p(0, 1, 1).isBefore(p(0, 2, 1))).toBe(true);
		});

		it('returns false for equal positions', () => {
			expect(p(0, 1, 1).isBefore(p(0, 1, 1))).toBe(false);
		});
	});

	describe('isBeforeOrEqual', () => {
		it('returns true for equal positions', () => {
			expect(p(0, 1, 1).isBeforeOrEqual(p(0, 1, 1))).toBe(true);
		});

		it('returns true when before', () => {
			expect(p(0, 1, 1).isBeforeOrEqual(p(0, 1, 5))).toBe(true);
		});

		it('returns false when after', () => {
			expect(p(0, 1, 5).isBeforeOrEqual(p(0, 1, 1))).toBe(false);
		});

		it('returns true when cellIndex is smaller', () => {
			expect(p(0, 5, 5).isBeforeOrEqual(p(1, 1, 1))).toBe(true);
		});

		it('returns false when cellIndex is larger', () => {
			expect(p(2, 1, 1).isBeforeOrEqual(p(1, 5, 5))).toBe(false);
		});
	});

	describe('toString', () => {
		it('produces expected format', () => {
			expect(p(2, 3, 7).toString()).toBe('cell[2]:(3,7)');
		});

		it('handles cell index 0', () => {
			expect(p(0, 1, 1).toString()).toBe('cell[0]:(1,1)');
		});
	});
});

describe('CellEditorRange', () => {
	describe('equalsRange', () => {
		it('returns true for identical ranges', () => {
			expect(r(0, 1, 1, 1, 5).equalsRange(r(0, 1, 1, 1, 5))).toBe(true);
		});

		it('returns false when cellIndex differs', () => {
			expect(r(0, 1, 1, 1, 5).equalsRange(r(1, 1, 1, 1, 5))).toBe(false);
		});

		it('returns false when range differs', () => {
			expect(r(0, 1, 1, 1, 5).equalsRange(r(0, 1, 1, 1, 10))).toBe(false);
		});

		it('static: returns true for both null', () => {
			expect(CellEditorRange.equalsRange(null, null)).toBe(true);
		});

		it('static: returns true for both undefined', () => {
			expect(CellEditorRange.equalsRange(undefined, undefined)).toBe(true);
		});

		it('static: returns false when only first is null', () => {
			expect(CellEditorRange.equalsRange(null, r(0, 1, 1, 1, 5))).toBe(false);
		});

		it('static: returns false when only second is null', () => {
			expect(CellEditorRange.equalsRange(r(0, 1, 1, 1, 5), null)).toBe(false);
		});
	});

	describe('isEmpty', () => {
		it('returns true when start equals end', () => {
			expect(r(0, 1, 1, 1, 1).isEmpty()).toBe(true);
		});

		it('returns false for non-empty range', () => {
			expect(r(0, 1, 1, 1, 5).isEmpty()).toBe(false);
		});

		it('returns true for collapsed multi-line position', () => {
			expect(r(0, 3, 7, 3, 7).isEmpty()).toBe(true);
		});
	});

	describe('containsPosition', () => {
		it('returns true for position inside range', () => {
			expect(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 5))).toBe(true);
		});

		it('returns true for position at start edge', () => {
			expect(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 1))).toBe(true);
		});

		it('returns true for position at end edge', () => {
			expect(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 10))).toBe(true);
		});

		it('returns false for different cellIndex', () => {
			expect(r(0, 1, 1, 1, 10).containsPosition(p(1, 1, 5))).toBe(false);
		});

		it('returns false for position outside range', () => {
			expect(r(0, 1, 1, 1, 5).containsPosition(p(0, 1, 10))).toBe(false);
		});

		it('multi-line: returns true on first line after start column', () => {
			expect(r(0, 1, 3, 3, 5).containsPosition(p(0, 1, 4))).toBe(true);
		});

		it('multi-line: returns true on middle line', () => {
			expect(r(0, 1, 3, 3, 5).containsPosition(p(0, 2, 1))).toBe(true);
		});

		it('multi-line: returns true on last line before end column', () => {
			expect(r(0, 1, 3, 3, 5).containsPosition(p(0, 3, 4))).toBe(true);
		});

		it('multi-line: returns false before start column on first line', () => {
			expect(r(0, 1, 3, 3, 5).containsPosition(p(0, 1, 2))).toBe(false);
		});

		it('multi-line: returns false after end column on last line', () => {
			expect(r(0, 1, 3, 3, 5).containsPosition(p(0, 3, 6))).toBe(false);
		});
	});

	describe('containsRange', () => {
		it('returns true when other is fully inside', () => {
			expect(r(0, 1, 1, 3, 10).containsRange(r(0, 1, 5, 2, 3))).toBe(true);
		});

		it('returns true for equal ranges', () => {
			expect(r(0, 1, 1, 1, 5).containsRange(r(0, 1, 1, 1, 5))).toBe(true);
		});

		it('returns false for different cellIndex', () => {
			expect(r(0, 1, 1, 3, 10).containsRange(r(1, 1, 5, 2, 3))).toBe(false);
		});

		it('returns false when other extends beyond', () => {
			expect(r(0, 1, 1, 1, 5).containsRange(r(0, 1, 1, 1, 10))).toBe(false);
		});

		it('returns false when other starts before', () => {
			expect(r(0, 1, 5, 1, 10).containsRange(r(0, 1, 1, 1, 10))).toBe(false);
		});

		it('multi-line: returns true when other starts at outer start and ends before outer end', () => {
			expect(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 3, 3, 2))).toBe(true);
		});

		it('multi-line: returns true when other starts after outer start and ends at outer end', () => {
			expect(r(0, 1, 3, 4, 8).containsRange(r(0, 2, 1, 4, 8))).toBe(true);
		});

		it('multi-line: returns false when other shares start but extends past end', () => {
			expect(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 3, 5, 1))).toBe(false);
		});

		it('multi-line: returns false when other starts before outer start but ends inside', () => {
			expect(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 1, 3, 2))).toBe(false);
		});
	});

	describe('isBefore', () => {
		it('returns true when cellIndex is smaller', () => {
			expect(r(0, 1, 1, 1, 5).isBefore(r(1, 1, 1, 1, 5))).toBe(true);
		});

		it('returns false when cellIndex is larger', () => {
			expect(r(1, 1, 1, 1, 5).isBefore(r(0, 1, 1, 1, 5))).toBe(false);
		});

		it('same cellIndex: compares by start position (forward)', () => {
			expect(r(0, 1, 1, 1, 5).isBefore(r(0, 1, 3, 1, 5))).toBe(true);
		});

		it('same cellIndex: compares by start position (reverse)', () => {
			expect(r(0, 1, 3, 1, 5).isBefore(r(0, 1, 1, 1, 5))).toBe(false);
		});

		it('same cellIndex: compares by start line (forward)', () => {
			expect(r(0, 1, 1, 1, 5).isBefore(r(0, 2, 1, 2, 5))).toBe(true);
		});

		it('same cellIndex: compares by start line (reverse)', () => {
			expect(r(0, 2, 1, 2, 5).isBefore(r(0, 1, 1, 1, 5))).toBe(false);
		});

		it('returns false for equal ranges', () => {
			expect(r(0, 1, 1, 1, 5).isBefore(r(0, 1, 1, 1, 5))).toBe(false);
		});
	});

	describe('toString', () => {
		it('produces expected format', () => {
			expect(r(2, 1, 3, 4, 7).toString()).toBe('cell[2]:[1,3 -> 4,7]');
		});

		it('handles cell index 0', () => {
			expect(r(0, 1, 1, 1, 1).toString()).toBe('cell[0]:[1,1 -> 1,1]');
		});
	});

	describe('getStartPosition', () => {
		it('returns correct cell position', () => {
			const pos = r(2, 3, 7, 5, 1).getStartPosition();
			expect(pos.cellIndex).toBe(2);
			expect(pos.position.lineNumber).toBe(3);
			expect(pos.position.column).toBe(7);
		});
	});

	describe('getEndPosition', () => {
		it('returns correct cell position', () => {
			const pos = r(2, 3, 7, 5, 1).getEndPosition();
			expect(pos.cellIndex).toBe(2);
			expect(pos.position.lineNumber).toBe(5);
			expect(pos.position.column).toBe(1);
		});
	});
});
