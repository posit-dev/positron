/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, test } from 'vitest';
import { attributeHeap, HeapSnapshotJson } from './heap-attribute.js';

const NODE_FIELDS = ['type', 'name', 'id', 'self_size', 'edge_count', 'detachedness'];
const EDGE_FIELDS = ['type', 'name_or_index', 'to_node'];
const LOCATION_FIELDS = ['object_index', 'script_id', 'line', 'column'];
const EDGE_TYPES = ['context', 'element', 'property', 'internal', 'hidden', 'shortcut', 'weak'];
const F = NODE_FIELDS.length;
const E = EDGE_FIELDS.length;

type NodeSpec = { self: number; to: number[]; weakTo?: number[] };

/**
 * Builds a snapshot in V8's own layout. Node 0 is the root, `to` holds node
 * indices, and both `to_node` and `object_index` are node-array offsets
 * (index * node_fields.length), which is what V8 emits and what the parser
 * has to divide back out.
 */
function buildSnapshot(specs: NodeSpec[], locations: [nodeIndex: number, scriptId: number][] = []): HeapSnapshotJson {
	const nodes: number[] = [];
	const edges: number[] = [];
	for (const spec of specs) {
		const outgoing = [...spec.to, ...(spec.weakTo ?? [])];
		nodes.push(0, 0, nodes.length / F, spec.self, outgoing.length, 0);
		for (const target of spec.to) {
			edges.push(EDGE_TYPES.indexOf('property'), 0, target * F);
		}
		for (const target of spec.weakTo ?? []) {
			edges.push(EDGE_TYPES.indexOf('weak'), 0, target * F);
		}
	}
	return {
		snapshot: {
			meta: {
				node_fields: NODE_FIELDS,
				node_types: [[]],
				edge_fields: EDGE_FIELDS,
				edge_types: [EDGE_TYPES],
				location_fields: LOCATION_FIELDS
			},
			node_count: specs.length,
			edge_count: edges.length / E
		},
		nodes,
		edges,
		locations: locations.flatMap(([node, scriptId]) => [node * F, scriptId, 0, 0])
	};
}

const SCRIPTS = { '1': '/build/resources/app/extensions/copilot/dist/main.js' };
const IDS = { copilot: 'GitHub.copilot-chat' };

