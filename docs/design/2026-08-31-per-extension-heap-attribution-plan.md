# Per-extension extension host heap attribution: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-extension breakdown of the extension host heap to every nightly memory scenario, in the run report and the published payload, without changing any existing measurement.

**Architecture:** A capture step streams a V8 heap snapshot out of the extension host over CDP right after PSS sampling, writing it to `RUNNER_TEMP` with a small sidecar of script URLs and extension ids. The render step, which already reads the three launch JSONs back off disk in the same CI job, parses each snapshot once, partitions the reachable heap by dominator tree, credits every byte to the nearest owning extension, then deletes the snapshot. Nothing new is uploaded.

**Tech Stack:** TypeScript, Node, Playwright (e2e harness only, no product code), Vitest for unit tests, Chrome DevTools Protocol over a WebSocket.

**Spec:** `docs/design/2026-08-31-per-extension-heap-attribution-design.md`

## Global Constraints

- **No product code changes.** Everything lives under `test/e2e/`.
- **Never fail a scenario.** Every failure in this feature logs and omits the per-extension block. PSS is the product of this harness; attribution is an addition.
- **Tabs for indentation** in TypeScript, not spaces.
- **ASCII punctuation only.** No em-dashes, en-dashes, smart quotes, or other non-ASCII characters, in code or comments.
- **Every new file starts with the standard header:**
  ```
  /*---------------------------------------------------------------------------------------------
   *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
   *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
   *--------------------------------------------------------------------------------------------*/
  ```
- **Unit tests are Vitest**, named `*.vitest.ts`, colocated in `test/e2e/utils/memory/`. Run one file with `npx vitest run <path>`. No build daemons needed.
- **Never run `npx tsc` or `tsc --noEmit` against `src/tsconfig.json`.** To type-check the vitest files, run `npm run test:positron:check-ts`.
- **Skip thresholds, exact values:** omit the breakdown when `locations` is empty, or when more than **1%** of `locations` entries have an unresolvable script id (`MAX_UNRESOLVED_SHARE = 0.01`). Healthy is 0.013% to 0.019%.
- **Report row floor:** extensions retaining under **1 MB** collapse into a single "others" row.
- **Extension identity:** `publisher` + `name` from the extension directory's `package.json`, falling back to the directory name when it cannot be read.
- **Snapshot files are deleted after parsing and never uploaded.**
- **Terse comments.** One to two lines, and only for non-obvious "why". Match the density of the surrounding files.
- Run `npm run precommit -- <files>` before each commit; it checks unicode, indentation, headers, formatting, and eslint on staged files.

---

### Task 1: Heap attribution core

The pure, testable heart: given a parsed heap snapshot, a `scriptId -> url` map, and a `directory -> extensionId` map, return a dominator-tree partition of the reachable heap. No I/O, no CDP.

**Files:**
- Create: `test/e2e/utils/memory/heap-attribute.ts`
- Modify: `test/e2e/utils/memory/types.ts` (append the two new types)
- Test: `test/e2e/utils/memory/heap-attribute.vitest.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ExtensionHeap = { extensionId: string; retainedBytes: number }` (in `types.ts`)
  - `ExtensionHeapBreakdown = { extensions: ExtensionHeap[]; unattributedBytes: number; reachableBytes: number }` (in `types.ts`)
  - `HeapSnapshotJson` (in `heap-attribute.ts`)
  - `HeapAttributionResult = { ok: true; breakdown: ExtensionHeapBreakdown } | { ok: false; reason: string }`
  - `attributeHeap(input: { snapshot: HeapSnapshotJson; scriptUrls: Record<string, string>; extensionIds: Record<string, string> }): HeapAttributionResult`
  - `MAX_UNRESOLVED_SHARE = 0.01`

- [ ] **Step 1: Add the two payload types to `types.ts`**

Append to `test/e2e/utils/memory/types.ts`, after `ActivatedExtension`:

```ts
/** One extension's share of the extension host heap. */
export type ExtensionHeap = {
	/** Real extension id, or the directory name if package.json was unreadable. */
	extensionId: string;
	/** Retained bytes, as a dominator-tree partition of the reachable heap. */
	retainedBytes: number;
};

/**
 * A partition of the extension host's reachable heap by owning extension.
 *
 * Not the same thing as `MemorySnapshot.extensions`, which is the activation-log
 * inventory of what loaded. This is how much of the heap each one retains, so an
 * extension can appear in one and not the other.
 */
export type ExtensionHeapBreakdown = {
	extensions: ExtensionHeap[];
	/** Extension host runtime and node internals. Not any extension's. */
	unattributedBytes: number;
	/** Reachable heap total; extensions + unattributed must equal this. */
	reachableBytes: number;
};
```

Then add the optional field to `MemorySnapshot`, immediately after `extensions: ActivatedExtension[];`:

```ts
	/**
	 * Per-extension partition of the extension host heap. Written by the render
	 * step, not at capture time: the parse needs several GB and must not run
	 * while Positron is being sampled. Absent when capture or parsing failed,
	 * which never fails the scenario.
	 */
	extensionHeap?: ExtensionHeapBreakdown;
```

- [ ] **Step 2: Write the failing test**

Create `test/e2e/utils/memory/heap-attribute.vitest.ts`:

```ts
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
			.toEqual({ ok: false, reason: 'the snapshot carried no location data' });
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
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/heap-attribute.vitest.ts`
Expected: FAIL, `Failed to resolve import "./heap-attribute.js"`.

- [ ] **Step 4: Write the implementation**

Create `test/e2e/utils/memory/heap-attribute.ts`:

```ts
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
	| { ok: false; reason: string };

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
		return { ok: false, reason: formatProblem };
	}
	if (!Array.isArray(snapshot.locations) || snapshot.locations.length === 0) {
		return { ok: false, reason: 'the snapshot carried no location data' };
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/heap-attribute.vitest.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Type-check**

Run: `npm run test:positron:check-ts 2>&1 | grep heap-attribute`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/heap-attribute.ts test/e2e/utils/memory/heap-attribute.vitest.ts test/e2e/utils/memory/types.ts
git add test/e2e/utils/memory/heap-attribute.ts test/e2e/utils/memory/heap-attribute.vitest.ts test/e2e/utils/memory/types.ts
git commit -m "e2e(memory): partition the ext host heap by owning extension"
```

---

### Task 2: Shared CDP client with event support

`gc.ts` has a private `CdpClient` that handles responses only. Heap capture needs events (`Debugger.scriptParsed`, `HeapProfiler.addHeapSnapshotChunk`), which that client silently drops. Move the client to its own module and give it event subscription, so there is one CDP implementation rather than two.

