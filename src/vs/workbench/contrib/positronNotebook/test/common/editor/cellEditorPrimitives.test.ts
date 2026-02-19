/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'assert';
import { Range } from '../../../../../../editor/common/core/range.js';
import { CellEditorRange } from '../../../common/editor/range.js';
import { CellEditorPosition } from '../../../common/editor/position.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';

/** Shorthand to create a CellEditorRange. */
function r(cellIndex: number, startLine: number, startCol: number, endLine: number, endCol: number): CellEditorRange {
	return new CellEditorRange(cellIndex, new Range(startLine, startCol, endLine, endCol));
}

/** Shorthand to create a CellEditorPosition. */
function p(cellIndex: number, lineNumber: number, column: number): CellEditorPosition {
	return new CellEditorPosition(cellIndex, { lineNumber, column });
}

suite('CellEditorPosition', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('equals', () => {
		test('returns true for identical positions', () => {
			assert.strictEqual(p(0, 1, 1).equals(p(0, 1, 1)), true);
		});

		test('returns false when cellIndex differs', () => {
			assert.strictEqual(p(0, 1, 1).equals(p(1, 1, 1)), false);
		});

		test('returns false when line differs', () => {
			assert.strictEqual(p(0, 1, 1).equals(p(0, 2, 1)), false);
		});

		test('returns false when column differs', () => {
			assert.strictEqual(p(0, 1, 1).equals(p(0, 1, 5)), false);
		});

		test('static: returns true for both null', () => {
			assert.strictEqual(CellEditorPosition.equals(null, null), true);
		});

		test('static: returns false when only first is null', () => {
			assert.strictEqual(CellEditorPosition.equals(null, p(0, 1, 1)), false);
		});

		test('static: returns false when only second is null', () => {
			assert.strictEqual(CellEditorPosition.equals(p(0, 1, 1), null), false);
		});
	});

	suite('isBefore', () => {
		test('returns true when cellIndex is smaller', () => {
			assert.strictEqual(p(0, 5, 5).isBefore(p(1, 1, 1)), true);
		});

		test('returns false when cellIndex is larger', () => {
			assert.strictEqual(p(2, 1, 1).isBefore(p(1, 5, 5)), false);
		});

		test('same cellIndex: returns true when position is before', () => {
			assert.strictEqual(p(0, 1, 1).isBefore(p(0, 1, 5)), true);
		});

		test('same cellIndex: returns true when line is before', () => {
			assert.strictEqual(p(0, 1, 1).isBefore(p(0, 2, 1)), true);
		});

		test('returns false for equal positions', () => {
			assert.strictEqual(p(0, 1, 1).isBefore(p(0, 1, 1)), false);
		});
	});

	suite('isBeforeOrEqual', () => {
		test('returns true for equal positions', () => {
			assert.strictEqual(p(0, 1, 1).isBeforeOrEqual(p(0, 1, 1)), true);
		});

		test('returns true when before', () => {
			assert.strictEqual(p(0, 1, 1).isBeforeOrEqual(p(0, 1, 5)), true);
		});

		test('returns false when after', () => {
			assert.strictEqual(p(0, 1, 5).isBeforeOrEqual(p(0, 1, 1)), false);
		});

		test('returns true when cellIndex is smaller', () => {
			assert.strictEqual(p(0, 5, 5).isBeforeOrEqual(p(1, 1, 1)), true);
		});

		test('returns false when cellIndex is larger', () => {
			assert.strictEqual(p(2, 1, 1).isBeforeOrEqual(p(1, 5, 5)), false);
		});
	});

	suite('toString', () => {
		test('produces expected format', () => {
			assert.strictEqual(p(2, 3, 7).toString(), 'cell[2]:(3,7)');
		});

		test('handles cell index 0', () => {
			assert.strictEqual(p(0, 1, 1).toString(), 'cell[0]:(1,1)');
		});
	});
});

