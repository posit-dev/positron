/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IChangedFile, IChangeSet, IHunk } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { fullSystemPrompt } from '../../common/agent/jobRunner.js';
import { MAX_INPUT_CHARS, STYLE_RULES, STYLE_SECOND_PERSON } from '../../common/agent/jobTypes.js';
import { splitIntoChunksJob } from '../../common/agent/splitIntoChunks.js';

function hunk(id: string, body: string, overrides: Partial<IHunk> = {}): IHunk {
	return { id, header: '@@ -1,2 +1,2 @@', addedLines: 1, removedLines: 1, patch: `@@ -1,2 +1,2 @@\n${body}`, ...overrides };
}

function changedFile(path: string, hunks: IHunk[], overrides: Partial<IChangedFile> = {}): IChangedFile {
	return { path, status: 'modified', binary: false, sizeBytes: 400, tooLarge: false, hunks, ...overrides };
}

const changes: IChangeSet = {
	basis: 'b1',
	files: [
		changedFile('dose.R', [hunk('h1', '-dose <- 5\n+dose <- 500\n'), hunk('h2', '-unit <- "g"\n+unit <- "mg"\n')]),
		changedFile('import_march.R', [hunk('h3', '+read.csv("march.csv")\n')], { status: 'added' }),
		changedFile('plot.png', [], { binary: true, sizeBytes: 20480 }),
	],
};

/** A proposal the check accepts for `changes`. */
const goodResponse = {
	chunks: [
		{ title: 'Capped the dose at 500 mg', summary: 'You raised the dose cap and changed the plot.', hunkIds: ['h1'], wholeFiles: ['plot.png'], finished: true },
		{ title: 'Started the March import', summary: 'You began reading the March data.', hunkIds: ['h3', 'h2'], wholeFiles: [], finished: false },
	],
};

/** `goodResponse` with the first chunk changed. */
function withFirstChunk(overrides: Record<string, unknown>) {
	return { chunks: [{ ...goodResponse.chunks[0], ...overrides }, goodResponse.chunks[1]] };
}

describe('splitIntoChunksJob', () => {
	test('prompt lists each hunk with its id, path, and text, wrapped as data', () => {
		const prompt = splitIntoChunksJob.buildPrompt(changes);

		expect(splitIntoChunksJob.weight).toBe('careful');
		expect(fullSystemPrompt(prompt.systemPrompt)).toContain(STYLE_RULES);
		const data = /BEGIN-DATA-(?<token>[0-9a-f]+)\n(?<data>[\s\S]*)\nEND-DATA-\k<token>/.exec(prompt.user)?.groups?.data;
		expect(data).toBe([
			'Part h1 of dose.R (changed)\n@@ -1,2 +1,2 @@\n-dose <- 5\n+dose <- 500',
			'Part h2 of dose.R (changed)\n@@ -1,2 +1,2 @@\n-unit <- "g"\n+unit <- "mg"',
			'Part h3 of import_march.R (new)\n@@ -1,2 +1,2 @@\n+read.csv("march.csv")',
			'Whole file plot.png (changed, data file, 20480 bytes, contents not shown)',
		].join('\n'));
	});

	test('an oversized list shortens the largest parts and keeps every id', () => {
		const huge: IChangeSet = {
			basis: 'b1',
			files: [changedFile('huge.R', [hunk('h1', '+x\n'.repeat(40000), { header: '@@ -1,0 +1,40000 @@', addedLines: 40000, removedLines: 0 }), hunk('h2', '+y\n')])],
		};

		const user = splitIntoChunksJob.buildPrompt(huge).user;

		expect(user.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
		expect(user).toContain('Part h1 of huge.R (changed): @@ -1,0 +1,40000 @@ (+40000 -0 lines, contents not shown)');
		expect(user).toContain('Part h2 of huge.R (changed)\n@@ -1,2 +1,2 @@\n+y');
	});

	test('a list that cannot fit even shortened gives no request', () => {
		const many: IChangeSet = {
			basis: 'b1',
			files: Array.from({ length: 2000 }, (_, index) => changedFile(`file${index}.R`, [hunk(`h${index}`, '+x\n')])),
		};

		expect(() => splitIntoChunksJob.buildPrompt(many)).toThrow();
	});

	test('check accepts a response that assigns every hunk once', () => {
		expect(splitIntoChunksJob.check(goodResponse, changes)).toEqual(goodResponse);
	});

	// Review Focus 5.
	test('check rejects an unknown hunk id', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ hunkIds: ['h1', 'h9'] }), changes)).toBeUndefined();
	});

	test('check rejects a hunk assigned twice', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ hunkIds: ['h1', 'h2'] }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ hunkIds: ['h1', 'h1'] }), changes)).toBeUndefined();
	});

	test('check rejects a missing hunk', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ hunkIds: [] }), changes)).toBeUndefined();
	});

	test('check rejects an unknown, missing, or repeated whole file, and a text file named whole', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ wholeFiles: ['plot.png', 'secret.csv'] }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ wholeFiles: [] }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ wholeFiles: ['plot.png', 'plot.png'] }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ hunkIds: [], wholeFiles: ['plot.png', 'dose.R'] }), changes)).toBeUndefined();
	});

	test('check rejects more than 8 chunks', () => {
		const files = Array.from({ length: 9 }, (_, index) => changedFile(`f${index}.R`, [hunk(`h${index}`, '+x\n')]));
		const nine: IChangeSet = { basis: 'b1', files };
		const chunk = (index: number) => ({ title: `Step ${index}`, summary: `You did step ${index}.`, hunkIds: [`h${index}`], wholeFiles: [], finished: true });

		expect(splitIntoChunksJob.check({ chunks: [0, 1, 2, 3, 4, 5, 6, 7].map(chunk).concat([{ ...chunk(8), hunkIds: [] }]) }, nine)).toBeUndefined();
		const eight = { chunks: [0, 1, 2, 3, 4, 5, 6].map(chunk).concat([{ ...chunk(7), hunkIds: ['h7', 'h8'] }]) };
		expect(splitIntoChunksJob.check(eight, nine)).toEqual(eight);
		expect(splitIntoChunksJob.check({ chunks: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(chunk) }, nine)).toBeUndefined();
		expect(splitIntoChunksJob.check({ chunks: [] }, nine)).toBeUndefined();
	});

	test('check applies the title rules of the description and rejects git words', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ title: 'x'.repeat(73) }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ title: 'Two\nlines' }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ title: 'Commit the dose cap' }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ summary: 'Ready to push.' }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ finished: 'yes' }), changes)).toBeUndefined();
	});

	test('check rejects an empty summary', () => {
		expect(splitIntoChunksJob.check(withFirstChunk({ summary: '' }), changes)).toBeUndefined();
		expect(splitIntoChunksJob.check(withFirstChunk({ summary: '  ' }), changes)).toBeUndefined();
	});

	test('the prompt asks for the second person', () => {
		expect(splitIntoChunksJob.buildPrompt(changes).systemPrompt).toContain(STYLE_SECOND_PERSON);
	});
});
