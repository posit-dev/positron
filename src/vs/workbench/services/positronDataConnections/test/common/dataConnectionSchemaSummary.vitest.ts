/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { summarizeDataConnectionSchema } from '../../common/dataConnectionSchemaSummary.js';
import { IDataConnectionNodeDTO } from '../../common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from '../../common/interfaces/dataConnectionDriver.js';

// A lightweight description of a schema tree used to build a fake IDataConnectionHandle. Mirrors
// the shape drivers hand to getChildren()/nodeGetChildren(), minus the wire-format bookkeeping
// (nodeHandle, hasGetChildren) that createFakeHandle assigns automatically.
interface IFakeSchemaNode {
	name: string;
	kind: string;
	dataType?: string;
	isPrimaryKey?: boolean;
	children?: IFakeSchemaNode[];
}

// Builds a fake IDataConnectionHandle backed by an in-memory tree, assigning each node a
// nodeHandle the first time it is serialized to a DTO (mirroring how the real ext host assigns
// handles lazily as nodes are expanded).
function createFakeHandle(roots: IFakeSchemaNode[], connectionHandle = 1): IDataConnectionHandle {
	let nextNodeHandle = 1;
	const childrenByNodeHandle = new Map<number, IFakeSchemaNode[]>();

	const toDto = (node: IFakeSchemaNode): IDataConnectionNodeDTO => {
		const nodeHandle = nextNodeHandle++;
		if (node.children) {
			childrenByNodeHandle.set(nodeHandle, node.children);
		}
		return {
			nodeHandle,
			name: node.name,
			kind: node.kind,
			dataType: node.dataType,
			isPrimaryKey: node.isPrimaryKey,
			hasGetChildren: node.children !== undefined,
			hasPreview: false,
		};
	};

	return stubInterface<IDataConnectionHandle>({
		handle: connectionHandle,
		getChildren: async () => roots.map(toDto),
		nodeGetChildren: async (nodeHandle: number) => (childrenByNodeHandle.get(nodeHandle) ?? []).map(toDto),
	});
}

// Builds a chain of `depth` nested nodes, each the sole child of the previous one, all sharing
// `kind`. Used to exercise the maxDepth cap independent of any particular node kind's real-world
// shape (e.g. field nodes are normally leaves; this keeps every level "expandable").
function createChain(depth: number, kind = 'database'): IFakeSchemaNode {
	let node: IFakeSchemaNode = { name: `level${depth}`, kind };
	for (let level = depth - 1; level >= 1; level--) {
		node = { name: `level${level}`, kind, children: [node] };
	}
	return node;
}