suite('CellEditorRange', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('equalsRange', () => {
		test('returns true for identical ranges', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).equalsRange(r(0, 1, 1, 1, 5)), true);
		});

		test('returns false when cellIndex differs', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).equalsRange(r(1, 1, 1, 1, 5)), false);
		});

		test('returns false when range differs', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).equalsRange(r(0, 1, 1, 1, 10)), false);
		});

		test('static: returns true for both null', () => {
			assert.strictEqual(CellEditorRange.equalsRange(null, null), true);
		});

		test('static: returns true for both undefined', () => {
			assert.strictEqual(CellEditorRange.equalsRange(undefined, undefined), true);
		});

		test('static: returns false when only first is null', () => {
			assert.strictEqual(CellEditorRange.equalsRange(null, r(0, 1, 1, 1, 5)), false);
		});

		test('static: returns false when only second is null', () => {
			assert.strictEqual(CellEditorRange.equalsRange(r(0, 1, 1, 1, 5), null), false);
		});
	});

	suite('isEmpty', () => {
		test('returns true when start equals end', () => {
			assert.strictEqual(r(0, 1, 1, 1, 1).isEmpty(), true);
		});

		test('returns false for non-empty range', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).isEmpty(), false);
		});

		test('returns true for collapsed multi-line position', () => {
			assert.strictEqual(r(0, 3, 7, 3, 7).isEmpty(), true);
		});
	});

	suite('containsPosition', () => {
		test('returns true for position inside range', () => {
			assert.strictEqual(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 5)), true);
		});

		test('returns true for position at start edge', () => {
			assert.strictEqual(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 1)), true);
		});

		test('returns true for position at end edge', () => {
			assert.strictEqual(r(0, 1, 1, 1, 10).containsPosition(p(0, 1, 10)), true);
		});

		test('returns false for different cellIndex', () => {
			assert.strictEqual(r(0, 1, 1, 1, 10).containsPosition(p(1, 1, 5)), false);
		});

		test('returns false for position outside range', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).containsPosition(p(0, 1, 10)), false);
		});

		test('multi-line: returns true on first line after start column', () => {
			assert.strictEqual(r(0, 1, 3, 3, 5).containsPosition(p(0, 1, 4)), true);
		});

		test('multi-line: returns true on middle line', () => {
			assert.strictEqual(r(0, 1, 3, 3, 5).containsPosition(p(0, 2, 1)), true);
		});

		test('multi-line: returns true on last line before end column', () => {
			assert.strictEqual(r(0, 1, 3, 3, 5).containsPosition(p(0, 3, 4)), true);
		});

		test('multi-line: returns false before start column on first line', () => {
			assert.strictEqual(r(0, 1, 3, 3, 5).containsPosition(p(0, 1, 2)), false);
		});

		test('multi-line: returns false after end column on last line', () => {
			assert.strictEqual(r(0, 1, 3, 3, 5).containsPosition(p(0, 3, 6)), false);
		});
	});

	suite('containsRange', () => {
		test('returns true when other is fully inside', () => {
			assert.strictEqual(r(0, 1, 1, 3, 10).containsRange(r(0, 1, 5, 2, 3)), true);
		});

		test('returns true for equal ranges', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).containsRange(r(0, 1, 1, 1, 5)), true);
		});

		test('returns false for different cellIndex', () => {
			assert.strictEqual(r(0, 1, 1, 3, 10).containsRange(r(1, 1, 5, 2, 3)), false);
		});

		test('returns false when other extends beyond', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).containsRange(r(0, 1, 1, 1, 10)), false);
		});

		test('returns false when other starts before', () => {
			assert.strictEqual(r(0, 1, 5, 1, 10).containsRange(r(0, 1, 1, 1, 10)), false);
		});

		test('multi-line: returns true when other starts at outer start and ends before outer end', () => {
			assert.strictEqual(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 3, 3, 2)), true);
		});

		test('multi-line: returns true when other starts after outer start and ends at outer end', () => {
			assert.strictEqual(r(0, 1, 3, 4, 8).containsRange(r(0, 2, 1, 4, 8)), true);
		});

		test('multi-line: returns false when other shares start but extends past end', () => {
			assert.strictEqual(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 3, 5, 1)), false);
		});

		test('multi-line: returns false when other starts before outer start but ends inside', () => {
			assert.strictEqual(r(0, 1, 3, 4, 8).containsRange(r(0, 1, 1, 3, 2)), false);
		});
	});

	suite('isBefore', () => {
		test('returns true when cellIndex is smaller', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).isBefore(r(1, 1, 1, 1, 5)), true);
		});

		test('returns false when cellIndex is larger', () => {
			assert.strictEqual(r(1, 1, 1, 1, 5).isBefore(r(0, 1, 1, 1, 5)), false);
		});

		test('same cellIndex: compares by start position (forward)', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).isBefore(r(0, 1, 3, 1, 5)), true);
		});

		test('same cellIndex: compares by start position (reverse)', () => {
			assert.strictEqual(r(0, 1, 3, 1, 5).isBefore(r(0, 1, 1, 1, 5)), false);
		});

		test('same cellIndex: compares by start line (forward)', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).isBefore(r(0, 2, 1, 2, 5)), true);
		});

		test('same cellIndex: compares by start line (reverse)', () => {
			assert.strictEqual(r(0, 2, 1, 2, 5).isBefore(r(0, 1, 1, 1, 5)), false);
		});

		test('returns false for equal ranges', () => {
			assert.strictEqual(r(0, 1, 1, 1, 5).isBefore(r(0, 1, 1, 1, 5)), false);
		});
	});

	suite('toString', () => {
		test('produces expected format', () => {
			assert.strictEqual(r(2, 1, 3, 4, 7).toString(), 'cell[2]:[1,3 -> 4,7]');
		});

		test('handles cell index 0', () => {
			assert.strictEqual(r(0, 1, 1, 1, 1).toString(), 'cell[0]:[1,1 -> 1,1]');
		});
	});

	suite('getStartPosition', () => {
		test('returns correct cell position', () => {
			const pos = r(2, 3, 7, 5, 1).getStartPosition();
			assert.strictEqual(pos.cellIndex, 2);
			assert.strictEqual(pos.position.lineNumber, 3);
			assert.strictEqual(pos.position.column, 7);
		});
	});

	suite('getEndPosition', () => {
		test('returns correct cell position', () => {
			const pos = r(2, 3, 7, 5, 1).getEndPosition();
			assert.strictEqual(pos.cellIndex, 2);
			assert.strictEqual(pos.position.lineNumber, 5);
			assert.strictEqual(pos.position.column, 1);
		});
	});
});