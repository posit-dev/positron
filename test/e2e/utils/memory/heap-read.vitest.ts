/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, test } from 'vitest';
import { readHeapSnapshot } from './heap-read.js';

const dir = mkdtempSync(join(tmpdir(), 'heap-read-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let counter = 0;
function writeSnapshot(contents: string): string {
	const path = join(dir, `snapshot-${counter++}.heapsnapshot`);
	writeFileSync(path, contents);
	return path;
}

const META = {
	meta: {
		node_fields: ['type', 'name', 'id', 'self_size', 'edge_count'],
		node_types: [['hidden', 'object']],
		edge_fields: ['type', 'name_or_index', 'to_node'],
		edge_types: [['context', 'weak']],
		location_fields: ['object_index', 'script_id', 'line', 'column']
	},
	node_count: 2,
	edge_count: 1
};

describe('readHeapSnapshot', () => {
	test('reads the metadata and the numeric arrays', () => {
		const path = writeSnapshot(JSON.stringify({
			snapshot: META,
			nodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			edges: [0, 1, 5],
			trace_function_infos: [],
			trace_tree: [],
			samples: [],
			locations: [0, 12, 3, 4],
			strings: ['', 'a "quoted" name', 'b']
		}));

		const snapshot = readHeapSnapshot(path);

		expect(snapshot.snapshot).toEqual(META);
		expect(Array.from(snapshot.nodes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(Array.from(snapshot.edges)).toEqual([0, 1, 5]);
		expect(Array.from(snapshot.locations!)).toEqual([0, 12, 3, 4]);
	});

	test('is not confused by digits or brackets inside the strings member', () => {
		// `strings` is the one member holding arbitrary text, and it sits after
		// the arrays. A scanner that lost its place here would mis-slice them.
		const path = writeSnapshot(JSON.stringify({
			snapshot: META,
			nodes: [7, 7],
			edges: [1],
			strings: ['"nodes": [999, 999]', 'a]}[{ 42', 'esc \\" 13'],
			locations: [0, 1, 2, 3]
		}));

		const snapshot = readHeapSnapshot(path);

		expect(Array.from(snapshot.nodes)).toEqual([7, 7]);
		expect(Array.from(snapshot.edges)).toEqual([1]);
		expect(Array.from(snapshot.locations!)).toEqual([0, 1, 2, 3]);
	});

	test('handles whitespace and a locations member that is absent', () => {
		const path = writeSnapshot(JSON.stringify({
			snapshot: META,
			nodes: [1, 2],
			edges: []
		}, null, 2));

		const snapshot = readHeapSnapshot(path);

		expect(Array.from(snapshot.nodes)).toEqual([1, 2]);
		expect(Array.from(snapshot.edges)).toEqual([]);
		expect(snapshot.locations).toBeUndefined();
	});

	test('reads negative values', () => {
		const path = writeSnapshot(JSON.stringify({ snapshot: META, nodes: [-1, 2, -30], edges: [0] }));

		expect(Array.from(readHeapSnapshot(path).nodes)).toEqual([-1, 2, -30]);
	});

	test('throws when a required member is missing', () => {
		const path = writeSnapshot(JSON.stringify({ snapshot: META, nodes: [1] }));

		expect(() => readHeapSnapshot(path)).toThrow(/missing edges/);
	});

	test('throws on a truncated file rather than returning a short array', () => {
		const path = writeSnapshot('{"snapshot":{},"nodes":[1,2,3');

		expect(() => readHeapSnapshot(path)).toThrow(/ended inside a nested value/);
	});

	test('throws when the file is not a JSON object', () => {
		const path = writeSnapshot('');

		expect(() => readHeapSnapshot(path)).toThrow(/not a JSON object/);
	});
});