describe('summarizeDataConnectionSchema', () => {
	it('returns an empty summary for a connection with no schema', async () => {
		const handle = createFakeHandle([], 42);

		const summary = await summarizeDataConnectionSchema(handle);

		expect(summary).toEqual({ instanceId: '42', nodes: [], truncated: false });
	});

	it('flattens container-only kinds into their parent', async () => {
		const handle = createFakeHandle([
			{
				name: 'Tables', kind: 'group-tables', children: [
					{
						name: 'employees', kind: 'table', children: [
							{
								name: 'Columns', kind: 'group-columns', children: [
									{ name: 'id', kind: 'field', dataType: 'integer', isPrimaryKey: true },
									{ name: 'name', kind: 'field', dataType: 'text' },
								]
							},
						]
					},
				]
			},
		]);

		const summary = await summarizeDataConnectionSchema(handle);

		expect(summary).toMatchInlineSnapshot(`
			{
			  "instanceId": "1",
			  "nodes": [
			    {
			      "children": [
			        {
			          "dataType": "integer",
			          "isPrimaryKey": true,
			          "kind": "field",
			          "name": "id",
			        },
			        {
			          "dataType": "text",
			          "kind": "field",
			          "name": "name",
			        },
			      ],
			      "kind": "table",
			      "name": "employees",
			    },
			  ],
			  "truncated": false,
			}
		`);
	});

	it('caps recursion at maxDepth, marking truncatedChildCount instead of descending further', async () => {
		// level1 -> level2 -> level3 -> level4: 4 real levels, one child each.
		const handle = createFakeHandle([createChain(4)]);

		const summary = await summarizeDataConnectionSchema(handle, { maxDepth: 2 });

		expect(summary).toEqual({
			instanceId: '1',
			truncated: true,
			nodes: [
				{
					name: 'level1', kind: 'database', children: [
						{ name: 'level2', kind: 'database', truncatedChildCount: 1 },
					]
				},
			],
		});
	});

	it('does not truncate a tree that fits entirely within maxDepth', async () => {
		const handle = createFakeHandle([createChain(4)]);

		const summary = await summarizeDataConnectionSchema(handle, { maxDepth: 4 });

		expect(summary.truncated).toBe(false);
		// level4 is a leaf (no children), so nothing is left dangling at the boundary.
		expect(summary.nodes[0].children![0].children![0].children).toEqual([{ name: 'level4', kind: 'database' }]);
	});

	it('caps children per parent at maxNodesPerLevel, marking truncatedChildCount on the parent', async () => {
		const handle = createFakeHandle([
			{
				name: 'schema', kind: 'schema', children: [
					{ name: 't1', kind: 'table' },
					{ name: 't2', kind: 'table' },
					{ name: 't3', kind: 'table' },
					{ name: 't4', kind: 'table' },
					{ name: 't5', kind: 'table' },
				]
			},
		]);

		const summary = await summarizeDataConnectionSchema(handle, { maxNodesPerLevel: 3 });

		expect(summary).toEqual({
			instanceId: '1',
			truncated: true,
			nodes: [
				{
					name: 'schema', kind: 'schema', truncatedChildCount: 2, children: [
						{ name: 't1', kind: 'table' },
						{ name: 't2', kind: 'table' },
						{ name: 't3', kind: 'table' },
					]
				},
			],
		});
	});

	it('applies maxNodesPerLevel independently to each parent, not as a shared per-depth budget', async () => {
		const makeTables = (prefix: string) => Array.from({ length: 4 }, (_, i) => ({ name: `${prefix}${i + 1}`, kind: 'table' }));
		const handle = createFakeHandle([
			{ name: 'schemaA', kind: 'schema', children: makeTables('a') },
			{ name: 'schemaB', kind: 'schema', children: makeTables('b') },
		]);

		const summary = await summarizeDataConnectionSchema(handle, { maxNodesPerLevel: 2 });

		expect(summary.nodes.map(n => ({ name: n.name, truncatedChildCount: n.truncatedChildCount, children: n.children?.map(c => c.name) }))).toEqual([
			{ name: 'schemaA', truncatedChildCount: 2, children: ['a1', 'a2'] },
			{ name: 'schemaB', truncatedChildCount: 2, children: ['b1', 'b2'] },
		]);
	});

	it('caps the total number of nodes across the whole tree at maxTotalNodes', async () => {
		const handle = createFakeHandle([
			{ name: 'tableA', kind: 'table', children: [{ name: 'f1', kind: 'field' }, { name: 'f2', kind: 'field' }, { name: 'f3', kind: 'field' }] },
			{ name: 'tableB', kind: 'table', children: [{ name: 'g1', kind: 'field' }, { name: 'g2', kind: 'field' }, { name: 'g3', kind: 'field' }] },
		]);

		const summary = await summarizeDataConnectionSchema(handle, { maxTotalNodes: 4 });

		// The global budget is exhausted inside tableA's own children; tableB never gets a node at
		// all (there's no root-level parent to annotate with a count), but `truncated` still flags it.
		expect(summary).toEqual({
			instanceId: '1',
			truncated: true,
			nodes: [
				{
					name: 'tableA', kind: 'table', children: [
						{ name: 'f1', kind: 'field' },
						{ name: 'f2', kind: 'field' },
						{ name: 'f3', kind: 'field' },
					]
				},
			],
		});
	});

	it('counts nodes flattened out of a container only once against maxTotalNodes', async () => {
		// Regression test: nodes nested under a container kind must not be charged against the
		// budget once per container hop they were flattened through -- only once each, same as a
		// node with no container ancestors at all.
		const handle = createFakeHandle([
			{
				name: 'Tables', kind: 'group-tables', children: [
					{ name: 't1', kind: 'table' },
					{ name: 't2', kind: 'table' },
					{ name: 't3', kind: 'table' },
				]
			},
		]);

		const summary = await summarizeDataConnectionSchema(handle, { maxTotalNodes: 2 });

		expect(summary).toEqual({
			instanceId: '1',
			truncated: true,
			nodes: [
				{ name: 't1', kind: 'table' },
				{ name: 't2', kind: 'table' },
			],
		});
	});

	it('produces a payload that survives a JSON round-trip', async () => {
		const handle = createFakeHandle([
			{
				name: 'Tables', kind: 'group-tables', children: [
					{
						name: 'employees', kind: 'table', children: [
							{ name: 'id', kind: 'field', dataType: 'integer', isPrimaryKey: true },
						]
					},
				]
			},
		]);

		const summary = await summarizeDataConnectionSchema(handle);

		expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
	});
});