describe('attributeHeap', () => {
	test('credits a subtree to the extension that dominates it', () => {
		// root -> owned -> retained. Nothing else reaches `retained`, so every
		// byte of it belongs to the extension that owns its dominator.
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1] }, { self: 100, to: [2] }, { self: 1000, to: [] }],
			[[1, 1]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result).toEqual({
			ok: true,
			breakdown: {
				extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 1100 }],
				unattributedBytes: 10,
				reachableBytes: 1110
			}
		});
	});

	test('does not credit an extension for what it merely references', () => {
		// root -> owned -> shared, and root -> shared. The root dominates
		// `shared`, so it is nobody's: this is the double counting a plain
		// reachability walk would produce.
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1, 2] }, { self: 100, to: [2] }, { self: 1000, to: [] }],
			[[1, 1]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result).toEqual({
			ok: true,
			breakdown: {
				extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 100 }],
				unattributedBytes: 1010,
				reachableBytes: 1110
			}
		});
	});

	test('the parts sum to the reachable total, and unreachable nodes are excluded', () => {
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1] }, { self: 100, to: [] }, { self: 7777, to: [] }],
			[[1, 1]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok).toBe(true);
		if (!result.ok) { return; }
		const summed = result.breakdown.extensions.reduce((sum, e) => sum + e.retainedBytes, 0)
			+ result.breakdown.unattributedBytes;
		expect(summed).toBe(result.breakdown.reachableBytes);
		expect(result.breakdown.reachableBytes).toBe(110);
	});

	test('ignores weak edges, which do not retain', () => {
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1], weakTo: [2] }, { self: 100, to: [] }, { self: 5000, to: [] }],
			[[1, 1]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok && result.breakdown.reachableBytes).toBe(110);
	});

	test('falls back to the directory name when no extension id is known', () => {
		const snapshot = buildSnapshot([{ self: 10, to: [1] }, { self: 100, to: [] }], [[1, 1]]);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: {} });

		expect(result.ok && result.breakdown.extensions).toEqual([{ extensionId: 'copilot', retainedBytes: 100 }]);
	});

	test('sorts extensions by retained bytes, descending', () => {
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1, 2] }, { self: 100, to: [] }, { self: 900, to: [] }],
			[[1, 1], [2, 2]]
		);
		const scripts = { ...SCRIPTS, '2': '/build/resources/app/extensions/positron-r/out/main.js' };

		const result = attributeHeap({ snapshot, scriptUrls: scripts, extensionIds: IDS });

		expect(result.ok && result.breakdown.extensions.map(e => e.extensionId))
			.toEqual(['positron-r', 'GitHub.copilot-chat']);
	});

	test('skips the breakdown when locations is empty', () => {
		const snapshot = buildSnapshot([{ self: 10, to: [] }], []);

		expect(attributeHeap({ snapshot, scriptUrls: {}, extensionIds: {} }))
			.toEqual({ ok: false, kind: 'unsupported_format', reason: 'the snapshot carried no location data' });
	});

	test('skips the breakdown when too many script ids are unresolvable', () => {
		// Two located nodes, one resolvable: 50%, far above the 1% ceiling.
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1, 2] }, { self: 100, to: [] }, { self: 100, to: [] }],
			[[1, 1], [2, 99]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toMatch(/unresolved script id/);
	});

	test('tolerates a small share of unresolvable script ids', () => {
		const specs: NodeSpec[] = [{ self: 10, to: [...Array(200).keys()].map(i => i + 1) }];
		const locations: [number, number][] = [];
		for (let i = 1; i <= 200; i++) {
			specs.push({ self: 1, to: [] });
			locations.push([i, i === 200 ? 99 : 1]);
		}

		const result = attributeHeap({ snapshot: buildSnapshot(specs, locations), scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok).toBe(true);
	});

	test('skips the breakdown when the snapshot format is not what the parser expects', () => {
		const snapshot = buildSnapshot([{ self: 10, to: [] }], [[0, 1]]);
		snapshot.snapshot.meta.node_fields = ['type', 'name', 'id'];

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok).toBe(false);
		expect(!result.ok && result.reason).toMatch(/node_fields/);
	});

	test('labels a format mismatch as unsupported_format so the consumer can switch on it', () => {
		const snapshot = buildSnapshot([{ self: 10, to: [] }], [[0, 1]]);
		snapshot.snapshot.meta.node_fields = ['type', 'name'];

		const result = attributeHeap({ snapshot, scriptUrls: SCRIPTS, extensionIds: IDS });

		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe('unsupported_format');
	});

	test('labels an empty locations array as unsupported_format rather than a healthy empty breakdown', () => {
		const snapshot = buildSnapshot([{ self: 10, to: [] }], []);

		const result = attributeHeap({ snapshot, scriptUrls: {}, extensionIds: {} });

		expect(result.ok === false && result.kind).toBe('unsupported_format');
	});

	test('labels an over-ceiling unresolved share as untrusted, since the numbers are real but incomplete', () => {
		// Same snapshot as the "credits a subtree" case, but an empty scriptUrls
		// resolves nothing, pushing the unresolved share over the ceiling.
		const snapshot = buildSnapshot(
			[{ self: 10, to: [1] }, { self: 100, to: [2] }, { self: 1000, to: [] }],
			[[1, 1]]
		);

		const result = attributeHeap({ snapshot, scriptUrls: {}, extensionIds: {} });

		expect(result.ok === false && result.kind).toBe('untrusted');
	});
});
