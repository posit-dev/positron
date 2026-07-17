/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionNodeDTO } from '../../common/interfaces/dataConnectionDTOs.js';
import { IDataConnectionHandle } from '../../common/interfaces/dataConnectionDriver.js';
import { summarizeDataConnectionSchema } from '../../common/dataConnectionSchemaSummary.js';

function node(overrides: Partial<IDataConnectionNodeDTO> & Pick<IDataConnectionNodeDTO, 'nodeHandle' | 'name' | 'kind'>): IDataConnectionNodeDTO {
	return { hasGetChildren: false, hasPreview: false, ...overrides };
}

/**
 * Builds a fake connection handle whose tree is described by a root list plus a map of
 * nodeHandle -> that node's children. Every node referenced by a nodeHandle key must set
 * hasGetChildren: true (real drivers only ever have nodeGetChildren called when it's true).
 */
function createHandle(roots: IDataConnectionNodeDTO[], childrenByHandle: Record<number, IDataConnectionNodeDTO[]> = {}): IDataConnectionHandle {
	return stubInterface<IDataConnectionHandle>({
		getChildren: async () => roots,
		nodeGetChildren: async (nodeHandle: number) => childrenByHandle[nodeHandle] ?? [],
	});
}

describe('summarizeDataConnectionSchema', () => {
	// Mirrors the SQLite driver's shape: root -> group-tables -> table -> group-columns -> fields.
	const tableGroupHandle = 1;
	const tableHandle = 2;
	const columnsGroupHandle = 3;

	function createSqliteLikeHandle(): IDataConnectionHandle {
		return createHandle(
			[node({ nodeHandle: tableGroupHandle, name: 'Tables', kind: 'group-tables', hasGetChildren: true })],
			{
				[tableGroupHandle]: [node({ nodeHandle: tableHandle, name: 'users', kind: 'table', hasGetChildren: true })],
				[tableHandle]: [node({ nodeHandle: columnsGroupHandle, name: 'Columns', kind: 'group-columns', hasGetChildren: true })],
				[columnsGroupHandle]: [
					node({ nodeHandle: 4, name: 'id', kind: 'field', dataType: 'INTEGER', isPrimaryKey: true }),
					node({ nodeHandle: 5, name: 'email', kind: 'field', dataType: 'TEXT' }),
				],
			},
		);
	}

	it('flattens group containers so they consume no depth and never appear in the output', async () => {
		const result = await summarizeDataConnectionSchema(createSqliteLikeHandle());

		expect(result).toEqual({
			schema: [{
				name: 'users',
				kind: 'table',
				children: [
					{ name: 'id', kind: 'field', dataType: 'INTEGER', isPrimaryKey: true },
					{ name: 'email', kind: 'field', dataType: 'TEXT' },
				],
			}],
			truncated: false,
		});
	});

	it('marks a node truncated (with no children) once maxDepth is reached', async () => {
		// Depth 1 is the table itself (the group-tables header is transparent); maxDepth: 1 means
		// the table is included but its columns are never fetched.
		const result = await summarizeDataConnectionSchema(createSqliteLikeHandle(), 1);

		expect(result).toEqual({
			schema: [{ name: 'users', kind: 'table', truncated: true }],
			truncated: true,
		});
	});

	it('does not mark a leaf node truncated', async () => {
		const result = await summarizeDataConnectionSchema(createSqliteLikeHandle());

		const [table] = result.schema;
		expect(table.children).toBeDefined();
		for (const field of table.children!) {
			expect(field.truncated).toBeUndefined();
		}
	});

	it('caps children per node and marks the summary truncated when a level has too many entries', async () => {
		const manyTables = Array.from({ length: 250 }, (_, i) => node({ nodeHandle: 100 + i, name: `table_${i}`, kind: 'table' }));
		const handle = createHandle(
			[node({ nodeHandle: tableGroupHandle, name: 'Tables', kind: 'group-tables', hasGetChildren: true })],
			{ [tableGroupHandle]: manyTables },
		);

		const result = await summarizeDataConnectionSchema(handle);

		expect(result.schema).toHaveLength(200);
		expect(result.truncated).toBe(true);
	});

	it('propagates a descendant truncation up through every ancestor', async () => {
		const manyColumns = Array.from({ length: 250 }, (_, i) => node({ nodeHandle: 200 + i, name: `col_${i}`, kind: 'field' }));
		const handle = createHandle(
			[node({ nodeHandle: tableGroupHandle, name: 'Tables', kind: 'group-tables', hasGetChildren: true })],
			{
				[tableGroupHandle]: [node({ nodeHandle: tableHandle, name: 'wide_table', kind: 'table', hasGetChildren: true })],
				[tableHandle]: [node({ nodeHandle: columnsGroupHandle, name: 'Columns', kind: 'group-columns', hasGetChildren: true })],
				[columnsGroupHandle]: manyColumns,
			},
		);

		const result = await summarizeDataConnectionSchema(handle, 10);

		const [table] = result.schema;
		expect(table.truncated).toBe(true);
		expect(table.children).toHaveLength(200);
		expect(result.truncated).toBe(true);
	});

	it('silently drops a group container that reports no children of its own', async () => {
		const handle = createHandle([node({ nodeHandle: tableGroupHandle, name: 'Tables', kind: 'group-tables', hasGetChildren: false })]);

		const result = await summarizeDataConnectionSchema(handle);

		expect(result).toEqual({ schema: [], truncated: false });
	});

	it('produces a payload that survives a JSON round-trip', async () => {
		const result = await summarizeDataConnectionSchema(createSqliteLikeHandle());

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});
