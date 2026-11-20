/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IChangedFile, IHunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import {
	addChunk, chunkIsUsed, createDraft, draftPaths, IChunkDraft, isDraftReady, joinsUntickedEntry, moveFile, moveHunk, partialPaths, reconcileDraft, setChunkText, setChunkTicked,
	setFileTicked, titleProblem, toChunks, usedChunkCount
} from '../../browser/components/chunkDraft.js';

function file(path: string, overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 10, tooLarge: false, hunks: [], ...overrides };
}

function hunk(id: string): IHunk {
	return { id, header: '@@ -1 +1 @@', addedLines: 1, removedLines: 1, patch: `@@ -1 +1 @@\n-${id}\n+${id}!\n` };
}

/** A text file with the given hunks. */
function textFile(path: string, ...ids: string[]): IChangedFile {
	return file(path, { hunks: ids.map(hunk) });
}

const files = [file('a.R'), file('b.R'), file('big.csv', { tooLarge: true, sizeBytes: 80 * 1024 * 1024 })];

/** dose.R with three hunks, plot.R with one, and a data file without hunks. */
const mixed = [textFile('dose.R', 'd1', 'd2', 'd3'), textFile('plot.R', 'p1'), file('plot.png', { binary: true })];

describe('chunkDraft', () => {
	test('the first draft has one ticked chunk with every file, and a file over the limit is unticked', () => {
		const draft = createDraft(files);

		expect(draft.chunks).toEqual([{
			id: 1, title: '', body: '', ticked: true,
			files: [{ path: 'a.R', ticked: true, hunkIds: [] }, { path: 'b.R', ticked: true, hunkIds: [] }, { path: 'big.csv', ticked: false, hunkIds: [] }],
		}]);
	});

	test('the first draft holds every hunk of each text file', () => {
		expect(createDraft(mixed).chunks[0].files).toEqual([
			{ path: 'dose.R', ticked: true, hunkIds: ['d1', 'd2', 'd3'] },
			{ path: 'plot.R', ticked: true, hunkIds: ['p1'] },
			{ path: 'plot.png', ticked: true, hunkIds: [] },
		]);
	});

	test('initial chunks keep their text, and what no chunk names goes unticked into the first chunk', () => {
		const draft = createDraft(files.slice(0, 2), [{ title: 'Fix plot', body: 'Axis', hunkIds: [], wholeFiles: ['b.R'] }]);

		expect(draft.chunks).toEqual([{
			id: 1, title: 'Fix plot', body: 'Axis', ticked: true,
			files: [{ path: 'b.R', ticked: true, hunkIds: [] }, { path: 'a.R', ticked: false, hunkIds: [] }],
		}]);
	});

	test('initial chunks group their hunks by file and can start unticked', () => {
		const draft = createDraft(mixed, [
			{ title: 'Dose cap', body: '', hunkIds: ['d3', 'd1'], wholeFiles: ['plot.png'], ticked: true },
			{ title: 'Plot', body: '', hunkIds: ['p1', 'd2', 'unknown'], wholeFiles: [], ticked: false },
		]);

		expect(draft.chunks.map(chunk => [chunk.ticked, chunk.files])).toEqual([
			[true, [{ path: 'plot.png', ticked: true, hunkIds: [] }, { path: 'dose.R', ticked: true, hunkIds: ['d1', 'd3'] }]],
			[false, [{ path: 'plot.R', ticked: true, hunkIds: ['p1'] }, { path: 'dose.R', ticked: true, hunkIds: ['d2'] }]],
		]);
	});

	test('a hunk no initial chunk names joins its file in the first chunk', () => {
		const draft = createDraft(mixed, [{ title: 'Dose', body: '', hunkIds: ['d1'], wholeFiles: ['plot.R'] }]);

		expect(draft.chunks[0].files).toEqual([
			{ path: 'plot.R', ticked: true, hunkIds: ['p1'] },
			{ path: 'dose.R', ticked: true, hunkIds: ['d1', 'd2', 'd3'] },
			{ path: 'plot.png', ticked: false, hunkIds: [] },
		]);
	});

	test('a file named by two initial chunks stays in the first of them only', () => {
		const draft = createDraft(files.slice(0, 2), [
			{ title: 'One', body: '', hunkIds: [], wholeFiles: ['a.R', 'b.R'] },
			{ title: 'Two', body: '', hunkIds: [], wholeFiles: ['b.R'] },
		]);

		expect(draft.chunks.map(chunk => chunk.files.map(entry => entry.path))).toEqual([['a.R', 'b.R'], []]);
		expect(toChunks(setChunkText(draft, 2, { title: 'Two' })).map(chunk => chunk.wholeFiles)).toEqual([['a.R', 'b.R']]);
	});

	test('moving a file keeps its tick and leaves the other chunks alone', () => {
		let draft = createDraft(files.slice(0, 2));
		draft = setFileTicked(draft, 1, 'b.R', false);
		draft = addChunk(draft);

		const moved = moveFile(draft, 1, 'b.R', 2);

		expect(moved.chunks.map(chunk => chunk.files)).toEqual([[{ path: 'a.R', ticked: true, hunkIds: [] }], [{ path: 'b.R', ticked: false, hunkIds: [] }]]);
		expect(draft.chunks[0].files).toHaveLength(2);
		expect(moveFile(moved, 1, 'missing.R', 2)).toBe(moved);
		expect(moveFile(moved, 2, 'b.R', 9)).toBe(moved);
		expect(moveFile(moved, 2, 'b.R', 2)).toBe(moved);
	});

	test('moving a hunk between chunks updates both chunks', () => {
		const draft = addChunk(createDraft(mixed));

		const moved = moveHunk(draft, 'd2', 2);

		expect(moved.chunks.map(chunk => chunk.files.map(entry => [entry.path, entry.hunkIds]))).toEqual([
			[['dose.R', ['d1', 'd3']], ['plot.R', ['p1']], ['plot.png', []]],
			[['dose.R', ['d2']]],
		]);
		expect(moveHunk(moved, 'd2', 2)).toBe(moved);
		expect(moveHunk(moved, 'zz', 1)).toBe(moved);
		expect(moveHunk(moved, 'd1', 9)).toBe(moved);
	});

	test('a moved hunk joins its file in the other chunk in file order, and an emptied entry goes away', () => {
		let draft = addChunk(createDraft(mixed));
		draft = moveHunk(draft, 'd3', 2);
		draft = moveHunk(draft, 'd1', 2);
		draft = moveHunk(draft, 'p1', 2);

		expect(draft.chunks.map(chunk => chunk.files.map(entry => [entry.path, entry.hunkIds]))).toEqual([
			[['dose.R', ['d2']], ['plot.png', []]],
			[['dose.R', ['d1', 'd3']], ['plot.R', ['p1']]],
		]);

		draft = moveFile(draft, 1, 'dose.R', 2);
		expect(draft.chunks[1].files[0]).toEqual({ path: 'dose.R', ticked: true, hunkIds: ['d1', 'd2', 'd3'] });
	});

	test('a ticked move into an unticked entry of the same file is reported, because the moved parts become unticked', () => {
		let draft = addChunk(createDraft(mixed));
		draft = moveHunk(draft, 'd3', 2);
		draft = setFileTicked(draft, 2, 'dose.R', false);

		expect(joinsUntickedEntry(draft, 'dose.R', true, 2)).toBe(true);
		expect(moveHunk(draft, 'd1', 2).chunks[1].files).toEqual([{ path: 'dose.R', ticked: false, hunkIds: ['d1', 'd3'] }]);
		expect(joinsUntickedEntry(draft, 'dose.R', false, 2)).toBe(false);
		expect(joinsUntickedEntry(draft, 'plot.R', true, 2)).toBe(false);
		expect(joinsUntickedEntry(draft, 'dose.R', true, 1)).toBe(false);
		expect(joinsUntickedEntry(draft, 'dose.R', true, 9)).toBe(false);
	});

	test('toChunks sends a file split over chunks as hunk ids, and a whole file by path', () => {
		let draft = addChunk(createDraft(mixed));
		draft = moveHunk(draft, 'd2', 2);
		draft = moveFile(draft, 1, 'plot.png', 2);
		draft = setChunkText(draft, 1, { title: 'Dose cap' });
		draft = setChunkText(draft, 2, { title: 'Units' });

		expect(toChunks(draft)).toEqual([
			{ title: 'Dose cap', body: '', hunkIds: ['d1', 'd3'], wholeFiles: ['plot.R'] },
			{ title: 'Units', body: '', hunkIds: ['d2'], wholeFiles: ['plot.png'] },
		]);

		draft = moveHunk(draft, 'd2', 1);
		expect(toChunks(draft)).toEqual([
			{ title: 'Dose cap', body: '', hunkIds: [], wholeFiles: ['dose.R', 'plot.R'] },
			{ title: 'Units', body: '', hunkIds: [], wholeFiles: ['plot.png'] },
		]);
	});

	test('a chunk lists the files it holds only part of', () => {
		const draft = moveHunk(addChunk(createDraft(mixed)), 'd2', 2);

		expect(draft.chunks.map(chunk => partialPaths(draft, chunk))).toEqual([['dose.R'], ['dose.R']]);
	});

	test('adding a chunk appends an empty ticked chunk with a new id', () => {
		const draft = addChunk(addChunk(createDraft(files)));

		expect(draft.chunks.map(chunk => [chunk.id, chunk.ticked, chunk.files.length])).toEqual([[1, true, 3], [2, true, 0], [3, true, 0]]);
	});

	test('toChunks lists ticked files of used chunks in order, with trimmed text', () => {
		let draft = addChunk(createDraft(files.slice(0, 2)));
		draft = moveFile(draft, 1, 'b.R', 2);
		draft = setChunkText(draft, 1, { title: '  Fix plot ', body: ' Axis labels\n' });
		draft = setChunkText(draft, 2, { title: 'Import script' });

		expect(toChunks(draft)).toEqual([
			{ title: 'Fix plot', body: 'Axis labels', hunkIds: [], wholeFiles: ['a.R'] },
			{ title: 'Import script', body: '', hunkIds: [], wholeFiles: ['b.R'] },
		]);

		draft = setFileTicked(draft, 2, 'b.R', false);
		expect(toChunks(draft).map(chunk => chunk.title)).toEqual(['Fix plot']);
		expect(usedChunkCount(draft)).toBe(1);
	});

	test('an unticked chunk is not used, whatever it holds', () => {
		const draft = setChunkTicked(setChunkText(createDraft(files.slice(0, 1)), 1, { title: 'Fix' }), 1, false);

		expect(chunkIsUsed(draft.chunks[0])).toBe(false);
		expect(toChunks(draft)).toEqual([]);
		expect(isDraftReady(draft)).toBe(false);
		expect(isDraftReady(setChunkTicked(draft, 1, true))).toBe(true);
	});

	test('a chunk with only unticked files is not used', () => {
		const draft = setFileTicked(createDraft(files.slice(0, 1)), 1, 'a.R', false);

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
		draft = moveFile(draft, 1, 'b.R', 2);
		draft = setChunkText(draft, 1, { title: 'One' });
		expect(isDraftReady(draft)).toBe(false);

		draft = setChunkText(draft, 2, { title: 'Two' });
		expect(isDraftReady(draft)).toBe(true);
	});

	test('reconciling drops files that are gone and adds new files ticked to the first chunk', () => {
		let draft = addChunk(createDraft(files.slice(0, 2)));
		draft = moveFile(draft, 1, 'b.R', 2);

		const reconciled = reconcileDraft(draft, [file('b.R'), file('c.R'), file('huge.bin', { tooLarge: true })]);

		expect(reconciled.chunks.map(chunk => chunk.files)).toEqual([
			[{ path: 'c.R', ticked: true, hunkIds: [] }, { path: 'huge.bin', ticked: false, hunkIds: [] }],
			[{ path: 'b.R', ticked: true, hunkIds: [] }],
		]);
	});

	test('reconciling drops hunks that are gone and adds new hunks where their file is', () => {
		let draft = addChunk(createDraft(mixed));
		draft = moveHunk(draft, 'd2', 2);
		draft = moveHunk(draft, 'p1', 2);
		draft = setFileTicked(draft, 2, 'plot.R', false);

		const reconciled = reconcileDraft(draft, [textFile('dose.R', 'd1', 'd2', 'd4'), textFile('plot.R', 'p2'), file('plot.png', { binary: true })]);

		expect(reconciled.chunks.map(chunk => chunk.files.map(entry => [entry.path, entry.ticked, entry.hunkIds]))).toEqual([
			[['dose.R', true, ['d1', 'd4']], ['plot.png', true, []]],
			[['dose.R', true, ['d2']], ['plot.R', false, ['p2']]],
		]);
		expect(reconciled.hunksByPath.get('dose.R')).toEqual(['d1', 'd2', 'd4']);
	});

	test('draftPaths lists every file, ticked or not', () => {
		const draft = setFileTicked(createDraft(files), 1, 'a.R', false);

		expect([...draftPaths(draft)]).toEqual(['a.R', 'b.R', 'big.csv']);
	});

	describe('every hunk and every file without hunks is in at most one ticked chunk', () => {
		const changes = [textFile('dose.R', 'd1', 'd2', 'd3', 'd4'), textFile('plot.R', 'p1', 'p2'), file('plot.png', { binary: true }), file('notes.txt')];
		const allHunks = changes.flatMap(entry => entry.hunks.map(part => part.id));

		/** Each hunk and each file without hunks, and how many chunks of the draft hold it. */
		function holders(draft: IChunkDraft): Map<string, number> {
			const counts = new Map<string, number>();
			for (const chunk of draft.chunks) {
				for (const entry of chunk.files) {
					for (const key of entry.hunkIds.length > 0 ? entry.hunkIds : [entry.path]) {
						counts.set(key, (counts.get(key) ?? 0) + 1);
					}
				}
			}
			return counts;
		}

		/** Each hunk and each file without hunks, and how many chunks sent to the engine hold it. */
		function sent(draft: IChunkDraft): Map<string, number> {
			const counts = new Map<string, number>();
			for (const chunk of toChunks(draft)) {
				const keys = [...chunk.hunkIds, ...chunk.wholeFiles.flatMap(path => {
					const ids = draft.hunksByPath.get(path) ?? [];
					return ids.length > 0 ? ids : [path];
				})];
				for (const key of keys) {
					counts.set(key, (counts.get(key) ?? 0) + 1);
				}
			}
			return counts;
		}

		/** A deterministic sequence of numbers in [0, 1). */
		function sequence(seed: number): () => number {
			let state = seed;
			return () => {
				state = (state * 1103515245 + 12345) % 2147483648;
				return state / 2147483648;
			};
		}

		test('after any sequence of moves and ticks', () => {
			for (let seed = 1; seed <= 40; seed++) {
				const next = sequence(seed);
				const pick = <T>(values: readonly T[]): T => values[Math.floor(next() * values.length)];
				let draft = addChunk(addChunk(createDraft(changes)));
				for (const chunk of draft.chunks) {
					draft = setChunkText(draft, chunk.id, { title: `Chunk ${chunk.id}` });
				}
				for (let step = 0; step < 30; step++) {
					const chunkIds = draft.chunks.map(chunk => chunk.id);
					const action = pick(['hunk', 'file', 'tick-file', 'tick-chunk']);
					if (action === 'hunk') {
						draft = moveHunk(draft, pick(allHunks), pick(chunkIds));
					} else if (action === 'file') {
						const from = pick(draft.chunks);
						if (from.files.length > 0) {
							draft = moveFile(draft, from.id, pick(from.files).path, pick(chunkIds));
						}
					} else if (action === 'tick-file') {
						const chunk = pick(draft.chunks);
						if (chunk.files.length > 0) {
							draft = setFileTicked(draft, chunk.id, pick(chunk.files).path, next() < 0.5);
						}
					} else {
						draft = setChunkTicked(draft, pick(chunkIds), next() < 0.5);
					}

					const held = holders(draft);
					expect([...held.keys()].sort()).toEqual([...allHunks, 'notes.txt', 'plot.png'].sort());
					expect([...held.values()].every(count => count === 1)).toBe(true);
					expect([...sent(draft).values()].every(count => count === 1)).toBe(true);
					for (const chunk of draft.chunks) {
						expect(new Set(chunk.files.map(entry => entry.path)).size).toBe(chunk.files.length);
					}
				}
			}
		});

		test('for initial chunks that name a hunk or a file twice', () => {
			const draft = createDraft(changes, [
				{ title: 'One', body: '', hunkIds: ['d1', 'p1'], wholeFiles: ['plot.png', 'dose.R'] },
				{ title: 'Two', body: '', hunkIds: ['d1', 'd2', 'p2'], wholeFiles: ['plot.png', 'notes.txt', 'plot.R'] },
			]);

			expect([...holders(draft).values()].every(count => count === 1)).toBe(true);
			expect([...sent(draft).values()].every(count => count === 1)).toBe(true);
			expect(toChunks(draft)).toEqual([
				{ title: 'One', body: '', hunkIds: ['p1'], wholeFiles: ['plot.png', 'dose.R'] },
				{ title: 'Two', body: '', hunkIds: ['p2'], wholeFiles: ['notes.txt'] },
			]);
		});

		test('for a file without hunks, which is sent only in wholeFiles', () => {
			const draft = setChunkText(createDraft(changes), 1, { title: 'All' });

			expect(toChunks(draft)).toEqual([{ title: 'All', body: '', hunkIds: [], wholeFiles: ['dose.R', 'plot.R', 'plot.png', 'notes.txt'] }]);
		});
	});
});