**Files:**
- Create: `test/e2e/utils/memory/cdp.ts`
- Modify: `test/e2e/utils/memory/gc.ts` (delete the private client and the socket plumbing, import instead)
- Test: `test/e2e/utils/memory/cdp.vitest.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface WebSocketLike { send(data: string): void; close(): void; onmessage: ((event: { data: string }) => void) | null; onerror: ((event: unknown) => void) | null }`
  - `type WsConnect = (url: string) => Promise<WebSocketLike>`
  - `const defaultConnect: WsConnect`
  - `class CdpClient` with `send<T = any>(method: string, params?: object): Promise<T>`, `on(method: string, handler: (params: any) => void): void`, `close(): void`; constructed as `new CdpClient(ws, context)` where `context` is a phrase like `extension host inspector on port 5870`
  - `async function connectToInspector(port: number, label: string, connect?: WsConnect, fetchImpl?: typeof fetch): Promise<CdpClient>`
  - `const MESSAGE_TIMEOUT_MS = 10_000`

- [ ] **Step 1: Write the failing test**

Create `test/e2e/utils/memory/cdp.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { CdpClient, connectToInspector, WebSocketLike } from './cdp.js';

class FakeSocket implements WebSocketLike {
	sent: { id: number; method: string; params?: object }[] = [];
	closed = false;
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	send(data: string): void {
		this.sent.push(JSON.parse(data));
	}
	close(): void {
		this.closed = true;
	}
	/** Delivers a raw CDP frame, as the inspector would. */
	deliver(message: object): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}
}

describe('CdpClient', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	test('resolves a send with the matching response result', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.deliver({ id: socket.sent[0].id, result: { ok: true } });

		await expect(pending).resolves.toEqual({ ok: true });
	});

	test('delivers events to subscribers, and does not confuse them with responses', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');
		const seen: unknown[] = [];
		client.on('Debugger.scriptParsed', params => seen.push(params));

		const pending = client.send('Debugger.enable');
		socket.deliver({ method: 'Debugger.scriptParsed', params: { scriptId: '1', url: 'file:///a.js' } });
		socket.deliver({ method: 'Debugger.scriptParsed', params: { scriptId: '2', url: 'file:///b.js' } });
		socket.deliver({ id: socket.sent[0].id, result: {} });
		await pending;

		expect(seen).toEqual([
			{ scriptId: '1', url: 'file:///a.js' },
			{ scriptId: '2', url: 'file:///b.js' }
		]);
	});

	test('an event with no subscriber is ignored rather than throwing', () => {
		const socket = new FakeSocket();
		// eslint-disable-next-line no-new
		new CdpClient(socket, 'extension host inspector on port 5870');

		expect(() => socket.deliver({ method: 'Runtime.consoleAPICalled', params: {} })).not.toThrow();
	});

	test('rejects with the context when the inspector returns an error', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.deliver({ id: socket.sent[0].id, error: { message: 'nope' } });

		await expect(pending).rejects.toThrow(/port 5870.*nope/);
	});

	test('rejects when no reply arrives within the message timeout', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		const assertion = expect(pending).rejects.toThrow(/did not reply to HeapProfiler.enable/);
		await vi.advanceTimersByTimeAsync(10_000);
		await assertion;
	});

	test('a socket error rejects everything still in flight', async () => {
		const socket = new FakeSocket();
		const client = new CdpClient(socket, 'extension host inspector on port 5870');

		const pending = client.send('HeapProfiler.enable');
		socket.onerror?.('boom');

		await expect(pending).rejects.toThrow(/port 5870/);
	});

	test('an unparseable frame is ignored', () => {
		const socket = new FakeSocket();
		// eslint-disable-next-line no-new
		new CdpClient(socket, 'extension host inspector on port 5870');

		expect(() => socket.onmessage?.({ data: 'not json' })).not.toThrow();
	});
});

describe('connectToInspector', () => {
	test('connects to the first debuggable target the inspector lists', async () => {
		const socket = new FakeSocket();
		const connect = vi.fn(async () => socket as WebSocketLike);
		const fetchImpl = vi.fn(async () => ({
			json: async () => [{ webSocketDebuggerUrl: 'ws://127.0.0.1/target' }]
		})) as unknown as typeof fetch;

		const client = await connectToInspector(5870, 'extension host', connect, fetchImpl);

		expect(connect).toHaveBeenCalledWith('ws://127.0.0.1/target');
		expect(client).toBeInstanceOf(CdpClient);
	});

	test('throws naming the port when the inspector lists no target', async () => {
		const fetchImpl = vi.fn(async () => ({ json: async () => [] })) as unknown as typeof fetch;

		await expect(connectToInspector(5870, 'extension host', async () => new FakeSocket(), fetchImpl))
			.rejects.toThrow(/port 5870 listed no debuggable target/);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/cdp.vitest.ts`
Expected: FAIL, `Failed to resolve import "./cdp.js"`.

- [ ] **Step 3: Write `cdp.ts`**

Create `test/e2e/utils/memory/cdp.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A minimal Chrome DevTools Protocol client for the inspector ports Positron
 * opens with `--inspect-sharedprocess` and `--inspect-extensions`.
 *
 * Two callers, which is why this is not inside either: `gc.ts` forces a
 * collection before sampling, and `heap-capture.ts` streams a heap snapshot
 * after it. The second needs events, which a response-only client drops on the
 * floor without saying so.
 */

/** Minimal structural slice of the DOM/Node WebSocket this module actually uses. */
export interface WebSocketLike {
	send(data: string): void;
	close(): void;
	onmessage: ((event: { data: string }) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type WsConnect = (url: string) => Promise<WebSocketLike>;

/** Opens a real WebSocket, resolving once it has connected. */
export const defaultConnect: WsConnect = (url: string) => new Promise((resolve, reject) => {
	const ws = new WebSocket(url);
	ws.onopen = () => resolve(ws as unknown as WebSocketLike);
	ws.onerror = (event) => reject(new Error(`WebSocket connection to ${url} failed: ${String(event)}`));
});

/** How long any single CDP round trip may take before the caller gives up. */
export const MESSAGE_TIMEOUT_MS = 10_000;

export class CdpClient {
	private nextId = 1;
	private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
	private readonly handlers = new Map<string, ((params: any) => void)[]>();

	/** `context` names the target for error messages, e.g. `extension host inspector on port 5870`. */
	constructor(private readonly ws: WebSocketLike, private readonly context: string) {
		this.ws.onmessage = (event) => this.handleMessage(event.data);
		this.ws.onerror = (event) => this.rejectAllPending(new Error(`${this.context} errored: ${String(event)}`));
	}

	private handleMessage(raw: string): void {
		let message: any;
		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}
		if (message.method !== undefined) {
			for (const handler of this.handlers.get(message.method) ?? []) {
				handler(message.params);
			}
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (message.error) {
			pending.reject(new Error(`${this.context} rejected a request: ${message.error.message ?? JSON.stringify(message.error)}`));
		} else {
			pending.resolve(message.result);
		}
	}

	private rejectAllPending(error: Error): void {
		for (const { reject } of this.pending.values()) {
			reject(error);
		}
		this.pending.clear();
	}

	/** Subscribes to a CDP event. Handlers run in registration order. */
	on(method: string, handler: (params: any) => void): void {
		const existing = this.handlers.get(method) ?? [];
		existing.push(handler);
		this.handlers.set(method, existing);
	}

	send<T = any>(method: string, params?: object, timeoutMs = MESSAGE_TIMEOUT_MS): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${this.context} did not reply to ${method} within ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (value) => { clearTimeout(timeout); resolve(value); },
				reject: (error) => { clearTimeout(timeout); reject(error); }
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	close(): void {
		this.ws.close();
	}
}

/** Opens a client against the first debuggable target an inspector port lists. */
export async function connectToInspector(
	port: number,
	label: string,
	connect: WsConnect = defaultConnect,
	fetchImpl: typeof fetch = fetch
): Promise<CdpClient> {
	const context = `${label} inspector on port ${port}`;
	const response = await fetchImpl(`http://127.0.0.1:${port}/json`);
	const targets = await response.json() as { webSocketDebuggerUrl?: string }[];
	const target = targets[0];
	if (!target?.webSocketDebuggerUrl) {
		throw new Error(`${context} listed no debuggable target`);
	}
	return new CdpClient(await connect(target.webSocketDebuggerUrl), context);
}
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/cdp.vitest.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Point `gc.ts` at the shared client**

