/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	cellPositionToSource,
	cellRangeToSource,
	cellZeroBasedLineToSource,
	sourcePositionToCell,
	sourceRangeToCell,
} from '../../common/quartoCellPositionMapping.js';

// A document whose opening fence is on line 3, code on lines 4 to 6, and
// closing fence on line 7:
//
//   1  # Intro
//   2
//   3  ```{r}
//   4  x <- 1
//   5  y <- 2
//   6  z <- 3
//   7  ```
const cell = { codeStartLine: 4, codeEndLine: 6 };

describe('quartoCellPositionMapping', () => {
	it('maps source positions into the cell, and nothing outside the code', () => {
		expect({
			firstCodeLine: sourcePositionToCell(cell, { lineNumber: 4, column: 1 }),
			lastCodeLine: sourcePositionToCell(cell, { lineNumber: 6, column: 9 }),
			openingFence: sourcePositionToCell(cell, { lineNumber: 3, column: 1 }),
			closingFence: sourcePositionToCell(cell, { lineNumber: 7, column: 1 }),
			prose: sourcePositionToCell(cell, { lineNumber: 1, column: 1 }),
		}).toEqual({
			// Columns pass through untouched. The parser only recognizes fences
			// that start at column 0, so cell code is never indented relative to
			// the source and there is no column offset to apply.
			firstCodeLine: { lineNumber: 1, column: 1 },
			lastCodeLine: { lineNumber: 3, column: 9 },
			openingFence: undefined,
			closingFence: undefined,
			prose: undefined,
		});
	});

	it('maps cell positions and ranges back to the source document', () => {
		// Asserted against absolute values rather than through a round trip. A
		// round trip passes whenever both directions are wrong by the same
		// amount, which is the most likely way for this to break.
		expect({
			firstCodeLine: cellPositionToSource(cell, { lineNumber: 1, column: 1 }),
			lastCodeLine: cellPositionToSource(cell, { lineNumber: 3, column: 9 }),
			range: cellRangeToSource(cell, {
				startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 4,
			}),
		}).toEqual({
			firstCodeLine: { lineNumber: 4, column: 1 },
			lastCodeLine: { lineNumber: 6, column: 9 },
			range: { startLineNumber: 4, startColumn: 2, endLineNumber: 6, endColumn: 4 },
		});
	});

	it('accepts ranges inside the code and rejects any that leave it', () => {
		expect({
			wholeCell: sourceRangeToCell(cell, {
				startLineNumber: 4, startColumn: 1, endLineNumber: 6, endColumn: 10,
			}),
			startsOnFence: sourceRangeToCell(cell, {
				startLineNumber: 3, startColumn: 1, endLineNumber: 5, endColumn: 1,
			}),
			endsOnFence: sourceRangeToCell(cell, {
				startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: 1,
			}),
		}).toEqual({
			wholeCell: { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 10 },
			startsOnFence: undefined,
			endsOnFence: undefined,
		});
	});

	it('shifts a zero-based line without changing its indexing', () => {
		// A rejected statement range reports the line of the syntax error on its
		// own, zero indexed. The shift is the same one a range gets, but applying
		// it through a range would be off by one in each direction.
		expect({
			firstLine: cellZeroBasedLineToSource(cell, 0),
			lastLine: cellZeroBasedLineToSource(cell, 2),
		}).toEqual({
			// Zero indexed line 3 is source line 4, the cell's first line of code.
			firstLine: 3,
			lastLine: 5,
		});
	});

	it('treats a chunk with no code as containing no lines', () => {
		// An empty chunk puts the fences on consecutive lines, so the parser
		// reports a span whose end is before its start.
		const empty = { codeStartLine: 4, codeEndLine: 3 };

		expect({
			atStart: sourcePositionToCell(empty, { lineNumber: 4, column: 1 }),
			atEnd: sourcePositionToCell(empty, { lineNumber: 3, column: 1 }),
		}).toEqual({
			atStart: undefined,
			atEnd: undefined,
		});
	});
});
