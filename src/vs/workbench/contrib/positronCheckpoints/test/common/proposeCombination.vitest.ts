/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IOverlap } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { cacheKey } from '../../common/agent/jobRunner.js';
import { MAX_INPUT_CHARS } from '../../common/agent/jobTypes.js';
import {
	contextAround, fitsInOneRequest, IProposeCombinationInput, MAX_EXPLANATION_CHARS, MAX_REASON_CHARS, proposeCombinationJob
} from '../../common/agent/proposeCombination.js';

const base = [
	'dose <- read.csv("dose.csv")',
	'cap <- 450',
	'units <- "mg"',
	'plot(dose)',
].join('\n') + '\n';

/** The person raised the cap. */
const mine = base.replace('cap <- 450', 'cap <- 500');

/** Maya changed the units on the line next to the cap. */
const theirs = base.replace('units <- "mg"', 'units <- "mg/kg"');

/** Both edits. */
const both = base.replace('cap <- 450', 'cap <- 500').replace('units <- "mg"', 'units <- "mg/kg"');

function textOverlap(overrides: Partial<IOverlap> = {}): IOverlap {
	return { id: 'o1', kind: 'text', path: 'R/dose.R', otherPaths: [], base, mine, theirs, theirAuthor: 'Maya', detail: '', ...overrides };
}

function input(overrides: Partial<IOverlap> = {}): IProposeCombinationInput {
	return { overlap: textOverlap(overrides), contextBefore: 'library(ggplot2)\n', contextAfter: 'summary(dose)\n', language: 'r' };
}

/** A response the check accepts for `input()`. */
const goodResponse = {
	mineDid: 'raised the dose cap to 500',
	theirsDid: 'changed the dose units to mg/kg',
	combined: both,
	confidence: 'high',
	reason: 'The two changes are on different lines and fit together.',
};

/** The text between the data marker lines of a prompt, by the label of each block. */
function dataBlocks(user: string): string[] {
	return [...user.matchAll(/^BEGIN-DATA-(?<token>[0-9a-f]+)\n(?<data>[\s\S]*?)\nEND-DATA-\k<token>$/gm)].map(match => match.groups!.data);
}