In `test/e2e/utils/memory/gc.ts`, delete the `WebSocketLike` interface, `WsConnect`, `defaultConnect`, `MESSAGE_TIMEOUT_MS`, and the whole private `CdpClient` class. Add this import at the top, below the existing `MemoryLane` import:

```ts
import { CdpClient, connectToInspector, defaultConnect, WsConnect } from './cdp.js';
```

Keep the names other modules already import from `gc.ts` working by re-exporting them:

```ts
export { WebSocketLike, WsConnect } from './cdp.js';
```

Replace the body of `collectGarbageIn` between the `try {` and the `const pre = ...` line so it uses the shared connector:

```ts
export async function collectGarbageIn(
	target: GcTarget,
	connect: WsConnect = defaultConnect,
	fetchImpl: typeof fetch = fetch
): Promise<ForcedGcStats> {
	const { port } = target;
	try {
		const client = await connectToInspector(port, target.label, connect, fetchImpl);
		try {
			const pre = await readMemoryUsage(client, target);
			// ... unchanged through the return
		} finally {
			client.close();
		}
	} catch (error) {
		if (error instanceof Error && error.message.includes(`port ${port}`)) {
			throw error;
		}
		throw new Error(
			`${target.label} inspector on port ${port} was unreachable, or forcing a GC through it failed: ${error}`);
	}
}
```

Change `readMemoryUsage`'s first parameter type from the deleted private class to the imported one:

```ts
async function readMemoryUsage(client: CdpClient, target: GcTarget): Promise<MemoryUsagePayload> {
```

- [ ] **Step 6: Run the gc tests to verify nothing regressed**

Run: `npx vitest run test/e2e/utils/memory/gc.vitest.ts`
Expected: PASS, unchanged count. The two error-path tests assert only that the port appears in the message, which the new phrasing preserves.

- [ ] **Step 7: Run the whole memory suite and type-check**

