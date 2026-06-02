/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Position } from '../../../../../editor/common/core/position.js';
import { QuartoCodeCell } from '../../common/quartoTypes.js';
import {
	isInsideCellCode,
	toCellLine,
	toCellPosition,
	toDocumentLine,
	toDocumentPosition,
	toDocumentRange,
} from '../../common/quartoPositionMapping.js';

/**
 * Builds a minimal cell. Only the code line range matters for position mapping;
 * the other fields are filled with inert placeholders.
 */
function cell(codeStartLine: number, codeEndLine: number): QuartoCodeCell {
	return {
		id: 'test',
		language: 'python',
		startLine: codeStartLine - 1,
		endLine: codeEndLine + 1,
		codeStartLine,
		codeEndLine,
		options: '',
		contentHash: '0',
		index: 0,
	};
}

describe('quartoPositionMapping', () => {
	// A chunk whose code occupies document lines 5..8:
	//   line 4: ```{python}
	//   line 5..8: code
	//   line 9: ```
	const c = cell(5, 8);

	it('round-trips line numbers between document and cell space', () => {
		expect([
			toCellLine(c, 5),       // first code line -> cell line 1
			toCellLine(c, 8),       // last code line  -> cell line 4
			toDocumentLine(c, 1),   // cell line 1     -> document line 5
			toDocumentLine(c, 4),   // cell line 4     -> document line 8
			toDocumentLine(c, toCellLine(c, 7)), // identity through both
		]).toEqual([1, 4, 5, 8, 7]);
	});

	it('treats only code lines (not the fences) as inside the cell', () => {
		expect([
			isInsideCellCode(c, 4), // opening fence
			isInsideCellCode(c, 5), // first code line
			isInsideCellCode(c, 8), // last code line
			isInsideCellCode(c, 9), // closing fence
		]).toEqual([false, true, true, false]);
	});

	it('reports an empty chunk (no code lines) as having nothing inside', () => {
		// ```{python}\n``` -> codeStartLine 6, codeEndLine 5
		const empty = cell(6, 5);
		expect(isInsideCellCode(empty, 5) || isInsideCellCode(empty, 6)).toBe(false);
	});

	it('preserves the column when translating positions', () => {
		const docPos = new Position(7, 12);
		const cellPos = toCellPosition(c, docPos);
		expect({ cell: cellPos, roundTrip: toDocumentPosition(c, cellPos) }).toEqual({
			cell: new Position(3, 12),
			roundTrip: docPos,
		});
	});

	it('shifts only line numbers when translating a cell range to document space', () => {
		expect(toDocumentRange(c, { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 6 }))
			.toMatchObject({ startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: 6 });
	});
});
