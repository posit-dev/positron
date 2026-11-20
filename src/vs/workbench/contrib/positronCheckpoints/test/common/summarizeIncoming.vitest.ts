/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { DiffTarget, ICheckpoint, ICheckpointsEngineProxy, IIncomingPreview, IOverlap } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import {
	incomingDiffBudget, ISummarizeIncomingInput, MAX_DIFF_MS, MAX_INCOMING_SUMMARY_CHARS, MAX_LISTED_CHECKPOINTS, MAX_LISTED_PATHS, MAX_RENDERED_LINES_PER_FILE,
	renderIncomingForModel, summarizeIncomingJob
} from '../../common/agent/summarizeIncoming.js';
import { MAX_INPUT_CHARS, STYLE_SECOND_PERSON, STYLE_THIRD_PERSON } from '../../common/agent/jobTypes.js';
import { fullSystemPrompt } from '../../common/agent/jobRunner.js';

const mayaCheckpoint: ICheckpoint = {
	id: 'm1', title: 'Updated the dosing table', body: '', authorName: 'Maya', authorIsMe: false, time: '2026-11-19T10:00:00Z', shared: true, partialFiles: [],
};

const overlap: IOverlap = { id: 'o1', kind: 'text', path: 'dose.R', otherPaths: [], theirAuthor: 'Maya', detail: '' };

function preview(overrides: Partial<IIncomingPreview> = {}): IIncomingPreview {
	return {
		basis: 'b1',
		incoming: [mayaCheckpoint],
		changedPaths: ['dosing.csv'],
		touchesLocalWork: false,
		overlaps: [],
		collisions: [],
		...overrides,
	};
}

function input(previewOverrides: Partial<IIncomingPreview> = {}): ISummarizeIncomingInput {
	return { preview: preview(previewOverrides), incomingDiff: 'File: dosing.csv (changed)', myChangedPaths: ['plot_dose.R'] };
}

describe('summarizeIncomingJob', () => {
	test('is a light job', () => {
		expect(summarizeIncomingJob.weight).toBe('light');
	});

	test('accepts a relation that agrees with the engine', () => {
		const summary = '  Maya updated the dosing table.  ';
		expect(summarizeIncomingJob.check({ summary, relation: 'unrelated' }, input())).toEqual({ summary: 'Maya updated the dosing table.', relation: 'unrelated' });
		expect(summarizeIncomingJob.check({ summary, relation: 'nearby' }, input({ touchesLocalWork: true }))).toEqual({ summary: 'Maya updated the dosing table.', relation: 'nearby' });
		expect(summarizeIncomingJob.check({ summary, relation: 'overlapping' }, input({ touchesLocalWork: true, overlaps: [overlap] }))).toEqual({ summary: 'Maya updated the dosing table.', relation: 'overlapping' });
	});

	test('check rejects nearby unless the engine says local work is touched and there are no overlaps', () => {
		const summary = 'Maya updated the dosing table.';
		expect(summarizeIncomingJob.check({ summary, relation: 'nearby' }, input())).toBeUndefined();
		expect(summarizeIncomingJob.check({ summary, relation: 'nearby' }, input({ touchesLocalWork: true, overlaps: [overlap] }))).toBeUndefined();
	});

	test('check rejects a summary that speaks to the person as the author', () => {
		expect(summarizeIncomingJob.check({ summary: 'You updated the dosing table.', relation: 'unrelated' }, input())).toBeUndefined();
		expect(summarizeIncomingJob.check({ summary: 'Your colleague Maya updated the dosing table.', relation: 'unrelated' }, input())).toBeDefined();
	});

	test('the prompt asks for the third person', () => {
		const prompt = summarizeIncomingJob.buildPrompt(input());

		expect(prompt.systemPrompt).toContain(STYLE_THIRD_PERSON);
		expect(prompt.systemPrompt).not.toContain(STYLE_SECOND_PERSON);
		expect(fullSystemPrompt(prompt.systemPrompt)).not.toMatch(/second person/);
	});

	test('the lists of checkpoints and changed files are capped, with a count of the rest', () => {
		const many = Array.from({ length: 35 }, (_, index) => ({ ...mayaCheckpoint, id: `m${index}`, title: `Step ${index}` }));
		const paths = Array.from({ length: 120 }, (_, index) => `file${index}.R`);

		const user = summarizeIncomingJob.buildPrompt({ ...input({ incoming: many }), myChangedPaths: paths }).user;

		expect(user).toContain('- "Step 29" by Maya\n... and 5 more');
		expect(user).not.toContain('"Step 30"');
		expect(user).toContain('file99.R\n... and 20 more');
		expect(user).not.toContain('file100.R');
		expect(MAX_LISTED_CHECKPOINTS).toBe(30);
		expect(MAX_LISTED_PATHS).toBe(100);
	});

	test('check rejects overlapping when the engine found no overlaps', () => {
		expect(summarizeIncomingJob.check({ summary: 'Maya changed the dose.', relation: 'overlapping' }, input({ touchesLocalWork: true }))).toBeUndefined();
		// And the other way round: overlaps the model did not name.
		expect(summarizeIncomingJob.check({ summary: 'Maya changed the dose.', relation: 'nearby' }, input({ touchesLocalWork: true, overlaps: [overlap] }))).toBeUndefined();
	});

	test('check rejects unrelated when the engine says local work is touched', () => {
		expect(summarizeIncomingJob.check({ summary: 'Maya changed the dose.', relation: 'unrelated' }, input({ touchesLocalWork: true }))).toBeUndefined();
	});

	test('check rejects a long or empty summary, an unknown relation, and git words', () => {
		const check = (raw: unknown) => summarizeIncomingJob.check(raw, input());
		expect(check({ summary: 'x'.repeat(MAX_INCOMING_SUMMARY_CHARS), relation: 'unrelated' })).toBeDefined();
		expect(check({ summary: 'x'.repeat(MAX_INCOMING_SUMMARY_CHARS + 1), relation: 'unrelated' })).toBeUndefined();
		expect(check({ summary: '  ', relation: 'unrelated' })).toBeUndefined();
		expect(check({ summary: 'Maya changed the dose.', relation: 'related' })).toBeUndefined();
		expect(check({ summary: 'Maya made a commit to the dosing table.', relation: 'unrelated' })).toBeUndefined();
		expect(check({ relation: 'unrelated' })).toBeUndefined();
	});

	test('the prompt states the engine facts and wraps the project content', () => {
		const { user } = summarizeIncomingJob.buildPrompt(input({ touchesLocalWork: true, overlaps: [overlap, { ...overlap, id: 'o2' }] }));

		expect(user).toContain('in 2 places, the colleagues and the person changed the same lines');
		expect(user).toContain('Some of the colleagues\' changes are in files the person also changed.');
		expect(user).toMatch(/BEGIN-DATA-[0-9a-f]{32}\nCheckpoints from the colleagues:\n- "Updated the dosing table" by Maya\n/);
		expect(user).toContain('Files the person changed since their last checkpoint:\nplot_dose.R');
		expect(user).toContain('File: dosing.csv (changed)');
	});
});

