/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Partitions the extension host's reachable heap by owning extension.
 *
 * Function objects are tiny; the memory is in what they retain, so self size
 * alone accounts for under 3% of the heap. Building the dominator tree and
 * crediting every byte to its nearest owning ancestor gives a true partition:
 * no double counting, and the parts sum to the reachable heap.
 */

import { deriveExtensionName } from './label.js';
import { ExtensionHeapBreakdown } from './types.js';

/** The subset of V8's heap snapshot format this module reads. */
export type HeapSnapshotJson = {
	snapshot: {
		meta: {
			node_fields: string[];
			node_types: unknown[];
			edge_fields: string[];
			edge_types: unknown[];
			location_fields?: string[];
		};
		node_count: number;
		edge_count: number;
	};
	nodes: number[];
	edges: number[];
	locations?: number[];
};

export type HeapAttributionResult =
	| { ok: true; breakdown: ExtensionHeapBreakdown }
	// `kind` is the wire status; `reason` is the human sentence for the report.
	| { ok: false; kind: 'unsupported_format' | 'untrusted'; reason: string };

/**
 * Share of located nodes whose script id may go unresolved before the
 * breakdown is thrown away.
 *
 * An incomplete script map under-attributes without raising anything, so this
 * is measured rather than assumed. A ratio rather than an absolute script
 * count: it is self-normalizing across scenarios and platforms, and it fails on
 * any cause -- a truncated map, a format change, dropped inspector events.
 * Measured healthy values are 0.013% and 0.019%, so 1% only fires on gross
 * breakage.
 */
export const MAX_UNRESOLVED_SHARE = 0.01;

const REQUIRED_NODE_FIELDS = ['self_size', 'edge_count'];
const REQUIRED_EDGE_FIELDS = ['to_node', 'type'];
const REQUIRED_LOCATION_FIELDS = ['object_index', 'script_id'];

/**
 * Rejects a snapshot whose shape is not the one this parser was written
 * against, so a V8 format change from a Node bump surfaces as a skipped
 * breakdown rather than silently wrong numbers.
 */
function checkFormat(snapshot: HeapSnapshotJson): string | undefined {
	const { meta } = snapshot.snapshot;
	const missingNode = REQUIRED_NODE_FIELDS.filter(field => !meta.node_fields?.includes(field));
	if (missingNode.length > 0) {
		return `the snapshot's node_fields lacks ${missingNode.join(', ')}`;
	}
	const missingEdge = REQUIRED_EDGE_FIELDS.filter(field => !meta.edge_fields?.includes(field));
	if (missingEdge.length > 0) {
		return `the snapshot's edge_fields lacks ${missingEdge.join(', ')}`;
	}
	if (!Array.isArray(meta.edge_types?.[0])) {
		return 'the snapshot carried no edge_types';
	}
	const missingLocation = REQUIRED_LOCATION_FIELDS.filter(field => !meta.location_fields?.includes(field));
	if (missingLocation.length > 0) {
		return `the snapshot's location_fields lacks ${missingLocation.join(', ')}`;
	}
	return undefined;
}

/**
 * Which extension directory each located node's code came from, plus how many
 * located nodes had a script id no `scriptParsed` event covered.
 *
 * Directory extraction goes through `deriveExtensionName` rather than a second
 * copy of its regex: it already handles every directory layout this harness
 * produces and strips version suffixes.
 */
function ownersFromLocations(
	snapshot: HeapSnapshotJson,
	scriptUrls: Record<string, string>,
	nodeFieldCount: number
): { owner: Int32Array; directories: string[]; located: number; unresolved: number } {
	const meta = snapshot.snapshot.meta;
	const locationFields = meta.location_fields!;
	const stride = locationFields.length;
	const objectIndex = locationFields.indexOf('object_index');
	const scriptIndex = locationFields.indexOf('script_id');
	const locations = snapshot.locations!;

	const owner = new Int32Array(snapshot.snapshot.node_count).fill(-1);
	const directories: string[] = [];
	const indexByDirectory = new Map<string, number>();
	let unresolved = 0;

	for (let i = 0; i < locations.length; i += stride) {
		const url = scriptUrls[String(locations[i + scriptIndex])];
		if (url === undefined) {
			unresolved++;
			continue;
		}
		// deriveExtensionName appends the executable when it is not redundant
		// with the directory ("copilot (main)"), so the split is required, not
		// defensive: extension directory names contain no spaces.
		const directory = deriveExtensionName(url)?.split(' ')[0];
		if (directory === undefined) {
			continue;
		}
		let id = indexByDirectory.get(directory);
		if (id === undefined) {
			id = directories.length;
			directories.push(directory);
			indexByDirectory.set(directory, id);
		}
		owner[locations[i + objectIndex] / nodeFieldCount] = id;
	}

	return { owner, directories, located: locations.length / stride, unresolved };
}