Run: `npx vitest run test/e2e/utils/memory/ && npm run test:positron:check-ts`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/cdp.ts test/e2e/utils/memory/cdp.vitest.ts test/e2e/utils/memory/gc.ts
git add test/e2e/utils/memory/cdp.ts test/e2e/utils/memory/cdp.vitest.ts test/e2e/utils/memory/gc.ts
git commit -m "e2e(memory): extract the CDP client and give it event support"
```

---

### Task 3: Resolve extension directories to real extension ids

The script path yields a directory name (`copilot`, `positron-python`). The report should say `GitHub.copilot-chat`, which is what people search for and what joins to the activation inventory. Resolved at capture time, while the app's extension directories are still on disk.

**Files:**
- Modify: `test/e2e/utils/memory/extensions.ts` (append one exported function)
- Test: `test/e2e/utils/memory/extensions.vitest.ts` (append one describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `async function readExtensionIdsByDirectory(roots: string[]): Promise<Record<string, string>>` -- maps a directory name (`copilot`) to `<publisher>.<name>` read from its `package.json`. Directories whose manifest is missing or malformed are omitted, so the caller falls back to the directory name.

- [ ] **Step 1: Write the failing test**

Append to `test/e2e/utils/memory/extensions.vitest.ts`. It already imports
`mkdirSync`, `mkdtempSync`, `writeFileSync`, `join`, and `tmpdir`. Extend three
existing import lines:

```ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { findExtHostLog, parseActivationLog, readExtensionIdsByDirectory } from './extensions.js';
```

Then append:

```ts
describe('readExtensionIdsByDirectory', () => {
	let root: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'ext-ids-'));
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function writeExtension(name: string, manifest: string | undefined): void {
		mkdirSync(join(root, name), { recursive: true });
		if (manifest !== undefined) {
			writeFileSync(join(root, name, 'package.json'), manifest);
		}
	}

	test('maps a directory name to publisher.name', async () => {
		writeExtension('copilot', JSON.stringify({ publisher: 'GitHub', name: 'copilot-chat' }));

		await expect(readExtensionIdsByDirectory([root])).resolves.toEqual({ copilot: 'GitHub.copilot-chat' });
	});

	test('omits a directory with no package.json, so the caller falls back to the directory name', async () => {
		writeExtension('mystery', undefined);

		await expect(readExtensionIdsByDirectory([root])).resolves.toEqual({});
	});

	test('omits a directory whose package.json is malformed', async () => {
		writeExtension('broken', '{ not json');

		await expect(readExtensionIdsByDirectory([root])).resolves.toEqual({});
	});

	test('omits a manifest missing publisher or name', async () => {
		writeExtension('half', JSON.stringify({ name: 'no-publisher' }));

		await expect(readExtensionIdsByDirectory([root])).resolves.toEqual({});
	});

	test('strips the version suffix user-installed directories carry', async () => {
		writeExtension('posit.air-vscode-0.4.1', JSON.stringify({ publisher: 'posit', name: 'air-vscode' }));

		await expect(readExtensionIdsByDirectory([root])).resolves.toEqual({ 'posit.air-vscode': 'posit.air-vscode' });
	});

	test('reads every root, and a missing root is not an error', async () => {
		writeExtension('copilot', JSON.stringify({ publisher: 'GitHub', name: 'copilot-chat' }));

		await expect(readExtensionIdsByDirectory([root, join(root, 'does-not-exist')]))
			.resolves.toEqual({ copilot: 'GitHub.copilot-chat' });
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/extensions.vitest.ts`
Expected: FAIL, `readExtensionIdsByDirectory is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `test/e2e/utils/memory/extensions.ts`, after `readUserInstalledIds`:

```ts
/** Version suffix on user-installed extension directories: `posit.air-vscode-0.4.1`. */
const DIRECTORY_VERSION = /-\d+\.\d+\.\d+.*$/;

/**
 * Real extension id per extension directory name, e.g. `copilot` ->
 * `GitHub.copilot-chat`.
 *
 * Read while the app's directories are still on disk, because the heap parse
 * runs in a later step by which point a temp extensions dir may be gone. A
 * directory whose manifest cannot be read is omitted rather than guessed at:
 * the caller falls back to the directory name, which is still a usable label.
 */
export async function readExtensionIdsByDirectory(roots: string[]): Promise<Record<string, string>> {
	const ids: Record<string, string> = {};
	for (const root of roots) {
		let entries: Dirent[];
		try {
			entries = await fs.readdir(root, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.isDirectory() || entry.name.startsWith('.')) {
				continue;
			}
			try {
				const manifest = JSON.parse(await fs.readFile(join(root, entry.name, 'package.json'), 'utf8'));
				if (typeof manifest.publisher === 'string' && typeof manifest.name === 'string') {
					ids[entry.name.replace(DIRECTORY_VERSION, '')] = `${manifest.publisher}.${manifest.name}`;
				}
			} catch {
				continue;
			}
		}
	}
	return ids;
}
```

`extensions.ts` already imports `promises as fs` and `join` from `path`. Add
only the `Dirent` type to the `fs` import line:

```ts
import { Dirent, promises as fs } from 'fs';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/extensions.vitest.ts`
Expected: PASS, including the six new tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/extensions.ts test/e2e/utils/memory/extensions.vitest.ts
git add test/e2e/utils/memory/extensions.ts test/e2e/utils/memory/extensions.vitest.ts
git commit -m "e2e(memory): resolve extension directories to real extension ids"
```

---

### Task 4: Capture the heap snapshot over CDP

Streams a snapshot out of the extension host and writes it next to the launch JSON, with a sidecar holding the script map and the extension id map. Capture only: no parsing, because the parse needs several GB and must not run while Positron is being sampled.

**Files:**
- Create: `test/e2e/utils/memory/heap-capture.ts`
- Test: `test/e2e/utils/memory/heap-capture.vitest.ts`

**Interfaces:**
- Consumes: `CdpClient`, `connectToInspector`, `defaultConnect`, `WsConnect` (Task 2); `readExtensionIdsByDirectory` (Task 3).
- Produces:
  - `type HeapCaptureSidecar = { scriptUrls: Record<string, string>; extensionIds: Record<string, string> }`
  - `function heapSnapshotPath(dir: string, launchIndex: number): string` -> `<dir>/heap-<launchIndex>.heapsnapshot`
  - `function heapSidecarPath(dir: string, launchIndex: number): string` -> `<dir>/heap-<launchIndex>.meta.json`
  - `async function captureExtensionHostHeap(input: { dir: string; launchIndex: number; extensionRoots: string[]; port?: number; connect?: WsConnect; fetchImpl?: typeof fetch }): Promise<boolean>` -- returns whether it captured, never throws.

- [ ] **Step 1: Write the failing test**

Create `test/e2e/utils/memory/heap-capture.vitest.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { WebSocketLike } from './cdp.js';
import { captureExtensionHostHeap, heapSidecarPath, heapSnapshotPath } from './heap-capture.js';

/**
 * Replays the frames a real extension host sends: scriptParsed events during
 * Debugger.enable, then snapshot chunks during takeHeapSnapshot.
 */
class InspectorSocket implements WebSocketLike {
	sent: string[] = [];
	onmessage: ((event: { data: string }) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(
		private readonly scripts: Record<string, string>,
		private readonly chunks: string[],
		private readonly failOn?: string
	) { }

	send(data: string): void {
		const { id, method } = JSON.parse(data);
		this.sent.push(method);
		queueMicrotask(() => {
			if (method === this.failOn) {
				this.emit({ id, error: { message: 'refused' } });
				return;
			}
			if (method === 'Debugger.enable') {
				for (const [scriptId, url] of Object.entries(this.scripts)) {
					this.emit({ method: 'Debugger.scriptParsed', params: { scriptId, url } });
				}
			}
			if (method === 'HeapProfiler.takeHeapSnapshot') {
				for (const chunk of this.chunks) {
					this.emit({ method: 'HeapProfiler.addHeapSnapshotChunk', params: { chunk } });
				}
			}
			this.emit({ id, result: {} });
		});
	}

	private emit(message: object): void {
		this.onmessage?.({ data: JSON.stringify(message) });
	}

	close(): void { }
}

const fakeFetch = () => vi.fn(async () => ({
	json: async () => [{ webSocketDebuggerUrl: 'ws://127.0.0.1/target' }]
})) as unknown as typeof fetch;

describe('captureExtensionHostHeap', () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'heap-capture-'));
	});
	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('writes the streamed snapshot and a sidecar of script urls', async () => {
		const socket = new InspectorSocket(
			{ '1': 'file:///ext/copilot/main.js' },
			['{"snapshot"', ':{"node_count":1}}']
		);

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured).toBe(true);
		expect(readFileSync(heapSnapshotPath(dir, 0), 'utf8')).toBe('{"snapshot":{"node_count":1}}');
		expect(JSON.parse(readFileSync(heapSidecarPath(dir, 0), 'utf8'))).toEqual({
			scriptUrls: { '1': 'file:///ext/copilot/main.js' },
			extensionIds: {}
		});
	});

	test('enables the debugger before taking the snapshot, so the script map is complete', async () => {
		const socket = new InspectorSocket({ '1': 'file:///a.js' }, ['{}']);

		await captureExtensionHostHeap({
			dir, launchIndex: 1, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(socket.sent.indexOf('Debugger.enable'))
			.toBeLessThan(socket.sent.indexOf('HeapProfiler.takeHeapSnapshot'));
	});

	test('returns false and writes nothing when the inspector refuses', async () => {
		const socket = new InspectorSocket({}, [], 'HeapProfiler.takeHeapSnapshot');

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured).toBe(false);
		expect(existsSync(heapSnapshotPath(dir, 0))).toBe(false);
	});

	test('returns false rather than throwing when the inspector is unreachable', async () => {
		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => { throw new Error('ECONNREFUSED'); },
			fetchImpl: fakeFetch()
		});

		expect(captured).toBe(false);
	});

	test('returns false when the inspector streamed no chunks', async () => {
		const socket = new InspectorSocket({ '1': 'file:///a.js' }, []);

		const captured = await captureExtensionHostHeap({
			dir, launchIndex: 0, extensionRoots: [],
			connect: async () => socket, fetchImpl: fakeFetch()
		});

		expect(captured).toBe(false);
		expect(existsSync(heapSnapshotPath(dir, 0))).toBe(false);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/heap-capture.vitest.ts`
Expected: FAIL, `Failed to resolve import "./heap-capture.js"`.

- [ ] **Step 3: Write the implementation**

Create `test/e2e/utils/memory/heap-capture.ts`:

```ts
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Streams a V8 heap snapshot out of the extension host, for
 * `heap-attribute.ts` to partition later.
 *
 * Capture only. Parsing a 354 MB snapshot needs several GB of heap, which
 * cannot run inside the container while Positron is being measured, so the
 * file is written here and read back in the render step.
 */

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { CdpClient, connectToInspector, defaultConnect, WsConnect } from './cdp.js';
import { readExtensionIdsByDirectory } from './extensions.js';
import { GC_TARGETS } from './gc.js';

/** Everything the parse needs besides the snapshot itself. */
export type HeapCaptureSidecar = {
	/** scriptId -> script url, from `Debugger.scriptParsed`. */
	scriptUrls: Record<string, string>;
	/** Extension directory name -> real extension id. */
	extensionIds: Record<string, string>;
};

/** The extension host inspector port, taken from `GC_TARGETS` so the two cannot drift. */
const EXTENSION_HOST_PORT = GC_TARGETS.find(target => target.role === 'extension_host')!.port;

/**
 * Streaming a 354 MB snapshot takes about 5 seconds, so this is well above the
 * shared 10s round-trip default but still short enough to fail rather than eat
 * the job's timeout.
 */
const SNAPSHOT_TIMEOUT_MS = 120_000;

export function heapSnapshotPath(dir: string, launchIndex: number): string {
	return join(dir, `heap-${launchIndex}.heapsnapshot`);
}

export function heapSidecarPath(dir: string, launchIndex: number): string {
	return join(dir, `heap-${launchIndex}.meta.json`);
}

/**
 * Captures the extension host heap for one launch. Returns whether it wrote a
 * snapshot.
 *
 * Never throws. PSS is the product of this harness and attribution is an
 * addition, so losing a night's datapoint because an inspector was unreachable
 * would be a bad trade.
 */
export async function captureExtensionHostHeap(input: {
	dir: string;
	launchIndex: number;
	/** Directories holding extension folders: the build's bundled dir and the run's extensions dir. */
	extensionRoots: string[];
	port?: number;
	connect?: WsConnect;
	fetchImpl?: typeof fetch;
}): Promise<boolean> {
	const port = input.port ?? EXTENSION_HOST_PORT;
	let client: CdpClient | undefined;
	try {
		client = await connectToInspector(port, 'extension host', input.connect ?? defaultConnect, input.fetchImpl ?? fetch);

		const scriptUrls: Record<string, string> = {};
		client.on('Debugger.scriptParsed', (params: { scriptId: string; url: string }) => {
			scriptUrls[params.scriptId] = params.url;
		});
		// Appended as they arrive rather than joined at the end: a 354 MB
		// snapshot as one string sits within striking distance of V8's max
		// string length, and this runs while Positron is still live.
		mkdirSync(input.dir, { recursive: true });
		const snapshotPath = heapSnapshotPath(input.dir, input.launchIndex);
		writeFileSync(snapshotPath, '');
		let bytesWritten = 0;
		client.on('HeapProfiler.addHeapSnapshotChunk', (params: { chunk: string }) => {
			appendFileSync(snapshotPath, params.chunk);
			bytesWritten += params.chunk.length;
		});

		// Replays a scriptParsed for every already-loaded script. The replay
		// completes before this resolves: measured 2026-08-31 across three
		// sessions against one extension host, all 609 scripts present at the
		// response with none arriving in the following 10 seconds.
		await client.send('Debugger.enable');

		await client.send('HeapProfiler.enable');
		await client.send('HeapProfiler.takeHeapSnapshot',
			{ reportProgress: false, captureNumericValue: false }, SNAPSHOT_TIMEOUT_MS);

		if (bytesWritten === 0) {
			rmSync(snapshotPath, { force: true });
			console.log('[memory] extension host streamed no heap snapshot chunks; skipping the per-extension breakdown');
			return false;
		}

		const sidecar: HeapCaptureSidecar = {
			scriptUrls,
			extensionIds: await readExtensionIdsByDirectory(input.extensionRoots)
		};

		writeFileSync(heapSidecarPath(input.dir, input.launchIndex), JSON.stringify(sidecar));
		console.log(`[memory] captured extension host heap for launch ${input.launchIndex}: ${Object.keys(scriptUrls).length} scripts`);
		return true;
	} catch (error) {
		// A partial snapshot would parse as garbage, so it goes with the failure.
		rmSync(heapSnapshotPath(input.dir, input.launchIndex), { force: true });
		console.log(`[memory] could not capture the extension host heap: ${error}`);
		return false;
	} finally {
		client?.close();
	}
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/heap-capture.vitest.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Type-check and commit**

```bash
npm run test:positron:check-ts
npm run precommit -- test/e2e/utils/memory/heap-capture.ts test/e2e/utils/memory/heap-capture.vitest.ts
git add test/e2e/utils/memory/heap-capture.ts test/e2e/utils/memory/heap-capture.vitest.ts
git commit -m "e2e(memory): capture the ext host heap snapshot over CDP"
```

---

### Task 5: Render the per-extension table

A second summary table below the existing role table, in both the markdown and the HTML report, decomposing the `extension_host` row.

**Files:**
- Modify: `test/e2e/utils/memory/render.ts`
- Test: `test/e2e/utils/memory/render.vitest.ts` (append one describe block)

**Interfaces:**
- Consumes: `ExtensionHeapBreakdown` (Task 1).
- Produces: `function extensionHeapRows(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): { extensionId: string; bytes: number; change: string }[]` -- exported for testing; the rendering functions consume it. `unattributed` is always the last row.

- [ ] **Step 1: Write the failing test**

Append to `test/e2e/utils/memory/render.vitest.ts`. That file's existing factory
is positional -- `snapshot(procs, launchIndex, extensions)` -- and has no
overrides parameter, so the tests below spread it rather than passing an object.
Add `extensionHeapRows` to the `./render.js` import.

```ts
/** The existing factory takes no overrides, so the new field is spread on. */
const withHeap = (extensionHeap?: ExtensionHeapBreakdown): MemorySnapshot =>
	({ ...snapshot([proc()]), extensionHeap });
```

Add `ExtensionHeapBreakdown` to the `./types.js` import for that helper's
signature.

```ts
describe('extension host heap breakdown', () => {
	const breakdown = {
		extensions: [
			{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_500_000 },
			{ extensionId: 'positron.positron-python', retainedBytes: 37_600_000 },
			{ extensionId: 'vscode.authentication', retainedBytes: 2_800_000 },
			{ extensionId: 'vscode.tiny-one', retainedBytes: 400_000 },
			{ extensionId: 'vscode.tiny-two', retainedBytes: 300_000 }
		],
		unattributedBytes: 192_800_000,
		reachableBytes: 354_400_000
	};

	test('lists extensions above the floor, collapses the rest, and puts unattributed last', () => {
		const rows = extensionHeapRows([withHeap(breakdown)]);

		expect(rows.map(r => r.extensionId)).toEqual([
			'GitHub.copilot-chat',
			'positron.positron-python',
			'vscode.authentication',
			'(2 others)',
			'unattributed'
		]);
		expect(rows.find(r => r.extensionId === '(2 others)')?.bytes).toBe(700_000);
	});

	test('reports change against the baseline, and "new" for an extension the baseline lacked', () => {
		const baseline = withHeap({
			extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_200_000 }],
			unattributedBytes: 189_200_000,
			reachableBytes: 309_400_000
		});

		const rows = extensionHeapRows([withHeap(breakdown)], baseline);

		expect(rows.find(r => r.extensionId === 'GitHub.copilot-chat')?.change).toBe('+300.0 KB');
		expect(rows.find(r => r.extensionId === 'positron.positron-python')?.change).toBe('new');
	});

	test('leaves change blank when there is no baseline at all', () => {
		const rows = extensionHeapRows([withHeap(breakdown)]);

		expect(rows.every(r => r.change === '')).toBe(true);
	});

	test('leaves change blank when the baseline predates the breakdown', () => {
		const rows = extensionHeapRows([withHeap(breakdown)], withHeap());

		expect(rows.every(r => r.change === '')).toBe(true);
	});

	test('takes the median across launches, zero-filling a launch that lacked an extension', () => {
		const withOnlyCopilot = {
			extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_500_000 }],
			unattributedBytes: 192_800_000,
			reachableBytes: 313_300_000
		};
		const rows = extensionHeapRows([
			withHeap(breakdown),
			withHeap(withOnlyCopilot),
			withHeap(withOnlyCopilot)
		]);

		expect(rows.find(r => r.extensionId === 'GitHub.copilot-chat')?.bytes).toBe(120_500_000);
		// Present in one launch of three, so its median is zero and it falls below
		// the floor rather than reading as heavy as something present in all three.
		expect(rows.map(r => r.extensionId)).not.toContain('positron.positron-python');
	});

	test('renders no table and says why when no launch produced a breakdown', () => {
		const markdown = renderMarkdown([withHeap()]);

		expect(markdown).not.toContain('Extension host heap');
		expect(markdown).toContain('Per-extension breakdown unavailable');
	});

	test('renders the table in markdown when a breakdown is present', () => {
		const markdown = renderMarkdown([withHeap(breakdown)]);

		expect(markdown).toContain('### Extension host heap');
		expect(markdown).toContain('`GitHub.copilot-chat`');
		expect(markdown).toContain('_unattributed_');
	});

	test('renders the table in html when a breakdown is present', () => {
		const html = renderHtml([withHeap(breakdown)]);

		expect(html).toContain('Extension host heap');
		expect(html).toContain('GitHub.copilot-chat');
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/render.vitest.ts`
Expected: FAIL, `extensionHeapRows is not exported`.

- [ ] **Step 3: Write the implementation**

In `test/e2e/utils/memory/render.ts`, add `ExtensionHeapBreakdown` to the `./types.js` import, then add this above `renderMarkdown`:

```ts
/**
 * Retained bytes below which an extension collapses into a single "others" row.
 *
 * A fixed byte floor rather than a top N or a percentage: it keeps a newly
 * appearing extension visible the moment it matters, and the long tail is real
 * (14 extensions under 0.2 MB in a measured heap).
 */
const EXTENSION_HEAP_FLOOR_BYTES = 1_048_576;

/** The unattributed remainder's row label, in both report formats. */
const UNATTRIBUTED_ROW = 'unattributed';

/**
 * Median retained bytes per extension across launches, zero-filling a launch
 * that did not have one, for the same reason `byRole` does.
 */
function extensionHeapMedians(breakdowns: ExtensionHeapBreakdown[]): Map<string, number> {
	const ids = new Set(breakdowns.flatMap(b => b.extensions.map(e => e.extensionId)));
	return new Map([...ids].map(id => [
		id,
		median(breakdowns.map(b => b.extensions.find(e => e.extensionId === id)?.retainedBytes ?? 0))
	]));
}

/**
 * The per-extension rows, largest first, with everything under the floor
 * collapsed and `unattributed` always last.
 *
 * `unattributed` is always shown: it is most of the heap, and hiding it would
 * imply the extensions sum to the extension host row.
 */
export function extensionHeapRows(
	snapshots: MemorySnapshot[],
	baseline?: MemorySnapshot
): { extensionId: string; bytes: number; change: string }[] {
	const breakdowns = snapshots.map(s => s.extensionHeap).filter((b): b is ExtensionHeapBreakdown => b !== undefined);
	if (breakdowns.length === 0) {
		return [];
	}
	const medians = extensionHeapMedians(breakdowns);
	const baselineBreakdown = baseline?.extensionHeap;
	const baselineBytes = new Map(baselineBreakdown?.extensions.map(e => [e.extensionId, e.retainedBytes]) ?? []);

	// Blank rather than "new" everywhere when there is no extension-level
	// baseline at all, which is the first night and any run against a baseline
	// captured before this shipped.
	const changeFor = (id: string, bytes: number): string => {
		if (!baselineBreakdown) {
			return '';
		}
		const before = baselineBytes.get(id);
		return before === undefined ? 'new' : signed(bytes - before);
	};

	const ranked = [...medians].sort((a, b) => b[1] - a[1]);
	const shown = ranked.filter(([, bytes]) => bytes >= EXTENSION_HEAP_FLOOR_BYTES);
	const collapsed = ranked.filter(([, bytes]) => bytes > 0 && bytes < EXTENSION_HEAP_FLOOR_BYTES);

	const rows = shown.map(([extensionId, bytes]) => ({ extensionId, bytes, change: changeFor(extensionId, bytes) }));
	if (collapsed.length > 0) {
		rows.push({
			extensionId: `(${collapsed.length} others)`,
			bytes: collapsed.reduce((sum, [, bytes]) => sum + bytes, 0),
			change: ''
		});
	}
	const unattributed = median(breakdowns.map(b => b.unattributedBytes));
	rows.push({
		extensionId: UNATTRIBUTED_ROW,
		bytes: unattributed,
		change: baselineBreakdown ? signed(unattributed - baselineBreakdown.unattributedBytes) : ''
	});
	return rows;
}
```

In `renderMarkdown`, after the role table's trailing `lines.push('');`, add:

```ts
	const heapRows = extensionHeapRows(snapshots, baseline);
	if (heapRows.length === 0) {
		lines.push('_Per-extension breakdown unavailable for this run._', '');
	} else {
		lines.push(`### Extension host heap: ${snapshots[0]?.scenario}`, '');
		lines.push('| Extension | Retained | Change |', '| --- | --- | --- |');
		for (const row of heapRows) {
			const label = row.extensionId === UNATTRIBUTED_ROW ? `_${UNATTRIBUTED_ROW}_` : `\`${row.extensionId}\``;
			lines.push(`| ${label} | ${formatBytes(row.bytes)} | ${row.change} |`);
		}
		lines.push('');
	}
```

In `renderHtml`, add before the `return`:

```ts
	const heapRows = extensionHeapRows(snapshots, baseline);
	const maxHeapBytes = Math.max(0, ...heapRows.map(row => row.bytes));
	const extensionHeapCard = heapRows.length === 0
		? ''
		: `<div class="card">
		<h2>Extension host heap</h2>
		<table>
			<tr><th>Extension</th><th align="right">Retained</th><th></th><th align="right">Change</th></tr>
			${heapRows.map(row => `<tr>
				<td>${row.extensionId === UNATTRIBUTED_ROW ? `<em>${UNATTRIBUTED_ROW}</em>` : `<code>${escapeHtml(row.extensionId)}</code>`}</td>
				<td align="right">${formatBytes(row.bytes)}</td>
				<td>${magnitudeBar(row.bytes, maxHeapBytes)}</td>
				<td align="right">${escapeHtml(row.change)}</td>
			</tr>`).join('\n')}
		</table>
		<p class="muted">A dominator-tree partition of the reachable extension host heap: every byte is credited to the nearest owning extension, so the rows sum to the total and nothing is counted twice. <em>unattributed</em> is the extension host runtime and node internals.</p>
	</div>`;
```

and insert `${extensionHeapCard}` immediately after the "Memory by role" card's closing `</div>`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/render.vitest.ts`
Expected: PASS, including the eight new tests.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/render.ts test/e2e/utils/memory/render.vitest.ts
git add test/e2e/utils/memory/render.ts test/e2e/utils/memory/render.vitest.ts
git commit -m "e2e(memory): report the ext host heap broken down by extension"
```

---

### Task 6: Publish the breakdown

Add the breakdown to the wire format, so the dashboard PR in the e2e-test-insights repo needs no further Positron-side change.

**Files:**
- Modify: `test/e2e/utils/memory/publish.ts`
- Test: `test/e2e/utils/memory/publish.vitest.ts` (append to the existing `buildPayload` describe block)

**Interfaces:**
- Consumes: `ExtensionHeapBreakdown` (Task 1).
- Produces: an optional `extension_heap` object on each entry of `MemoryPayload.launches`:
  ```ts
  extension_heap?: {
      reachable_bytes: number;
      unattributed_bytes: number;
      extensions: { extension_id: string; retained_bytes: number }[];
  };
  ```

- [ ] **Step 1: Write the failing test**

Append to the `buildPayload` describe block in
`test/e2e/utils/memory/publish.vitest.ts`. That file's `snapshot` is a const
object, not a factory, so the tests below spread it. `meta` is the existing
`RunMeta` fixture.

```ts
	test('carries the per-extension heap breakdown when a launch has one', () => {
		const payload = buildPayload([{
			...snapshot,
			extensionHeap: {
				extensions: [{ extensionId: 'GitHub.copilot-chat', retainedBytes: 120_500_000 }],
				unattributedBytes: 192_800_000,
				reachableBytes: 313_300_000
			}
		}], meta);

		expect(payload.launches[0].extension_heap).toEqual({
			reachable_bytes: 313_300_000,
			unattributed_bytes: 192_800_000,
			extensions: [{ extension_id: 'GitHub.copilot-chat', retained_bytes: 120_500_000 }]
		});
	});

	test('omits the key entirely when a launch has no breakdown, so an older endpoint is unaffected', () => {
		const payload = buildPayload([snapshot], meta);

		expect('extension_heap' in payload.launches[0]).toBe(false);
	});

	test('publishes every extension rather than a top N, so the consumer picks the cutoff', () => {
		const extensions = [...Array(40).keys()].map(i => ({ extensionId: `pub.ext-${i}`, retainedBytes: 1000 - i }));
		const payload = buildPayload([{
			...snapshot,
			extensionHeap: { extensions, unattributedBytes: 1, reachableBytes: 2 }
		}], meta);

		expect(payload.launches[0].extension_heap?.extensions).toHaveLength(40);
	});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: FAIL, `expected undefined to equal Object`.

- [ ] **Step 3: Write the implementation**

In `test/e2e/utils/memory/publish.ts`, add to the `launches` element type in `MemoryPayload`, after `extensions`:

```ts
		/**
		 * Per-extension partition of the extension host heap. Optional and
		 * omitted rather than sent empty, so an endpoint that predates it ignores
		 * the field rather than rejecting the run. Every extension is sent, not a
		 * top N: the array is small and letting the consumer choose a cutoff
		 * avoids a second Positron-side change when the dashboard lands.
		 */
		extension_heap?: {
			reachable_bytes: number;
			unattributed_bytes: number;
			extensions: { extension_id: string; retained_bytes: number }[];
		};
```

In `buildPayload`, add to the object returned per snapshot, after `extensions:`:

```ts
			extension_heap: snapshot.extensionHeap && {
				reachable_bytes: snapshot.extensionHeap.reachableBytes,
				unattributed_bytes: snapshot.extensionHeap.unattributedBytes,
				extensions: snapshot.extensionHeap.extensions.map(e => ({
					extension_id: e.extensionId,
					retained_bytes: e.retainedBytes
				}))
			}
```

`JSON.stringify` drops an `undefined` value, so an absent breakdown sends no key. The `'extension_heap' in payload` test asserts on the built object rather than the serialized one, so set the property conditionally instead if that test fails:

```ts
			...(snapshot.extensionHeap ? { extension_heap: { /* as above */ } } : {})
```

Use whichever form makes the test pass; prefer the spread, since it keeps the key genuinely absent.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/e2e/utils/memory/publish.vitest.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run precommit -- test/e2e/utils/memory/publish.ts test/e2e/utils/memory/publish.vitest.ts
git add test/e2e/utils/memory/publish.ts test/e2e/utils/memory/publish.vitest.ts
git commit -m "e2e(memory): publish the per-extension heap breakdown"
```

---

### Task 7: Wire capture and parsing into the scenario

Capture after PSS sampling in the measure test, parse in the render test, delete the snapshots afterwards.

**Files:**
- Modify: `test/e2e/tests/performance/memory-scenario.ts`
- Modify: `docs/design/2026-08-31-per-extension-heap-attribution-design.md` (one clarifying sentence)

**Interfaces:**
- Consumes: `captureExtensionHostHeap`, `heapSnapshotPath`, `heapSidecarPath`, `HeapCaptureSidecar` (Task 4); `attributeHeap`, `HeapSnapshotJson` (Task 1).
- Produces: nothing further; this is the last task.

- [ ] **Step 1: Add the capture call to the measure test**

In `test/e2e/tests/performance/memory-scenario.ts`, add the imports:

```ts
import { attributeHeap, HeapSnapshotJson } from '../../utils/memory/heap-attribute.js';
import { captureExtensionHostHeap, HeapCaptureSidecar, heapSidecarPath, heapSnapshotPath } from '../../utils/memory/heap-capture.js';
```

Immediately after the `const snapshot = await captureSnapshot({ ... });` call and before the assertions that follow it, add:

```ts
			// After captureSnapshot, never before: the forced GC has already run by
			// then, so this is the post-collection heap rather than one carrying the
			// startup garbage that made pre-GC figures swing. Capture only, about 5
			// seconds; the parse needs several GB and happens in the render step.
			await captureExtensionHostHeap({
				dir: SNAPSHOT_DIR,
				launchIndex: snapshot.launchIndex,
				extensionRoots: [join(buildRoot!, 'resources', 'app', 'extensions'), app.extensionsPath]
			});
```

`SNAPSHOT_DIR` is already in scope. `mkdirSync(SNAPSHOT_DIR, ...)` runs later in the test, but `captureExtensionHostHeap` creates the directory itself.

- [ ] **Step 2: Add the parse to the render test**

In the `Render and publish` test, after the `scenarios` assertion and before `const baseline = await fetchBaseline(...)`, add:

```ts
			// Parsed here rather than at capture: a 354 MB snapshot needs several GB
			// to parse, which must not run while Positron is being sampled, and this
			// runs once per scenario instead of once per launch. Same job as the
			// launches, so RUNNER_TEMP still holds the files.
			for (const snapshot of snapshots) {
				const heapPath = heapSnapshotPath(SNAPSHOT_DIR, snapshot.launchIndex);
				const sidecarPath = heapSidecarPath(SNAPSHOT_DIR, snapshot.launchIndex);
				if (!existsSync(heapPath) || !existsSync(sidecarPath)) {
					continue;
				}
				try {
					const sidecar: HeapCaptureSidecar = JSON.parse(readFileSync(sidecarPath, 'utf8'));
					const heap: HeapSnapshotJson = JSON.parse(readFileSync(heapPath, 'utf8'));
					const result = attributeHeap({ snapshot: heap, scriptUrls: sidecar.scriptUrls, extensionIds: sidecar.extensionIds });
					if (result.ok) {
						snapshot.extensionHeap = result.breakdown;
					} else {
						console.log(`[memory] launch ${snapshot.launchIndex}: no per-extension breakdown, ${result.reason}`);
					}
				} catch (error) {
					console.log(`[memory] launch ${snapshot.launchIndex}: could not parse the heap snapshot: ${error}`);
				} finally {
					// Never uploaded: 354 MB per launch is not worth retaining when the
					// derived rows are a few hundred bytes.
					rmSync(heapPath, { force: true });
					rmSync(sidecarPath, { force: true });
				}
			}
```

Add `rmSync` to the `fs` import at the top of the file.

- [ ] **Step 3: Verify the specs still type-check**

Run: `npm run build-ps` and, if the daemons are not running, `npm run build-start`. Then:

Run: `npm run build-check`
Expected: no errors mentioning `memory-scenario.ts`.

- [ ] **Step 4: Run the whole memory unit suite**

Run: `npx vitest run test/e2e/utils/memory/`
Expected: PASS.

- [ ] **Step 5: Amend the spec to say when extension identity is resolved**

In `docs/design/2026-08-31-per-extension-heap-attribution-design.md`, in the "Extension identity" section, after the sentence ending `each extension directory's package.json`, add:

```
Resolved at capture time, while the app's extension directories are still on
disk, and carried to the parse in the snapshot's sidecar: the render step runs
after the app is gone and a temp extensions dir with it.
```

- [ ] **Step 6: Commit**

```bash
npm run precommit -- test/e2e/tests/performance/memory-scenario.ts docs/design/2026-08-31-per-extension-heap-attribution-design.md
git add test/e2e/tests/performance/memory-scenario.ts docs/design/2026-08-31-per-extension-heap-attribution-design.md
git commit -m "e2e(memory): capture and attribute the ext host heap per scenario"
```

- [ ] **Step 7: Run one scenario end to end**

This is the first time capture runs on Linux under Playwright, and the end-to-end path cannot be unit tested. Run it in the background, not the foreground: a single memory scenario takes several minutes.

```bash
BUILD=<path-to-a-positron-build> MEMORY_LAUNCH_INDEX=0 \
  npx playwright test test/e2e/tests/performance/memory-idle.test.ts \
  --project e2e-electron --grep 'Memory footprint'
```

Expected in the log: `[memory] captured extension host heap for launch 0: <n> scripts`, with `n` in the hundreds.

Then run launches 1 and 2 the same way, and the render step:

```bash
BUILD=<path-to-a-positron-build> npx playwright test test/e2e/tests/performance/memory-idle.test.ts \
  --project e2e-electron --grep 'Render and publish'
```

Expected: the markdown table in the log has an `### Extension host heap: idle` section, `unattributed` is the largest row, and `heap-*.heapsnapshot` files no longer exist in the snapshot dir.

If the breakdown is reported unavailable, the log line says which check rejected it; that reason is the whole diagnosis.

---

## Verification checklist

After Task 7, confirm each of these before opening the PR:

- [ ] `npx vitest run test/e2e/utils/memory/` passes.
- [ ] `npm run test:positron:check-ts` reports no errors in the new files.
- [ ] `npm run build-check` reports no errors in `memory-scenario.ts`.
- [ ] One scenario ran end to end locally and produced a non-empty table.
- [ ] No `heap-*.heapsnapshot` file survives the render step.
- [ ] Nothing new was added to the workflow's `upload-artifact` steps.
- [ ] The e2e-test-insights `/memory` endpoint accepts the new optional
      `extension_heap` field. It is additive and optional, so an older endpoint
      ignores it rather than rejecting the run, but confirm before merging to
      `main`, which is the only branch that writes to the production dataset.
