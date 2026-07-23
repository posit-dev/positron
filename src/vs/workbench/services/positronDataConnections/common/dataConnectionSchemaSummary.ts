/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDataConnectionNodeDTO } from './interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from './interfaces/dataConnectionDriver.js';

// Defaults keep a single summarization call cheap for both the driver (bounded number of
// nodeGetChildren round-trips) and the consumer (bounded JSON payload size).
const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_NODES_PER_LEVEL = 50;
const DEFAULT_MAX_TOTAL_NODES = 500;

// DataConnectionNodeKind values (positron.d.ts) that only group sibling nodes for display (e.g.
// "Tables", "Views") and carry no schema information of their own. IDataConnectionNodeDTO.kind
// crosses the RPC wire as a plain string (see dataConnectionDTOs.ts), so these are compared as
// string literals rather than imported from the ext-host-only DataConnectionNodeKind enum.
const CONTAINER_ONLY_KINDS = new Set([
	'group-databases',
	'group-schemas',
	'group-tables',
	'group-views',
	'group-columns',
	'group-indexes',
]);

/**
 * Bounds for a {@link summarizeDataConnectionSchema} call. All fields default when omitted; see
 * DEFAULT_MAX_DEPTH, DEFAULT_MAX_NODES_PER_LEVEL, DEFAULT_MAX_TOTAL_NODES.
 */
export interface IDataConnectionSchemaSummaryOptions {
	// Maximum depth of real (non-container) nodes in the returned tree. Root-level nodes are
	// depth 1. Container nodes (see CONTAINER_ONLY_KINDS) are flattened and don't consume a depth
	// level.
	maxDepth?: number;

	// Maximum number of nodes returned under any single parent (or at the root), after container
	// flattening. Extra siblings are counted into that parent's truncatedChildCount rather than
	// dropped without a trace.
	maxNodesPerLevel?: number;

	// Maximum number of nodes in the entire summary, across all levels combined. Once reached, no
	// further nodes are added anywhere in the tree.
	maxTotalNodes?: number;
}

/**
 * A single node in a summarized data connection schema tree. Plain JSON -- safe to send to
 * Assistant or serialize for storage.
 */
export interface IDataConnectionSchemaNode {
	name: string;
	kind: string; // DataConnectionNodeKind value (positron.d.ts)
	dataType?: string;
	isPrimaryKey?: boolean;

	// Present only when this node has at least one included child.
	children?: IDataConnectionSchemaNode[];

	// Number of this node's children left out of the summary by a maxDepth, maxNodesPerLevel, or
	// maxTotalNodes cap. Present only when at least one child was left out.
	truncatedChildCount?: number;
}

/**
 * A bounded, JSON-serializable summary of a data connection's schema tree, produced by
 * {@link summarizeDataConnectionSchema}.
 */
export interface IDataConnectionSchemaSummary {
	// Identifies the connection instance the schema was read from (the handle's RPC connection
	// handle, stringified).
	instanceId: string;

	nodes: IDataConnectionSchemaNode[];

	// True if any cap (maxDepth, maxNodesPerLevel, maxTotalNodes) truncated the output.
	truncated: boolean;
}

// Mutable counters threaded through the recursive walk. summarizeDataConnectionSchema allocates
// one of these per call; sharing it across recursive calls is what makes maxTotalNodes a global
// (not per-branch) budget.
interface IWalkState {
	totalNodes: number;
	truncated: boolean;
}

/**
 * Recursively walks a data connection's schema tree via {@link IDataConnectionHandle.getChildren}
 * and {@link IDataConnectionHandle.nodeGetChildren}, producing a bounded, plain JSON-serializable
 * summary suitable for handing to Assistant. Container-only node kinds (see
 * CONTAINER_ONLY_KINDS) are flattened into their parent since they add no schema information of
 * their own. Output is bounded by maxDepth, maxNodesPerLevel, and maxTotalNodes; whenever a cap
 * leaves children out, the parent node is annotated with truncatedChildCount rather than the
 * data being dropped silently.
 * @param handle The live data connection handle to summarize.
 * @param options Bounds for the walk; see {@link IDataConnectionSchemaSummaryOptions}.
 */