describe('proposeCombinationJob', () => {
	test('check accepts a combination that contains both edits', () => {
		expect(proposeCombinationJob.check(goodResponse, input())).toEqual(goodResponse);
	});

	test('check rejects conflict markers', () => {
		const marked = ['<<<<<<< mine', 'cap <- 500', '=======', 'cap <- 450', '>>>>>>> theirs', ''].join('\n');
		expect(proposeCombinationJob.check({ ...goodResponse, combined: marked }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, combined: `${both}<<<<<<< HEAD\n` }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, combined: `${both}>>>>>>> theirs\n` }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, combined: `${both}=======\n` }, input())).toBeUndefined();
	});

	test('a line of equals signs that one version has is not a marker', () => {
		const heading = (text: string) => `Results\n=======\n${text}`;
		const withHeading = input({ base: heading(base), mine: heading(mine), theirs: heading(theirs) });

		expect(proposeCombinationJob.check({ ...goodResponse, combined: heading(both) }, withHeading)?.confidence).toBe('high');
	});

	// Review Focus 5.
	test('a combination equal to one side is low confidence', () => {
		const onlyMine = proposeCombinationJob.check({ ...goodResponse, combined: mine }, input());
		const onlyTheirs = proposeCombinationJob.check({ ...goodResponse, combined: theirs.replace(/\n/g, '  \n') }, input());

		expect(onlyMine).toEqual({ ...goodResponse, combined: mine, confidence: 'low', reason: 'The suggestion keeps the changes of only one side.' });
		expect(onlyTheirs?.confidence).toBe('low');
	});

	test('a combination equal to the version before both changes is low confidence', () => {
		const dropped = proposeCombinationJob.check({ ...goodResponse, combined: base }, input());

		expect(dropped).toEqual({ ...goodResponse, combined: base, confidence: 'low', reason: 'The suggestion drops both changes.' });
		// The base with different trailing whitespace is the same text.
		expect(proposeCombinationJob.check({ ...goodResponse, combined: base.replace(/\n/g, ' \n') }, input())?.reason).toBe('The suggestion drops both changes.');
		// A side that did not change makes the base a valid answer, as the other side's text.
		expect(proposeCombinationJob.check({ ...goodResponse, combined: base }, input({ mine: base }))?.reason).toBe('The suggestion keeps the changes of only one side.');
	});

	test('a combination without any line that one side added is low confidence', () => {
		const baseThree = 'a\nb\nc\n';
		const overlap = { base: baseThree, mine: 'a\nB\nc\n', theirs: 'a\nb\nC\n' };
		// Keeps the line of theirs only, with a line of base changed to be neither.
		const noMine = 'a\nb\nC\nd\n';
		const bothKept = 'a\nB\nC\n';

		expect(proposeCombinationJob.check({ ...goodResponse, combined: noMine }, input(overlap))?.confidence).toBe('low');
		expect(proposeCombinationJob.check({ ...goodResponse, combined: 'a\nB\nb\nc\nd\n' }, input(overlap))?.confidence).toBe('low');
		expect(proposeCombinationJob.check({ ...goodResponse, combined: bothKept }, input(overlap))?.confidence).toBe('high');
		// A pure deletion adds no lines, so its rule does not apply.
		expect(proposeCombinationJob.check({ ...goodResponse, combined: 'a\nC\n' }, input({ ...overlap, mine: 'a\nc\n' }))?.confidence).toBe('high');
	});

	test('a combination with mostly new lines is low confidence', () => {
		const invented = ['dose <- read.csv("dose.csv")', 'cap <- 500', 'cap <- min(cap, 600)', 'units <- toupper("mg/kg")', 'scale <- 2', 'plot(dose)', ''].join('\n');

		expect(proposeCombinationJob.check({ ...goodResponse, combined: invented }, input())).toEqual({
			...goodResponse, combined: invented, confidence: 'low', reason: 'Most lines of the suggestion are in neither version.',
		});
		// Two new lines out of five is 40 percent, which is not more than 40 percent.
		const twoNew = both.replace('plot(dose)\n', 'plot(dose)\nabline(h = cap)\nlegend("top")\n').replace('dose <- read.csv("dose.csv")\n', '');
		expect(proposeCombinationJob.check({ ...goodResponse, combined: twoNew }, input())?.confidence).toBe('high');
	});

	test('lines compare without their trailing whitespace', () => {
		const spaced = both.replace(/\n/g, ' \t\n');

		expect(proposeCombinationJob.check({ ...goodResponse, combined: spaced }, input())?.confidence).toBe('high');
	});

	test('check rejects a non-text overlap', () => {
		expect(proposeCombinationJob.check(goodResponse, input({ kind: 'binary' }))).toBeUndefined();
		expect(proposeCombinationJob.check(goodResponse, input({ kind: 'rename' }))).toBeUndefined();
	});

	test('check rejects an empty combination unless one version is empty', () => {
		expect(proposeCombinationJob.check({ ...goodResponse, combined: '' }, input())).toBeUndefined();

		const deleted = proposeCombinationJob.check({ ...goodResponse, combined: '' }, input({ mine: '' }));
		expect(deleted).toEqual({ ...goodResponse, combined: '', confidence: 'low', reason: 'The suggestion keeps the changes of only one side.' });
		expect(proposeCombinationJob.check({ ...goodResponse, combined: '' }, input({ base: '' }))).toBeDefined();
	});

	test('check rejects a combination without a final line break when both versions have one', () => {
		expect(proposeCombinationJob.check({ ...goodResponse, combined: both.slice(0, -1) }, input())).toBeUndefined();

		const noBreak = input({ mine: mine.slice(0, -1) });
		expect(proposeCombinationJob.check({ ...goodResponse, combined: both.slice(0, -1) }, noBreak)).toBeDefined();
	});

	test('check limits the explanations and the reason, and rejects git words in them', () => {
		const long = (count: number) => 'x'.repeat(count);
		expect(MAX_EXPLANATION_CHARS).toBe(200);
		expect(MAX_REASON_CHARS).toBe(300);
		expect(proposeCombinationJob.check({ ...goodResponse, mineDid: long(200), theirsDid: long(200), reason: long(300) }, input())).toBeDefined();
		expect(proposeCombinationJob.check({ ...goodResponse, mineDid: long(201) }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, theirsDid: long(201) }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, reason: long(301) }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, mineDid: 'resolved the merge' }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, theirsDid: 'pushed a new cap' }, input())).toBeDefined();
		expect(proposeCombinationJob.check({ ...goodResponse, reason: 'This is a conflict.' }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, mineDid: '  ' }, input())).toBeUndefined();
	});

	test('check rejects output of the wrong shape', () => {
		expect(proposeCombinationJob.check({ ...goodResponse, confidence: 'medium' }, input())).toBeUndefined();
		expect(proposeCombinationJob.check({ ...goodResponse, combined: 3 }, input())).toBeUndefined();
		expect(proposeCombinationJob.check([goodResponse], input())).toBeUndefined();
	});

	test('the checked output passes the check again, as the cache requires', () => {
		const lowered = proposeCombinationJob.check({ ...goodResponse, combined: mine }, input())!;

		expect(proposeCombinationJob.check(lowered, input())).toEqual(lowered);
	});

	test('the prompt has each version and the context as separate untrusted blocks', () => {
		const prompt = proposeCombinationJob.buildPrompt(input());

		expect(prompt.systemPrompt).toContain('"combined"');
		expect(dataBlocks(prompt.user)).toEqual(['File: R/dose.R\nLanguage: r\nColleague: Maya', 'library(ggplot2)\n', base, mine, theirs, 'summary(dose)\n']);
	});

	test('the same input gives the same cache key', () => {
		const first = proposeCombinationJob.buildPrompt(input());
		const second = proposeCombinationJob.buildPrompt(input());

		expect(cacheKey(proposeCombinationJob, [], first.systemPrompt, first.user)).toBe(cacheKey(proposeCombinationJob, [], second.systemPrompt, second.user));
	});

	test('long context is shortened to the lines nearest the overlap', () => {
		const lines = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix}${index} ${'x'.repeat(1000)}`).join('\n') + '\n';
		const big = { ...input(), contextBefore: lines('before', 80), contextAfter: lines('after', 80) };

		const user = proposeCombinationJob.buildPrompt(big).user;
		const [, before, , , , after] = dataBlocks(user);

		expect(user.length).toBeLessThanOrEqual(MAX_INPUT_CHARS);
		expect(before.endsWith(`before79 ${'x'.repeat(1000)}\n`)).toBe(true);
		expect(before).not.toContain('before0 ');
		expect(after.startsWith('after0 ')).toBe(true);
		expect(after).not.toContain('after79 ');
	});

	test('an overlap whose versions do not fit in one request is not sent', () => {
		expect(fitsInOneRequest(textOverlap())).toBe(true);
		expect(fitsInOneRequest(textOverlap({ mine: 'x'.repeat(MAX_INPUT_CHARS) }))).toBe(false);
		expect(fitsInOneRequest(textOverlap({ kind: 'binary' }))).toBe(false);
	});
});

describe('contextAround', () => {
	const file = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n') + '\n';

	test('takes 40 lines before and after the first line of mine found in the file', () => {
		const context = contextAround(file, 'line 50\nline 51\n');

		expect(context.contextBefore).toBe(Array.from({ length: 40 }, (_, index) => `line ${index + 10}`).join('\n') + '\n');
		expect(context.contextAfter).toBe(Array.from({ length: 40 }, (_, index) => `line ${index + 52}`).join('\n') + '\n');
	});

	test('stops at the start and the end of the file', () => {
		const context = contextAround(file, 'line 2\n');

		expect(context.contextBefore).toBe('line 0\nline 1\n');
		expect(context.contextAfter.split('\n')[0]).toBe('line 3');
		expect(contextAround(file, 'line 98\nline 99\n').contextAfter).toBe('');
	});

	test('gives no context when the first line of mine is not in the file, or mine is empty', () => {
		expect(contextAround(file, 'cap <- 500\n')).toEqual({ contextBefore: '', contextAfter: '' });
		expect(contextAround(file, '')).toEqual({ contextBefore: '', contextAfter: '' });
	});

	test('finds the line without its trailing whitespace and with Windows line endings', () => {
		const windows = 'a\r\nb  \r\nc\r\nd\r\n';

		expect(contextAround(windows, 'b\nc\n')).toEqual({ contextBefore: 'a\n', contextAfter: 'd\n' });
	});
});
