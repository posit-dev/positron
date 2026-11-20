/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { VSBuffer } from '../../../../../base/common/buffer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { DiffTarget, ICheckpoint, ICheckpointsEngineProxy, IChangedFile } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { cacheKey, fullSystemPrompt } from '../../common/agent/jobRunner.js';
import { STYLE_THIRD_PERSON } from '../../common/agent/jobTypes.js';
import { describeHistoryJob, IDescribeHistoryInput, MAX_HISTORY_DIFF_CHARS, MAX_HISTORY_SUMMARY_CHARS, readHistoryDiff } from '../../common/agent/describeHistory.js';

const checkpoint: ICheckpoint = {
	id: 'abc123',
	title: 'fix: dose units (closes #12)',
	body: 'Switched calc_dose() to mg/kg; refactored helper.',
	authorName: 'Maya',
	authorIsMe: false,
	time: '2026-11-18T10:00:00Z',
	shared: true,
	partialFiles: [],
};

function input(overrides: Partial<ICheckpoint> = {}, diff = ''): IDescribeHistoryInput {
	return { checkpoint: { ...checkpoint, ...overrides }, diff };
}

const goodResponse = { title: 'Changed the dose units to mg/kg', summary: 'Maya changed the dose calculation to use milligrams per kilogram of body weight.' };

/** The text between the data marker lines of a prompt. */
function dataBlocks(user: string): string[] {
	return [...user.matchAll(/^BEGIN-DATA-(?<token>[0-9a-f]+)\n(?<data>[\s\S]*?)\nEND-DATA-\k<token>$/gm)].map(match => match.groups!.data);
}

describe('describeHistoryJob', () => {
	test('is a light job', () => {
		expect(describeHistoryJob.weight).toBe('light');
	});

	test('check accepts a plain title and summary, trimmed', () => {
		expect(describeHistoryJob.check(goodResponse, input())).toEqual(goodResponse);
		expect(describeHistoryJob.check({ title: ` ${goodResponse.title} `, summary: ` ${goodResponse.summary} ` }, input())).toEqual(goodResponse);
	});

	test('check rejects a title over 72 characters or on two lines', () => {
		expect(describeHistoryJob.check({ ...goodResponse, title: 'x'.repeat(72) }, input())).toBeDefined();
		expect(describeHistoryJob.check({ ...goodResponse, title: 'x'.repeat(73) }, input())).toBeUndefined();
		expect(describeHistoryJob.check({ ...goodResponse, title: 'Two\nlines' }, input())).toBeUndefined();
	});

	test('check rejects an empty or long summary', () => {
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'x'.repeat(MAX_HISTORY_SUMMARY_CHARS) }, input())).toBeDefined();
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'x'.repeat(MAX_HISTORY_SUMMARY_CHARS + 1) }, input())).toBeUndefined();
		expect(describeHistoryJob.check({ ...goodResponse, summary: ' ' }, input())).toBeUndefined();
	});

	test('check rejects git words and output of the wrong shape', () => {
		expect(describeHistoryJob.check({ ...goodResponse, title: 'Merged the dose branch' }, input())).toBeUndefined();
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'Maya made a commit.' }, input())).toBeUndefined();
		expect(describeHistoryJob.check({ title: goodResponse.title }, input())).toBeUndefined();
		expect(describeHistoryJob.check('Changed the units', input())).toBeUndefined();
	});

	test('check rejects a summary that starts with You, and the prompt asks for the third person', () => {
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'You updated the dose units.' }, input())).toBeUndefined();
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'Your colleague Maya updated the dose units.' }, input())).toBeDefined();
		expect(describeHistoryJob.buildPrompt(input()).systemPrompt).toContain(STYLE_THIRD_PERSON);
		expect(fullSystemPrompt(describeHistoryJob.buildPrompt(input()).systemPrompt)).not.toMatch(/second person/);
	});

	test('a colleague named like a git word does not let the word through', () => {
		expect(describeHistoryJob.check({ ...goodResponse, summary: 'Merge changed the dose units.' }, input({ authorName: 'Merge' }))).toBeUndefined();
	});

	test('check rejects a description of the person\'s own checkpoint', () => {
		expect(describeHistoryJob.check(goodResponse, input({ authorIsMe: true }))).toBeUndefined();
	});

	test('the prompt has the original message as untrusted data, and the diff only when there is one', () => {
		const withoutDiff = describeHistoryJob.buildPrompt(input()).user;
		const withDiff = describeHistoryJob.buildPrompt(input({}, 'File: dose.R\n+dose <- weight * 2')).user;

		expect(dataBlocks(withoutDiff)).toEqual(['Author: Maya\n\nfix: dose units (closes #12)\n\nSwitched calc_dose() to mg/kg; refactored helper.']);
		expect(dataBlocks(withDiff)).toEqual([dataBlocks(withoutDiff)[0], 'File: dose.R\n+dose <- weight * 2']);
	});

	test('the same checkpoint gives the same cache key', () => {
		const first = describeHistoryJob.buildPrompt(input());
		const second = describeHistoryJob.buildPrompt(input());

		expect(cacheKey(describeHistoryJob, [], first.systemPrompt, first.user)).toBe(cacheKey(describeHistoryJob, [], second.systemPrompt, second.user));
	});
});

