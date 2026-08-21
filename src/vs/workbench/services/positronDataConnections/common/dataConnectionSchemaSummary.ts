/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { quoteCompactToken } from './dataConnectionCompactFormat.js';
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
	'group-catalogs',
	'group-schemas',
	'group-tables',
	'group-views',
	'group-columns',
	'group-indexes',
	'group-volumes',
]);

// Node kinds whose children are files rather than schema, and so are summarized as leaves: the walk
// records the node itself and stops, without expanding it or counting what it holds. A Unity Catalog
// volume or a Snowflake stage can hold thousands of files, the listing changes far more often than a
// table definition does, and listing it costs a round-trip to the warehouse -- so what a consumer
// wants from a *schema* summary is that the volume exists, not an arbitrary 50 of its filenames.
//
// This is deliberately a separate rule from the depth cap. Leaving a kind out of
// CONTAINER_ONLY_KINDS also keeps its contents out of the default 4 levels, but only by accident of
// arithmetic, and it does not avoid the work: at the depth limit the walk still fetches a node's
// children in order to count them (see summarizeSiblings), so the listing is paid for and then
// discarded. Stating the intent here instead skips the fetch outright.
const SUMMARY_LEAF_KINDS = new Set([
	'volume',
	'stage',
]);

// The node kind a driver reports a table's or view's columns as. Columns are the bulk of any
// schema, and unlike every other kind they are pure leaves, so the renderer folds them onto their
// parent's line instead of giving each one a line of its own.
const COLUMN_KIND = 'field';

// The characters a rendered schema line uses as delimiters: `.` between path segments, `,` between
// folded columns, `:` between a column and its type, the brackets around a node's kind and its
// column list, and the space that separates a line's path, kind, dataType, `PK` and `+<n> more`
// parts. A name containing one of these is quoted; see quoteCompactToken. The space matters as
// much as the rest: `Order Details` and `timestamp without time zone` are both ordinary names in a
// real schema, and left unquoted a consumer splitting a line on spaces reads them as several parts.
const SCHEMA_UNSAFE_CHARACTERS = '.,:()[] ';

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
 * A single node in the schema tree the walk builds. Internal to this module: the walk's output is
 * rendered to compact lines (see {@link renderSchemaLines}) before it leaves, so no consumer sees
 * this shape.
 */
interface IDataConnectionSchemaNode {
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

