/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import {
	computeMinimalTextEdit,
	computeShadowSyncActions,
	fenceLanguageToCellLanguage,
	ShadowCellSpec,
} from '../../common/quartoShadowNotebook.js';

function cell(language: string, text: string): ShadowCellSpec {
	return { language, text };
}

describe('fenceLanguageToCellLanguage', () => {
	it('maps fence languages to language IDs', () => {
		expect(fenceLanguageToCellLanguage('python')).toBe('python');
		expect(fenceLanguageToCellLanguage('python3')).toBe('python');
		expect(fenceLanguageToCellLanguage('r')).toBe('r');
		expect(fenceLanguageToCellLanguage('julia')).toBe('julia');
	});

	it('passes unknown fence languages through lowercased', () => {
		expect(fenceLanguageToCellLanguage('OJS')).toBe('ojs');
		expect(fenceLanguageToCellLanguage('bash')).toBe('bash');
	});
});

describe('computeMinimalTextEdit', () => {
	it('returns undefined for equal texts', () => {
		expect(computeMinimalTextEdit('x = 1', 'x = 1')).toBeUndefined();
	});

	it('computes a replacement in the middle', () => {
		expect(computeMinimalTextEdit('x = 1\ny = 2', 'x = 42\ny = 2')).toEqual({
			start: 4,
			end: 5,
			text: '42',
		});
	});

	it('computes a pure insertion', () => {
		expect(computeMinimalTextEdit('ab', 'aXb')).toEqual({ start: 1, end: 1, text: 'X' });
	});

	it('computes a pure deletion', () => {
		expect(computeMinimalTextEdit('aXb', 'ab')).toEqual({ start: 1, end: 2, text: '' });
	});

	it('does not overlap prefix and suffix on repeated characters', () => {
		// 'aa' -> 'aaa': prefix consumes both chars, suffix must not overlap.
		expect(computeMinimalTextEdit('aa', 'aaa')).toEqual({ start: 2, end: 2, text: 'a' });
	});

	it('handles full replacement', () => {
		expect(computeMinimalTextEdit('abc', 'xyz')).toEqual({ start: 0, end: 3, text: 'xyz' });
	});

	it('handles empty old text', () => {
		expect(computeMinimalTextEdit('', 'abc')).toEqual({ start: 0, end: 0, text: 'abc' });
	});

	it('handles empty new text', () => {
		expect(computeMinimalTextEdit('abc', '')).toEqual({ start: 0, end: 3, text: '' });
	});
});

describe('computeShadowSyncActions', () => {
	it('returns no actions for identical cell lists', () => {
		const cells = [cell('python', 'x = 1'), cell('r', 'y <- 2')];
		expect(computeShadowSyncActions(cells, cells)).toEqual([]);
	});

	it('returns no actions for two empty lists', () => {
		expect(computeShadowSyncActions([], [])).toEqual([]);
	});

	it('edits a single changed cell in place', () => {
		const oldCells = [cell('python', 'a'), cell('python', 'x = 1'), cell('python', 'c')];
		const newCells = [cell('python', 'a'), cell('python', 'x = 42'), cell('python', 'c')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'edit', index: 1, start: 4, end: 5, text: '42' },
		]);
	});

	it('edits multiple changed cells in place when the shape is unchanged', () => {
		const oldCells = [cell('python', 'a'), cell('r', 'b')];
		const newCells = [cell('python', 'a2'), cell('r', 'b2')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'edit', index: 0, start: 1, end: 1, text: '2' },
			{ kind: 'edit', index: 1, start: 1, end: 1, text: '2' },
		]);
	});

	it('splices an inserted cell in the middle', () => {
		const oldCells = [cell('python', 'a'), cell('python', 'c')];
		const newCells = [cell('python', 'a'), cell('r', 'b'), cell('python', 'c')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 1, deleteCount: 0, cells: [cell('r', 'b')] },
		]);
	});

	it('splices an appended cell', () => {
		const oldCells = [cell('python', 'a')];
		const newCells = [cell('python', 'a'), cell('python', 'b')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 1, deleteCount: 0, cells: [cell('python', 'b')] },
		]);
	});

	it('splices a removed cell', () => {
		const oldCells = [cell('python', 'a'), cell('r', 'b'), cell('python', 'c')];
		const newCells = [cell('python', 'a'), cell('python', 'c')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 1, deleteCount: 1, cells: [] },
		]);
	});

	it('splices a language change as a cell replacement', () => {
		const oldCells = [cell('python', 'a'), cell('python', 'x'), cell('python', 'c')];
		const newCells = [cell('python', 'a'), cell('r', 'x'), cell('python', 'c')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 1, deleteCount: 1, cells: [cell('r', 'x')] },
		]);
	});

	it('splices reordered cells of different languages', () => {
		const oldCells = [cell('python', 'a'), cell('r', 'b')];
		const newCells = [cell('r', 'b'), cell('python', 'a')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 0, deleteCount: 2, cells: [cell('r', 'b'), cell('python', 'a')] },
		]);
	});

	it('collapses a combined edit and insert into one splice', () => {
		// An edit and a structural change in the same window cannot be
		// separated without content keying; the window is replaced wholesale.
		const oldCells = [cell('python', 'a'), cell('python', 'b')];
		const newCells = [cell('python', 'a2'), cell('python', 'new'), cell('python', 'b')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 0, deleteCount: 1, cells: [cell('python', 'a2'), cell('python', 'new')] },
		]);
	});

	it('creates all cells for an empty notebook', () => {
		const newCells = [cell('python', 'a'), cell('r', 'b')];
		expect(computeShadowSyncActions([], newCells)).toEqual([
			{ kind: 'splice', index: 0, deleteCount: 0, cells: newCells },
		]);
	});

	it('removes all cells when the document loses its cells', () => {
		const oldCells = [cell('python', 'a'), cell('r', 'b')];
		expect(computeShadowSyncActions(oldCells, [])).toEqual([
			{ kind: 'splice', index: 0, deleteCount: 2, cells: [] },
		]);
	});

	it('anchors on identical duplicate cells without overlap', () => {
		// Two identical cells, one added: prefix matching must not consume
		// cells the suffix also needs.
		const oldCells = [cell('python', 'same'), cell('python', 'same')];
		const newCells = [cell('python', 'same'), cell('python', 'same'), cell('python', 'same')];
		expect(computeShadowSyncActions(oldCells, newCells)).toEqual([
			{ kind: 'splice', index: 2, deleteCount: 0, cells: [cell('python', 'same')] },
		]);
	});
});