export function attributeHeap(input: {
	snapshot: HeapSnapshotJson;
	/** scriptId (as a string) -> script url, from `Debugger.scriptParsed`. */
	scriptUrls: Record<string, string>;
	/** Extension directory name -> real extension id. */
	extensionIds: Record<string, string>;
}): HeapAttributionResult {
	const { snapshot, scriptUrls, extensionIds } = input;

	const formatProblem = checkFormat(snapshot);
	if (formatProblem) {
		return { ok: false, kind: 'unsupported_format', reason: formatProblem };
	}
	if (!Array.isArray(snapshot.locations) || snapshot.locations.length === 0) {
		return { ok: false, kind: 'unsupported_format', reason: 'the snapshot carried no location data' };
	}

	const meta = snapshot.snapshot.meta;
	const nodeFieldCount = meta.node_fields.length;
	const edgeFieldCount = meta.edge_fields.length;
	const selfSizeIndex = meta.node_fields.indexOf('self_size');
	const edgeCountIndex = meta.node_fields.indexOf('edge_count');
	const toNodeIndex = meta.edge_fields.indexOf('to_node');
	const edgeTypeIndex = meta.edge_fields.indexOf('type');
	const weakType = (meta.edge_types[0] as string[]).indexOf('weak');
	const nodeCount = snapshot.snapshot.node_count;
	const { nodes, edges } = snapshot;

	const { owner, directories, located, unresolved } = ownersFromLocations(snapshot, scriptUrls, nodeFieldCount);
	const unresolvedShare = unresolved / located;
	if (unresolvedShare > MAX_UNRESOLVED_SHARE) {
		return {
			ok: false,
			kind: 'untrusted',
			reason: `${(unresolvedShare * 100).toFixed(2)}% of located nodes had an unresolved script id, above the ${MAX_UNRESOLVED_SHARE * 100}% ceiling`
		};
	}

	// Index of each node's first edge, so adjacency is a slice rather than a scan.
	const firstEdge = new Uint32Array(nodeCount + 1);
	for (let node = 0, edge = 0; node < nodeCount; node++) {
		firstEdge[node] = edge;
		edge += nodes[node * nodeFieldCount + edgeCountIndex];
	}
	firstEdge[nodeCount] = snapshot.snapshot.edge_count;

	// BFS from the root. The resulting order has every node after its dominator,
	// which is what lets the dominator pass below run as a single forward sweep.
	const order = new Int32Array(nodeCount);
	const position = new Int32Array(nodeCount).fill(-1);
	let reachable = 0;
	order[reachable] = 0;
	position[0] = reachable++;
	for (let i = 0; i < reachable; i++) {
		const node = order[i];
		for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
			if (edges[edge * edgeFieldCount + edgeTypeIndex] === weakType) {
				continue;
			}
			const to = edges[edge * edgeFieldCount + toNodeIndex] / nodeFieldCount;
			if (position[to] === -1) {
				position[to] = reachable;
				order[reachable++] = to;
			}
		}
	}

	// Predecessors of the reachable set, in CSR form.
	const predecessorStart = new Int32Array(reachable + 1);
	let predecessorCount = 0;
	for (let i = 0; i < reachable; i++) {
		const node = order[i];
		for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
			if (edges[edge * edgeFieldCount + edgeTypeIndex] === weakType) {
				continue;
			}
			const to = position[edges[edge * edgeFieldCount + toNodeIndex] / nodeFieldCount];
			if (to > 0) {
				predecessorStart[to]++;
				predecessorCount++;
			}
		}
	}
	let running = 0;
	for (let i = 0; i <= reachable; i++) {
		const count = predecessorStart[i];
		predecessorStart[i] = running;
		running += count;
	}
	const predecessors = new Int32Array(predecessorCount);
	const cursor = predecessorStart.slice();
	for (let i = 0; i < reachable; i++) {
		const node = order[i];
		for (let edge = firstEdge[node]; edge < firstEdge[node + 1]; edge++) {
			if (edges[edge * edgeFieldCount + edgeTypeIndex] === weakType) {
				continue;
			}
			const to = position[edges[edge * edgeFieldCount + toNodeIndex] / nodeFieldCount];
			if (to > 0) {
				predecessors[cursor[to]++] = i;
			}
		}
	}

	// Cooper-Harvey-Kennedy iterative dominators over the BFS order. Converged in
	// 8 rounds on a real 3.7M node / 16M edge extension host heap.
	const idom = new Int32Array(reachable).fill(-1);
	idom[0] = 0;
	const intersect = (a: number, b: number): number => {
		while (a !== b) {
			while (a > b) { a = idom[a]; }
			while (b > a) { b = idom[b]; }
		}
		return a;
	};
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 1; i < reachable; i++) {
			let candidate = -1;
			for (let p = predecessorStart[i]; p < predecessorStart[i + 1]; p++) {
				const predecessor = predecessors[p];
				if (idom[predecessor] === -1) {
					continue;
				}
				candidate = candidate === -1 ? predecessor : intersect(candidate, predecessor);
			}
			if (candidate !== -1 && idom[i] !== candidate) {
				idom[i] = candidate;
				changed = true;
			}
		}
	}

	// Credit each node to its nearest owning dominator ancestor. BFS order
	// guarantees idom[i] < i, so one forward pass resolves every node.
	const UNOWNED = -1;
	const effectiveOwner = new Int32Array(reachable);
	effectiveOwner[0] = owner[order[0]];
	for (let i = 1; i < reachable; i++) {
		const own = owner[order[i]];
		effectiveOwner[i] = own !== UNOWNED ? own : effectiveOwner[idom[i]];
	}

	const bytes = new Float64Array(directories.length);
	let unattributedBytes = 0;
	let reachableBytes = 0;
	for (let i = 0; i < reachable; i++) {
		const size = nodes[order[i] * nodeFieldCount + selfSizeIndex];
		reachableBytes += size;
		const ownerId = effectiveOwner[i];
		if (ownerId === UNOWNED) {
			unattributedBytes += size;
		} else {
			bytes[ownerId] += size;
		}
	}

	const extensions = directories
		.map((directory, id) => ({
			extensionId: extensionIds[directory] ?? directory,
			retainedBytes: bytes[id]
		}))
		.filter(entry => entry.retainedBytes > 0)
		.sort((a, b) => b.retainedBytes - a.retainedBytes);

	return { ok: true, breakdown: { extensions, unattributedBytes, reachableBytes } };
}
