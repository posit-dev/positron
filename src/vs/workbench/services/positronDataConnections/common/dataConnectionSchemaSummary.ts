/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDataConnectionNodeDTO } from './interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from './interfaces/dataConnectionDriver.js';

/**
 * Depth (in real schema entities) to summarize by default: enough to cover the common
 * database/catalog -> schema -> table/view -> field shape without an explicit maxDepth. See
 * {@link summarizeDataConnectionSchema} for how depth is counted.
 */
export const DEFAULT_DATA_CONNECTION_SCHEMA_MAX_DEPTH = 4;

/**
 * Maximum number of children summarized per node before the rest are omitted and the node (or,
 * for a flattened group, the summary as a whole) is marked truncated. Bounds the payload size for
 * a schema with an unusually large fan-out (e.g. thousands of tables in one schema), since this
 * summary is meant for inclusion in a model's context window, not for exhaustive browsing (the
 * Data Connections panel's lazy tree already covers that case).
 */
const MAX_CHILDREN_PER_NODE = 200;

// Node kinds are free-form driver-supplied strings (see dataConnectionNodeRow.tsx's kindIcon),
// but every built-in driver prefixes its category-header container kinds (e.g. 'group-tables',
// 'group-columns') with 'group-'. Those containers are a UI grouping detail, not a real schema
// level, so they're unwrapped here: their children are spliced into the parent's summary without
// consuming a level of maxDepth. This keeps maxDepth counting real schema entities (database,
// schema, table, field, ...) consistently, regardless of whether a given driver happens to group
// its children under category headers.
const GROUP_NODE_KIND_PREFIX = 'group-';

/**
 * A single node in a summarized data connection schema tree.
 */
export interface IDataConnectionSchemaNode {
	name: string;
	kind: string;
	dataType?: string;
	isPrimaryKey?: boolean;

	// Child nodes, present only when this node has children and at least one was included in the
	// summary. Omitted (not an empty array) for leaves.
	children?: IDataConnectionSchemaNode[];

	// Set when this node has children beyond what's reflected in `children` -- either because
	// maxDepth was reached before it could be expanded at all (children is omitted entirely), or
	// because its children (or a descendant's) exceeded the per-node cap. Absent when the node's
	// full subtree is represented.
	truncated?: true;
}

/**
 * Result of {@link summarizeDataConnectionSchema}.
 */
export interface IDataConnectionSchemaSummary {
	// One entry per top-level real schema entity. A driver whose connection root is itself a
	// transparent group (e.g. a "Schemas" category header) has that header unwrapped here, so this
	// is already the driver's real top-level entities (schemas, databases, catalogs, ...).
	schema: IDataConnectionSchemaNode[];

	// True when any node's children were omitted from the summary (see IDataConnectionSchemaNode.truncated).
	// Lets a caller detect "there's more" without walking the whole tree.
	truncated: boolean;
}

/**
 * Summarizes a live data connection's schema tree into Assistant-friendly JSON: table/column
 * (and view/index/etc.) names, kinds, and types, eagerly fetched up to maxDepth real schema
 * levels and capped per node so a large schema can't blow up the payload.
 * @param connectionHandle The live connection handle to summarize (see IDataConnectionInstance.connectionHandle).
 * @param maxDepth The number of real schema levels to include (transparent group-header containers
 *   don't count, see GROUP_NODE_KIND_PREFIX). Defaults to DEFAULT_DATA_CONNECTION_SCHEMA_MAX_DEPTH.
 */
export async function summarizeDataConnectionSchema(
	connectionHandle: IDataConnectionHandle,
	maxDepth: number = DEFAULT_DATA_CONNECTION_SCHEMA_MAX_DEPTH,
): Promise<IDataConnectionSchemaSummary> {
	const roots = await connectionHandle.getChildren();
	return summarizeChildren(connectionHandle, roots, 1, maxDepth);
}

/**
 * Summarizes one level of the tree (a node's children), unwrapping transparent group containers
 * in place so they don't consume a level of depth or appear in the output themselves.
 * @param handle The connection handle, used to fetch deeper children.
 * @param dtos The DTOs to summarize at this level.
 * @param depth The real schema depth these DTOs' non-group entries sit at (1-based).
 * @param maxDepth The maximum real schema depth to expand children for.
 */
async function summarizeChildren(
	handle: IDataConnectionHandle,
	dtos: readonly IDataConnectionNodeDTO[],
	depth: number,
	maxDepth: number,
): Promise<IDataConnectionSchemaSummary> {
	const visible = dtos.length > MAX_CHILDREN_PER_NODE ? dtos.slice(0, MAX_CHILDREN_PER_NODE) : dtos;
	let truncated = visible.length < dtos.length;

	const schema: IDataConnectionSchemaNode[] = [];
	for (const dto of visible) {
		if (dto.kind.startsWith(GROUP_NODE_KIND_PREFIX)) {
			if (!dto.hasGetChildren) {
				continue;
			}
			const groupChildren = await handle.nodeGetChildren(dto.nodeHandle);
			// Same depth: the group header is transparent, not a schema level of its own.
			const result = await summarizeChildren(handle, groupChildren, depth, maxDepth);
			schema.push(...result.schema);
			truncated = truncated || result.truncated;
			continue;
		}

		const node: IDataConnectionSchemaNode = { name: dto.name, kind: dto.kind };
		if (dto.dataType !== undefined) {
			node.dataType = dto.dataType;
		}
		if (dto.isPrimaryKey !== undefined) {
			node.isPrimaryKey = dto.isPrimaryKey;
		}

		if (dto.hasGetChildren) {
			if (depth >= maxDepth) {
				node.truncated = true;
				truncated = true;
			} else {
				const childDtos = await handle.nodeGetChildren(dto.nodeHandle);
				const result = await summarizeChildren(handle, childDtos, depth + 1, maxDepth);
				if (result.schema.length > 0) {
					node.children = result.schema;
				}
				if (result.truncated) {
					node.truncated = true;
					truncated = true;
				}
			}
		}

		schema.push(node);
	}

	return { schema, truncated };
}