export async function summarizeDataConnectionSchema(
	handle: IDataConnectionHandle,
	options?: IDataConnectionSchemaSummaryOptions,
): Promise<IDataConnectionSchemaSummary> {
	const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
	const maxNodesPerLevel = options?.maxNodesPerLevel ?? DEFAULT_MAX_NODES_PER_LEVEL;
	const maxTotalNodes = options?.maxTotalNodes ?? DEFAULT_MAX_TOTAL_NODES;

	const state: IWalkState = { totalNodes: 0, truncated: false };

	const fetchChildren = (dto: IDataConnectionNodeDTO): Promise<IDataConnectionNodeDTO[]> =>
		dto.hasGetChildren ? handle.nodeGetChildren(dto.nodeHandle) : Promise.resolve([]);

	// Expands container-only kinds (e.g. "Tables", "Columns" group nodes) in place, replacing each
	// with its own children -- recursively, in case a driver nests containers -- so the caller sees
	// a flat list of only the real, schema-bearing nodes at this level. Done as its own pass (rather
	// than inline while budgeting) so every real node is counted against maxNodesPerLevel/
	// maxTotalNodes exactly once, regardless of how many container levels it was nested under.
	async function flattenContainers(dtos: IDataConnectionNodeDTO[]): Promise<IDataConnectionNodeDTO[]> {
		const flattened: IDataConnectionNodeDTO[] = [];
		for (const dto of dtos) {
			if (CONTAINER_ONLY_KINDS.has(dto.kind)) {
				flattened.push(...await flattenContainers(await fetchChildren(dto)));
			} else {
				flattened.push(dto);
			}
		}
		return flattened;
	}

	/**
	 * Summarizes one sibling list -- the children of a single node, or the root list -- after
	 * flattening container-only kinds directly into it. `depth` is the depth these (real) nodes
	 * occupy; container nodes are transparent and don't consume a depth level, so their flattened
	 * contents share the depth of the list they were flattened into. Returns the accepted nodes
	 * plus a count of siblings left out by the maxNodesPerLevel/maxTotalNodes budgets.
	 */
	async function summarizeSiblings(dtos: IDataConnectionNodeDTO[], depth: number): Promise<{ nodes: IDataConnectionSchemaNode[]; omitted: number }> {
		const nodes: IDataConnectionSchemaNode[] = [];
		let omitted = 0;

		for (const dto of await flattenContainers(dtos)) {
			if (nodes.length >= maxNodesPerLevel || state.totalNodes >= maxTotalNodes) {
				omitted++;
				state.truncated = true;
				continue;
			}
			state.totalNodes++;

			const node: IDataConnectionSchemaNode = { name: dto.name, kind: dto.kind };
			if (dto.dataType !== undefined) {
				node.dataType = dto.dataType;
			}
			if (dto.isPrimaryKey !== undefined) {
				node.isPrimaryKey = dto.isPrimaryKey;
			}
			nodes.push(node);

			if (dto.hasGetChildren) {
				if (depth < maxDepth) {
					const result = await summarizeSiblings(await fetchChildren(dto), depth + 1);
					if (result.nodes.length > 0) {
						node.children = result.nodes;
					}
					if (result.omitted > 0) {
						node.truncatedChildCount = result.omitted;
						state.truncated = true;
					}
				} else {
					// At the depth limit: report that (real) children exist without descending into them.
					const children = await flattenContainers(await fetchChildren(dto));
					if (children.length > 0) {
						node.truncatedChildCount = children.length;
						state.truncated = true;
					}
				}
			}
		}

		return { nodes, omitted };
	}

	const { nodes } = await summarizeSiblings(await handle.getChildren(), 1);

	return {
		instanceId: String(handle.handle),
		nodes,
		truncated: state.truncated,
	};
}
