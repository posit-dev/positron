/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ICodeEditor } from '../../../../../../editor/browser/editorBrowser.js';
import { Selection } from '../../../../../../editor/common/core/selection.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { stubInterface } from '../../../../../../test/vitest/stubInterface.js';
import { computeCursorAtBoundary, computeCursorAtLineBoundary } from '../../../browser/notebookCells/cellCursorBoundary.js';

const LINE_HEIGHT = 19;

/**
 * Minimal ICodeEditor stub over a fixed set of lines.
 * @param topForPosition Override to simulate word wrap; defaults to one view
 * line per model line.
 */
function stubEditor(
	lines: string[],
	selection: Selection | null,
	topForPosition?: (lineNumber: number, column: number) => number,
): ICodeEditor {
	const model = stubInterface<ITextModel>({
		getLineCount: () => lines.length,
		getLineMaxColumn: (lineNumber: number) => lines[lineNumber - 1].length + 1,
	});
	return stubInterface<ICodeEditor>({
		getModel: () => model,
		getSelection: () => selection,
		getTopForPosition: topForPosition ?? ((lineNumber: number) => (lineNumber - 1) * LINE_HEIGHT),
	});
}

function cursor(lineNumber: number, column: number): Selection {
	return new Selection(lineNumber, column, lineNumber, column);
}

describe('computeCursorAtBoundary', () => {
	const lines = ['first', 'middle', 'last'];

	it('reports top on the first line', () => {
		expect(computeCursorAtBoundary(stubEditor(lines, cursor(1, 3)))).toBe('top');
	});

	it('reports bottom on the last line', () => {
		expect(computeCursorAtBoundary(stubEditor(lines, cursor(3, 1)))).toBe('bottom');
	});

	it('reports none in the middle', () => {
		expect(computeCursorAtBoundary(stubEditor(lines, cursor(2, 2)))).toBe('none');
	});

	it('reports both in a single-line editor', () => {
		expect(computeCursorAtBoundary(stubEditor(['only'], cursor(1, 2)))).toBe('both');
	});

	it('reports none for a non-empty selection', () => {
		expect(computeCursorAtBoundary(stubEditor(lines, new Selection(3, 1, 3, 4)))).toBe('none');
	});

	it('reports none when there is no selection', () => {
		expect(computeCursorAtBoundary(stubEditor(lines, null))).toBe('none');
	});

	it('is view-line aware: the first wrapped segment of a wrapped last line is not bottom', () => {
		// One model line wrapped into two view lines at column 6: columns >= 6
		// render on the second view line.
		const wrapped = stubEditor(
			['0123456789'],
			cursor(1, 1),
			(_lineNumber, column) => (column >= 6 ? LINE_HEIGHT : 0),
		);
		expect(computeCursorAtBoundary(wrapped)).toBe('top');
	});

	it('is view-line aware: the last wrapped segment of a wrapped first line is not top', () => {
		const wrapped = stubEditor(
			['0123456789'],
			cursor(1, 8),
			(_lineNumber, column) => (column >= 6 ? LINE_HEIGHT : 0),
		);
		expect(computeCursorAtBoundary(wrapped)).toBe('bottom');
	});
});

describe('computeCursorAtLineBoundary', () => {
	const lines = ['first', '', 'last'];

	it('reports start at column 1', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, cursor(1, 1)))).toBe('start');
	});

	it('reports end at the last column', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, cursor(1, 6)))).toBe('end');
	});

	it('reports none mid-line', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, cursor(1, 3)))).toBe('none');
	});

	it('reports both on an empty line', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, cursor(2, 1)))).toBe('both');
	});

	it('reports none for a non-empty selection', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, new Selection(1, 1, 1, 6)))).toBe('none');
	});

	it('reports none when there is no selection', () => {
		expect(computeCursorAtLineBoundary(stubEditor(lines, null))).toBe('none');
	});
});
