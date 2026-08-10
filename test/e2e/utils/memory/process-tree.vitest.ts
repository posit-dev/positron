/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { RawProcess } from './types.js';
import { buildTree, parsePpid, parseSmapsRollup } from './process-tree.js';

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

describe('buildTree', () => {
	const proc = (pid: number, ppid: number): RawProcess =>
		({ pid, ppid, cmd: `p${pid}`, pssBytes: 10, rssBytes: 20 });

	const map = (...procs: RawProcess[]): Map<number, RawProcess> =>
		new Map(procs.map(p => [p.pid, p]));

	test('returns the root first, then its descendants', () => {
		const tree = buildTree(map(proc(100, 1), proc(101, 100), proc(102, 101)), 100);
		expect(tree.map(p => p.pid)).toEqual([100, 101, 102]);
	});

	test('returns an empty list when the root is absent from /proc', () => {
		// The app died between the readdir sweep and the walk.
		expect(buildTree(map(proc(101, 100)), 100)).toEqual([]);
	});

	test('returns just the root when it has no children', () => {
		expect(buildTree(map(proc(100, 1)), 100).map(p => p.pid)).toEqual([100]);
	});

	test('excludes processes that are not descendants of the root', () => {
		const tree = buildTree(map(proc(100, 1), proc(101, 100), proc(900, 1), proc(901, 900)), 100);
		expect(tree.map(p => p.pid)).toEqual([100, 101]);
	});

	test('walks breadth first, so siblings precede grandchildren', () => {
		const tree = buildTree(map(proc(100, 1), proc(101, 100), proc(102, 100), proc(103, 101)), 100);
		expect(tree.map(p => p.pid)).toEqual([100, 101, 102, 103]);
	});

	test('terminates on a parent cycle rather than looping forever', () => {
		// Not something Linux produces, but the guard is what makes the walk safe
		// to run against a map assembled from a racing /proc sweep.
		const tree = buildTree(map(proc(100, 101), proc(101, 100)), 100);
		expect(tree.map(p => p.pid)).toEqual([100, 101]);
	});
});
