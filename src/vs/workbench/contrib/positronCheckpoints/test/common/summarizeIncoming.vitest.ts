/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { DiffTarget, ICheckpoint, ICheckpointsEngineProxy, IIncomingPreview, IOverlap } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { incomingDiffBudget, ISummarizeIncomingInput, MAX_INCOMING_SUMMARY_CHARS, renderIncomingForModel, summarizeIncomingJob } from '../../common/agent/summarizeIncoming.js';
import { MAX_INPUT_CHARS } from '../../common/agent/jobTypes.js';

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
		expect(summarizeIncomingJob.check({ summary, relation: 'nearby' }, input())).toEqual({ summary: 'Maya updated the dosing table.', relation: 'nearby' });
		expect(summarizeIncomingJob.check({ summary, relation: 'nearby' }, input({ touchesLocalWork: true }))).toEqual({ summary: 'Maya updated the dosing table.', relation: 'nearby' });
		expect(summarizeIncomingJob.check({ summary, relation: 'overlapping' }, input({ touchesLocalWork: true, overlaps: [overlap] }))).toEqual({ summary: 'Maya updated the dosing table.', relation: 'overlapping' });
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
});
