/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import {
	addChunk, chunkIsUsed, createDraft, isDraftReady, moveFile, reconcileDraft, setChunkText, setFileTicked, titleProblem, toChunks, usedChunkCount
} from '../../browser/components/chunkDraft.js';

function file(path: string, overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 10, tooLarge: false, hunks: [], ...overrides };
}

const files = [file('a.R'), file('b.R'), file('big.csv', { tooLarge: true, sizeBytes: 80 * 1024 * 1024 })];

describe('chunkDraft', () => {
	test('the first draft has one chunk with every file, and a file over the limit is unticked', () => {
		const draft = createDraft(files);

		expect(draft.chunks).toEqual([{
			id: 1, title: '', body: '', hunkIds: [],
			files: [{ path: 'a.R', ticked: true }, { path: 'b.R', ticked: true }, { path: 'big.csv', ticked: false }],
		}]);
	});

	test('initial chunks keep their text and hunk ids, and a file no chunk names goes unticked into the first chunk', () => {
		const draft = createDraft(files.slice(0, 2), [{ title: 'Fix plot', body: 'Axis', hunkIds: ['h1'], wholeFiles: ['b.R'] }]);

		expect(draft.chunks).toEqual([{
			id: 1, title: 'Fix plot', body: 'Axis', hunkIds: ['h1'],
			files: [{ path: 'b.R', ticked: true }, { path: 'a.R', ticked: false }],
		}]);
	});

	test('moving a file keeps its tick and leaves the other chunks alone', () => {
		let draft = createDraft(files.slice(0, 2));
		draft = setFileTicked(draft, 'b.R', false);
		draft = addChunk(draft);

		const moved = moveFile(draft, 'b.R', 2);

		expect(moved.chunks.map(chunk => chunk.files)).toEqual([[{ path: 'a.R', ticked: true }], [{ path: 'b.R', ticked: false }]]);
		expect(draft.chunks[0].files).toHaveLength(2);
		expect(moveFile(moved, 'missing.R', 1)).toBe(moved);
		expect(moveFile(moved, 'b.R', 9)).toBe(moved);
		expect(moveFile(moved, 'b.R', 2)).toBe(moved);
	});

	test('adding a chunk appends an empty chunk with a new id', () => {
		const draft = addChunk(addChunk(createDraft(files)));

		expect(draft.chunks.map(chunk => [chunk.id, chunk.files.length])).toEqual([[1, 3], [2, 0], [3, 0]]);
	});

	test('toChunks lists ticked files of used chunks in order, with trimmed text and no hunks', () => {
		let draft = addChunk(createDraft(files.slice(0, 2)));
		draft = moveFile(draft, 'b.R', 2);
		draft = setChunkText(draft, 1, { title: '  Fix plot ', body: ' Axis labels\n' });
		draft = setChunkText(draft, 2, { title: 'Import script' });

		expect(toChunks(draft)).toEqual([
			{ title: 'Fix plot', body: 'Axis labels', hunkIds: [], wholeFiles: ['a.R'] },
			{ title: 'Import script', body: '', hunkIds: [], wholeFiles: ['b.R'] },
		]);

		draft = setFileTicked(draft, 'b.R', false);
		expect(toChunks(draft).map(chunk => chunk.title)).toEqual(['Fix plot']);
		expect(usedChunkCount(draft)).toBe(1);
	});

	test('a chunk with only unticked files is not used', () => {
		const draft = setFileTicked(createDraft(files.slice(0, 1)), 'a.R', false);

		expect(chunkIsUsed(draft.chunks[0])).toBe(false);
		expect(toChunks(draft)).toEqual([]);
		expect(isDraftReady(draft)).toBe(false);
	});

	test('titles are empty, too long, or fine, measured trimmed', () => {
		expect(titleProblem('   ')).toBe('empty');
		expect(titleProblem('x'.repeat(73))).toBe('too-long');
		expect(titleProblem(` ${'x'.repeat(72)} `)).toBeUndefined();
	});

	test('the draft is ready when every used chunk has a usable title', () => {
		let draft = addChunk(createDraft(files.slice(0, 2)));
		draft = moveFile(draft, 'b.R', 2);
		draft = setChunkText(draft, 1, { title: 'One' });
		expect(isDraftReady(draft)).toBe(false);

		draft = setChunkText(draft, 2, { title: 'Two' });
		expect(isDraftReady(draft)).toBe(true);
	});

	test('reconciling drops files that are gone and adds new files ticked to the first chunk', () => {
		let draft = addChunk(createDraft(files.slice(0, 2)));
		draft = moveFile(draft, 'b.R', 2);

		const reconciled = reconcileDraft(draft, [file('b.R'), file('c.R'), file('huge.bin', { tooLarge: true })]);

		expect(reconciled.chunks.map(chunk => chunk.files)).toEqual([
			[{ path: 'c.R', ticked: true }, { path: 'huge.bin', ticked: false }],
			[{ path: 'b.R', ticked: true }],
		]);
	});
});