describe('readHistoryDiff', () => {
	const textFile = (path: string): IChangedFile => ({ path, status: 'modified', binary: false, sizeBytes: 10, tooLarge: false, hunks: [] });

	/** An engine whose checkpoint `abc123` changed `files`; each file's sides are `old <path>` and `new <path>` repeated `lines` times. */
	function engineWith(files: IChangedFile[], lines = 1) {
		const compared: string[] = [];
		const engine = stubInterface<ICheckpointsEngineProxy>({
			getCheckpointFiles: async () => files,
			getDiff: async (target: DiffTarget) => {
				const path = target.kind === 'overlap' ? target.overlapId : target.path;
				compared.push(path);
				return { left: { kind: 'blob' as const, oid: `old ${path}` }, right: { kind: 'blob' as const, oid: `new ${path}` } };
			},
			readBlob: async oid => VSBuffer.fromString(`${oid}\n`.repeat(lines)),
		});
		return { engine, compared };
	}

	test('reads the contents of at most 5 files and names the others', async () => {
		const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => textFile(`${name}.R`));
		const { engine, compared } = engineWith(files);

		const diff = await readHistoryDiff(engine, 'abc123');

		expect(compared).toEqual(['a.R', 'b.R', 'c.R', 'd.R', 'e.R']);
		expect(diff).toContain('File: e.R (changed)\n@@ line 1 before, line 1 now @@\n-old e.R\n+new e.R');
		expect(diff.split('\n').slice(-2)).toEqual(['File: f.R (contents not shown)', 'File: g.R (contents not shown)']);
	});

	test('reads no data file and no file over the size limit', async () => {
		const { engine, compared } = engineWith([textFile('a.R'), { ...textFile('plot.png'), binary: true }, { ...textFile('big.csv'), tooLarge: true }]);

		const diff = await readHistoryDiff(engine, 'abc123');

		expect(compared).toEqual(['a.R']);
		expect(diff).toContain('File: plot.png (contents not shown)\nFile: big.csv (contents not shown)');
	});

	test('is at most 6,000 characters long', async () => {
		const { engine } = engineWith(['a', 'b', 'c'].map(name => textFile(`${name}.R`)), 400);

		const diff = await readHistoryDiff(engine, 'abc123');

		expect(MAX_HISTORY_DIFF_CHARS).toBe(6000);
		expect(diff.length).toBeLessThanOrEqual(MAX_HISTORY_DIFF_CHARS);
		expect(diff).toContain('File: a.R');
	});
});
