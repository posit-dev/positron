/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { USUAL_WORD_SEPARATORS } from '../../../../../../../editor/common/core/wordHelper.js';
import { Range } from '../../../../../../../editor/common/core/range.js';
import { CellEditorPosition } from '../../../../common/editor/position.js';
import { CellEditorRange } from '../../../../common/editor/range.js';
import { getPlainTextOutputContent, parseOutputData } from '../../../../browser/getOutputContents.js';
import { VSBuffer } from '../../../../../../../base/common/buffer.js';
import {
	findMatchesInOutputText,
	isMatchAtOrAfterPosition,
	isMatchAtOrBeforePosition,
} from '../../../../browser/contrib/find/findInOutputs.js';

/** Project a Range to a compact tuple for readable assertions. */
function tuple(range: Range): [number, number, number, number] {
	return [range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn];
}

describe('findMatchesInOutputText', () => {

	it('finds literal matches with 1-based positions', () => {
		const ranges = findMatchesInOutputText('foo bar foo', 'foo', false, false, null);

		expect(ranges.map(tuple)).toEqual([
			[1, 1, 1, 4],
			[1, 9, 1, 12],
		]);
	});

	it('finds matches across multiple lines', () => {
		const ranges = findMatchesInOutputText('alpha\nbeta alpha\ngamma', 'alpha', false, false, null);

		expect(ranges.map(tuple)).toEqual([
			[1, 1, 1, 6],
			[2, 6, 2, 11],
		]);
	});

	it('is case-insensitive when matchCase is false', () => {
		const ranges = findMatchesInOutputText('Hello HELLO hello', 'hello', false, false, null);

		expect(ranges.length).toBe(3);
	});

	it('is case-sensitive when matchCase is true', () => {
		const ranges = findMatchesInOutputText('Hello HELLO hello', 'hello', false, true, null);

		expect(ranges.map(tuple)).toEqual([[1, 13, 1, 18]]);
	});

	it('respects word separators for whole-word search', () => {
		const ranges = findMatchesInOutputText('cat catch category', 'cat', false, false, USUAL_WORD_SEPARATORS);

		expect(ranges.map(tuple)).toEqual([[1, 1, 1, 4]]);
	});

	it('matches whole words at line boundaries', () => {
		const ranges = findMatchesInOutputText('cat\ncatch', 'cat', false, false, USUAL_WORD_SEPARATORS);

		expect(ranges.map(tuple)).toEqual([[1, 1, 1, 4]]);
	});

	it('supports regex patterns', () => {
		const ranges = findMatchesInOutputText('a1 b22 c', '\\d+', true, false, null);

		expect(ranges.map(tuple)).toEqual([
			[1, 2, 1, 3],
			[1, 5, 1, 7],
		]);
	});

	it('invalid regex returns no matches', () => {
		const ranges = findMatchesInOutputText('hello', '[invalid', true, false, null);

		expect(ranges).toEqual([]);
	});

	it('empty search string returns no matches', () => {
		expect(findMatchesInOutputText('hello', '', false, false, null)).toEqual([]);
	});

	it('empty text returns no matches', () => {
		expect(findMatchesInOutputText('', 'hello', false, false, null)).toEqual([]);
	});

	it('caps results at limitResultCount', () => {
		const ranges = findMatchesInOutputText('aa aa aa aa', 'aa', false, false, null, 2);

		expect(ranges.length).toBe(2);
	});

	it('zero-length regex matches advance safely', () => {
		const ranges = findMatchesInOutputText('bb', 'a*', true, false, null, 10);

		// Empty match at each position; the searcher must not loop forever.
		expect(ranges.length).toBe(3);
	});
});

describe('output text extraction for find', () => {

	function textOutput(mime: string, text: string) {
		return { parsed: parseOutputData({ mime, data: VSBuffer.fromString(text) }) };
	}

	it('includes stdout, stderr, and text/plain outputs', () => {
		const content = getPlainTextOutputContent([
			textOutput('application/vnd.code.notebook.stdout', 'out'),
			textOutput('application/vnd.code.notebook.stderr', 'err'),
			textOutput('text/plain', 'plain'),
		]);

		expect(content).toBe('out\nerr\nplain');
	});

	it('includes error output stack traces', () => {
		const error = JSON.stringify({ name: 'NameError', message: 'oops', stack: 'Traceback: oops' });
		const content = getPlainTextOutputContent([
			textOutput('application/vnd.code.notebook.error', error),
		]);

		expect(content).toBe('Traceback: oops');
	});

	it('strips ANSI escape codes', () => {
		const content = getPlainTextOutputContent([
			textOutput('application/vnd.code.notebook.stdout', '\u001b[31mred\u001b[0m text'),
		]);

		expect(content).toBe('red text');
	});

	it('ignores non-text outputs', () => {
		const content = getPlainTextOutputContent([
			textOutput('image/png', 'iVBORw0KGgo='),
			textOutput('text/html', '<b>bold</b>'),
			textOutput('application/vnd.code.notebook.stdout', 'visible'),
		]);

		expect(content).toBe('visible');
	});
});

describe('match ordering with output matches', () => {

	function match(kind: 'input' | 'output', cellIndex: number, range = new Range(1, 1, 1, 4)) {
		return { kind, cellRange: new CellEditorRange(cellIndex, range) };
	}

	function position(cellIndex: number, lineNumber: number, column: number) {
		return new CellEditorPosition(cellIndex, { lineNumber, column });
	}

	it('output match in the cursor cell is after any editor position', () => {
		// Cursor far past the match range: outputs still render below the editor.
		const outputMatch = match('output', 0);
		const cursor = position(0, 99, 99);

		expect(isMatchAtOrAfterPosition(outputMatch, cursor)).toBe(true);
		expect(isMatchAtOrBeforePosition(outputMatch, cursor)).toBe(false);
	});

	it('output match in an earlier cell is before the cursor', () => {
		const outputMatch = match('output', 0);
		const cursor = position(1, 1, 1);

		expect(isMatchAtOrAfterPosition(outputMatch, cursor)).toBe(false);
		expect(isMatchAtOrBeforePosition(outputMatch, cursor)).toBe(true);
	});

	it('output match in a later cell is after the cursor', () => {
		const outputMatch = match('output', 2);
		const cursor = position(1, 1, 1);

		expect(isMatchAtOrAfterPosition(outputMatch, cursor)).toBe(true);
		expect(isMatchAtOrBeforePosition(outputMatch, cursor)).toBe(false);
	});

	it('input match containing the cursor is both at-or-after and at-or-before', () => {
		const inputMatch = match('input', 0, new Range(1, 1, 1, 6));
		const cursor = position(0, 1, 3);

		expect(isMatchAtOrAfterPosition(inputMatch, cursor)).toBe(true);
		expect(isMatchAtOrBeforePosition(inputMatch, cursor)).toBe(true);
	});

	it('input match ordering relative to the cursor is preserved', () => {
		const inputMatch = match('input', 0, new Range(1, 5, 1, 8));

		expect(isMatchAtOrAfterPosition(inputMatch, position(0, 1, 1))).toBe(true);
		expect(isMatchAtOrBeforePosition(inputMatch, position(0, 1, 1))).toBe(false);
		expect(isMatchAtOrAfterPosition(inputMatch, position(0, 1, 9))).toBe(false);
		expect(isMatchAtOrBeforePosition(inputMatch, position(0, 1, 9))).toBe(true);
	});
});
