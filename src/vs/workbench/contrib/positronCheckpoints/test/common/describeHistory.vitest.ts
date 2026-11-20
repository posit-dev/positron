/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ICheckpoint } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { cacheKey } from '../../common/agent/jobRunner.js';
import { describeHistoryJob, IDescribeHistoryInput, MAX_HISTORY_SUMMARY_CHARS } from '../../common/agent/describeHistory.js';

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