describe('renderIncomingForModel', () => {
	const sides: Record<string, { left: string; right: string }> = {
		'dose.R': { left: 'old-dose', right: 'new-dose' },
		'plot.png': { left: 'old-plot', right: 'new-plot' },
		'notes.md': { left: '', right: 'new-notes' },
	};
	const blobs = new Map<string, VSBuffer>([
		['old-dose', VSBuffer.fromString('dose <- 10\nunit <- "mg"\ncap <- 400\n')],
		['new-dose', VSBuffer.fromString('dose <- 10\nunit <- "mg/kg"\ncap <- 500\n')],
		['old-plot', VSBuffer.wrap(new Uint8Array([0x89, 0x50, 0x00, 0x01]))],
		['new-plot', VSBuffer.wrap(new Uint8Array([0x89, 0x50, 0x00, 0x01, 0x02, 0x03]))],
		['new-notes', VSBuffer.fromString('# Notes\n')],
	]);
	let getDiff: ReturnType<typeof vi.fn<(target: DiffTarget) => ReturnType<ICheckpointsEngineProxy['getDiff']>>>;
	let engine: ICheckpointsEngineProxy;

	beforeEach(() => {
		getDiff = vi.fn(async (target: DiffTarget) => {
			const side = sides[target.path];
			return {
				left: side.left === '' ? { kind: 'empty' as const } : { kind: 'blob' as const, oid: side.left },
				right: { kind: 'blob' as const, oid: side.right },
			};
		});
		engine = stubInterface<ICheckpointsEngineProxy>({ getDiff, readBlob: async oid => blobs.get(oid) ?? VSBuffer.alloc(0) });
	});

	test('shows the changed lines of each text file and a data file by name and size', async () => {
		const text = await renderIncomingForModel(engine, preview({ changedPaths: ['dose.R', 'plot.png', 'notes.md'] }), MAX_INPUT_CHARS);

		expect(text).toBe([
			'File: dose.R (changed)',
			'@@ line 2 before, line 2 now @@',
			'-unit <- "mg"',
			'-cap <- 400',
			'+unit <- "mg/kg"',
			'+cap <- 500',
			'File: plot.png (changed, data file, 4 bytes before, 6 bytes now, contents not shown)',
			'File: notes.md (new)',
			'@@ line 1 before, line 1 now @@',
			'+# Notes',
		].join('\n'));
		expect(getDiff.mock.calls).toEqual([[{ kind: 'incoming', path: 'dose.R' }], [{ kind: 'incoming', path: 'plot.png' }], [{ kind: 'incoming', path: 'notes.md' }]]);
	});

	test('stays within the limit by shortening files to their name and line counts', async () => {
		const text = await renderIncomingForModel(engine, preview({ changedPaths: ['dose.R', 'notes.md'] }), 120);

		expect(text.length).toBeLessThanOrEqual(120);
		expect(text).toContain('File: dose.R (changed, +2 -2 lines, contents not shown)');
	});

	test('the budget leaves room for the lists of checkpoints and files', () => {
		expect(incomingDiffBudget(preview(), [])).toBeLessThan(MAX_INPUT_CHARS);
		expect(incomingDiffBudget(preview(), ['a'.repeat(100)])).toBe(incomingDiffBudget(preview(), []) - 100 + '(none)'.length);
	});

	describe('reading limits', () => {
		const text = (name: string) => VSBuffer.fromString(`${name} <- 1\n`);

		/** An engine whose files `f0`, `f1`, ... have a changed line, with `size` overriding blob contents. */
		function manyFiles(count: number, overrides: Record<string, VSBuffer> = {}) {
			let active = 0;
			let peak = 0;
			const reads: string[] = [];
			const fake = stubInterface<ICheckpointsEngineProxy>({
				getDiff: async target => ({ left: { kind: 'blob' as const, oid: `old-${target.path}` }, right: { kind: 'blob' as const, oid: `new-${target.path}` } }),
				readBlob: async oid => {
					reads.push(oid);
					active++;
					peak = Math.max(peak, active);
					await new Promise(resolve => setTimeout(resolve, 0));
					active--;
					return overrides[oid] ?? text(oid);
				},
			});
			const paths = Array.from({ length: count }, (_, i) => `f${i}`);
			return { engine: fake, paths, reads, peak: () => peak };
		}

		test('reads at most 4 files at a time (2 blobs each)', async () => {
			const { engine: fake, paths, peak } = manyFiles(12);

			await renderIncomingForModel(fake, preview({ changedPaths: paths }), MAX_INPUT_CHARS);

			expect(peak()).toBe(8);
		});

		test('stops reading once the text reaches the limit', async () => {
			const { engine: fake, paths, reads } = manyFiles(30);

			const result = await renderIncomingForModel(fake, preview({ changedPaths: paths }), 300);

			expect(result.length).toBeLessThanOrEqual(300);
			expect(reads.length).toBeLessThan(30 * 2);
			expect(reads).not.toContain('new-f29');
		});

		test('lists a file with a side over 512 KB by name and size without comparing it', async () => {
			const big = VSBuffer.wrap(new Uint8Array(512 * 1024 + 1).fill(97));
			const { engine: fake } = manyFiles(2, { 'new-f0': big });

			const result = await renderIncomingForModel(fake, preview({ changedPaths: ['f0', 'f1'] }), MAX_INPUT_CHARS);

			expect(result).toBe([
				`File: f0 (changed, too large to compare, ${'old-f0 <- 1\n'.length} bytes before, ${512 * 1024 + 1} bytes now, contents not shown)`,
				'File: f1 (changed)',
				'@@ line 1 before, line 1 now @@',
				'-old-f1 <- 1',
				'+new-f1 <- 1',
			].join('\n'));
		});

		test('a file whose comparison takes longer than 50 ms is listed by name and line counts', async () => {
			const lines = (prefix: string) => VSBuffer.fromString(Array.from({ length: 50 }, (_, index) => `${prefix}${index}`).join('\n') + '\n');
			const { engine: fake } = manyFiles(2, { 'old-f0': lines('a'), 'new-f0': lines('b') });
			// Every reading of the clock is 30 ms later, so the comparison of f0 runs out of time.
			let clock = 0;
			const now = () => {
				clock += 30;
				return clock;
			};

			const result = await renderIncomingForModel(fake, preview({ changedPaths: ['f0'] }), MAX_INPUT_CHARS, now);

			expect(MAX_DIFF_MS).toBe(50);
			expect(result).toBe('File: f0 (changed, 50 lines before, 50 lines now, contents not shown)');
		});

		test('a file shows at most 2,000 changed lines', async () => {
			const lines = (prefix: string) => VSBuffer.fromString(Array.from({ length: 1500 }, (_, index) => `${prefix}${index}`).join('\n') + '\n');
			const { engine: fake } = manyFiles(1, { 'old-f0': lines('a'), 'new-f0': lines('b') });

			const result = await renderIncomingForModel(fake, preview({ changedPaths: ['f0'] }), MAX_INPUT_CHARS);

			expect(MAX_RENDERED_LINES_PER_FILE).toBe(2000);
			const shown = result.split('\n');
			expect(shown).toHaveLength(1 + 2000 + 1);
			expect(shown.at(-1)).toBe('(1001 more lines are not shown)');
		});

		test('reads at most 40 files and lists the rest by name', async () => {
			const { engine: fake, paths, reads } = manyFiles(45);

			const result = await renderIncomingForModel(fake, preview({ changedPaths: paths }), MAX_INPUT_CHARS);

			expect(reads).toHaveLength(80);
			expect(result).toContain('@@ line 1 before, line 1 now @@\n-old-f39 <- 1');
			expect(result).toContain('File: f44 (contents not shown)');
			expect(result).not.toContain('old-f40');
		});
	});
});
