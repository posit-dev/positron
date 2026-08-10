/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { parsePpid, parseSmapsRollup } from './process-tree.js';

const fixture = (name: string): string => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('real captured procfs output', () => {
	// Inline samples prove the parser handles the shape we think procfs has;
	// these prove it handles the shape it actually has.
	test('parses a real smaps_rollup', () => {
		const { pssBytes, rssBytes } = parseSmapsRollup(fixture('smaps_rollup.txt'));
		expect(pssBytes).toBeGreaterThan(0);
		expect(rssBytes).toBeGreaterThanOrEqual(pssBytes);
	});

	test('parses a real /proc/<pid>/status', () => {
		expect(parsePpid(fixture('proc-status.txt'))).toBeGreaterThan(0);
	});
});

describe('parseSmapsRollup', () => {
	test('reads Pss and Rss and converts kB to bytes', () => {
		const text = [
			'00400000-7fff00000000 ---p 00000000 00:00 0                  [rollup]',
			'Rss:              102400 kB',
			'Pss:               51200 kB',
			'Pss_Dirty:         40000 kB',
			'Shared_Clean:      51200 kB',
		].join('\n');
		expect(parseSmapsRollup(text)).toEqual({ pssBytes: 51200 * 1024, rssBytes: 102400 * 1024 });
	});

	test('does not confuse Pss_Dirty for Pss', () => {
		const text = 'Rss:  100 kB\nPss_Dirty:  999 kB\nPss:  50 kB';
		expect(parseSmapsRollup(text).pssBytes).toBe(50 * 1024);
	});

	test('returns zeroes when the fields are absent rather than throwing', () => {
		expect(parseSmapsRollup('')).toEqual({ pssBytes: 0, rssBytes: 0 });
	});
});

describe('parsePpid', () => {
	test('reads the parent pid', () => {
		const text = 'Name:\tpositron\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t4242\nPid:\t4242\nPPid:\t1\n';
		expect(parsePpid(text)).toBe(1);
	});

	test('returns 0 when PPid is missing', () => {
		expect(parsePpid('Name:\tpositron\n')).toBe(0);
	});
});