	// The schema, one line per object, in walk order. See {@link renderSchemaLines} for the grammar.
	lines: string[];

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
 * Whether a node is a column that can be folded onto its parent's line. A column with children of
 * its own (a struct field, say) or with children left out by a cap has more to report than the
 * folded form can carry, so it keeps its own line.
 * @param node The node to test.
 */
function isFoldableColumn(node: IDataConnectionSchemaNode): boolean {
	return node.kind === COLUMN_KIND
		&& node.children === undefined
		&& node.truncatedChildCount === undefined;
}

/**
 * Renders one folded column: `<name>[:<dataType>][ PK]`.
 * @param node The column node.
 */
function renderColumn(node: IDataConnectionSchemaNode): string {
	const name = quoteCompactToken(node.name, SCHEMA_UNSAFE_CHARACTERS);
	const dataType = node.dataType === undefined
		? ''
		: `:${quoteCompactToken(node.dataType, SCHEMA_UNSAFE_CHARACTERS)}`;

	return `${name}${dataType}${node.isPrimaryKey ? ' PK' : ''}`;
}

/**
 * Renders a schema tree as one line per object, in walk order. This is the payload's whole shape:
 * a nested JSON tree spends most of its bytes repeating the keys `name`, `kind`, `dataType` and
 * `children` once per node, which is pure overhead for a consumer that only wants to know which
 * tables and columns exist. Folding columns onto their table's line and naming each object by its
 * fully qualified path carries the same information in roughly half the characters -- and the
 * qualified path is what a query needs anyway.
 *
 * The grammar of a line is:
 *
 *     <path> [<kind>][ <dataType>][ PK][ (<column>, ...)][ +<n> more]
 *
 * where `<path>` is the dot-joined names from the root, `<column>` is a folded child column, and
 * `+<n> more` reports children a cap left out (see
 * {@link IDataConnectionSchemaNode.truncatedChildCount}). Any name containing a delimiter is
 * quoted as a JSON string. For example:
 *
 *     sales.public [schema]
 *     sales.public.orders [table] (order_id:integer PK, customer_id:integer, total:numeric)
 *     sales.public.events [table] (id:bigint PK) +37 more
 *     sales.raw [schema] +12 more
 *
 * @param nodes The sibling nodes to render.
 * @param prefix The qualified path of their parent, or undefined at the root. Tested against
 * undefined rather than for truthiness: a parent whose rendered name is empty still contributes a
 * path segment, and treating it as the root would render its descendants one level shallower than
 * the schema really is.
 */
function renderSchemaLines(nodes: readonly IDataConnectionSchemaNode[], prefix?: string): string[] {
	const lines: string[] = [];

	for (const node of nodes) {
		const name = quoteCompactToken(node.name, SCHEMA_UNSAFE_CHARACTERS);
		const path = prefix === undefined ? name : `${prefix}.${name}`;

		// A stray column at a level of its own (no parent to fold onto) still reports its type, so
		// dataType is rendered here as well as in the folded form. The kind is quoted like the rest:
		// every DataConnectionNodeKind value is delimiter-free, but the DTO carries it as a plain
		// string, so a nonconforming driver can't break the line grammar.
		let line = `${path} [${quoteCompactToken(node.kind, SCHEMA_UNSAFE_CHARACTERS)}]`;
		if (node.dataType !== undefined) {
			line += ` ${quoteCompactToken(node.dataType, SCHEMA_UNSAFE_CHARACTERS)}`;
		}
		if (node.isPrimaryKey) {
			line += ' PK';
		}

		const children = node.children ?? [];
		const columns = children.filter(isFoldableColumn);
		if (columns.length > 0) {
			line += ` (${columns.map(renderColumn).join(', ')})`;
		}
		if (node.truncatedChildCount !== undefined) {
			line += ` +${node.truncatedChildCount} more`;
		}
		lines.push(line);

		// Everything that was not folded gets its own line, under this node's path.
		lines.push(...renderSchemaLines(children.filter(child => !isFoldableColumn(child)), path));
	}

	return lines;
}

/**
 * Recursively walks a data connection's schema tree via {@link IDataConnectionHandle.getChildren}
 * and {@link IDataConnectionHandle.nodeGetChildren}, producing a bounded, plain JSON-serializable
 * summary suitable for handing to Assistant: one compact line per schema object (see
 * {@link renderSchemaLines}), rather than a nested tree that would spend most of its size on
 * repeated JSON keys. Container-only node kinds (see
 * CONTAINER_ONLY_KINDS) are flattened into their parent since they add no schema information of
 * their own, and file-holding kinds (see SUMMARY_LEAF_KINDS) are recorded without being expanded.
 * Output is bounded by maxDepth, maxNodesPerLevel, and maxTotalNodes; whenever a cap
 * leaves children out, the parent node is annotated with truncatedChildCount rather than the
 * data being dropped silently. Root-level siblings have no parent line, so objects a cap leaves
 * out at the root are reported as a trailing `+<n> more` line instead.
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

			// A file-holding node (see SUMMARY_LEAF_KINDS) is recorded and left unexpanded, so no
			// listing is fetched and no truncatedChildCount is reported for it.
			if (dto.hasGetChildren && !SUMMARY_LEAF_KINDS.has(dto.kind)) {
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

	const { nodes, omitted } = await summarizeSiblings(await handle.getChildren(), 1);

	// Root-level siblings have no parent line to carry a truncatedChildCount, so objects a cap
	// leaves out at the root get their own trailing `+<n> more` line -- otherwise they would be the
	// one place the summary drops data with nothing but the bare `truncated` flag to show for it.
	const lines = renderSchemaLines(nodes);
	if (omitted > 0) {
		lines.push(`+${omitted} more`);
	}

	return {
		instanceId: String(handle.handle),
		lines,
		truncated: state.truncated,
	};
}
