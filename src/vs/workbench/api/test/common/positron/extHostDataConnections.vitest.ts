/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type * as positron from 'positron';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ExtHostDataConnections } from '../../../common/positron/extHostDataConnections.js';
import { IMainPositronContext, MainThreadDataConnectionsShape } from '../../../common/positron/extHost.positron.protocol.js';

/**
 * Builds the ext host over a main-thread proxy stubbed with the given methods.
 */
function createExtHost(proxyMethods: Partial<MainThreadDataConnectionsShape>) {
	const proxy = stubInterface<MainThreadDataConnectionsShape>(proxyMethods);
	return new ExtHostDataConnections(stubInterface<IMainPositronContext>({
		// getProxy is generic over every proxy identifier; this class asks for exactly one.
		getProxy: (() => proxy) as unknown as IMainPositronContext['getProxy'],
	}));
}

/**
 * Registers a driver whose one connection has the given top-level nodes, connects it, and fetches
 * the nodes the way the main thread does. Returns the ext host and the connection's handle and node
 * DTOs, so a test can call back into a node by its handle.
 */
async function connectWithNodes(nodes: positron.DataConnectionNode[]) {
	const extHost = createExtHost({
		$registerDataConnectionDriver: () => { },
		$removeDataConnectionDriver: () => { },
	});
	const connection = stubInterface<positron.DataConnection>({ getChildren: async () => nodes });
	// A literal rather than a stub: registration probes the driver's optional members (e.g.
	// onDidChange), which a minimal driver leaves unset.
	const driver: positron.DataConnectionDriver = {
		id: 'test-driver',
		name: 'Test',
		description: 'A test driver',
		iconSvg: '<svg/>',
		mechanisms: [],
		supportedLanguageIds: [],
		connect: async () => connection,
	};
	extHost.registerDriver(driver);
	const connectionHandle = await extHost.$driverConnect('test-driver', 'default', {});
	const dtos = await extHost.$connectionGetChildren(connectionHandle);
	return { extHost, connectionHandle, dtos };
}

describe('ExtHostDataConnections node details', () => {
	it('sends a driver\'s details as strings, recursing into groups, items, tables, and tabs', async () => {
		// Deliberately not the declared shape: a driver building details straight from a query result
		// can easily hand back numbers and nulls where strings belong, and extra fields besides.
		const details: unknown = {
			description: null,
			sections: [{ kind: 'code', languageId: 'sql', code: 123, extra: 'dropped' }],
			tabs: [{
				title: 'Overview',
				sections: [
					{ kind: 'properties', title: 5, properties: [{ name: 'Rows', value: 42 }, { name: 'Comment', value: null }] },
					{ kind: 'table', columns: ['Name', 'Size'], rows: [['data.csv', 1024]], extra: 'dropped' },
					{
						kind: 'group', title: 'Metrics', count: 1, collapsible: true, sections: [{
							kind: 'items', emptyText: 0, items: [{ name: 'NET_REVENUE', kind: 'metric', dataType: 'NUMBER(37,4)', code: 7, internal: 'dropped' }],
						}],
					},
					// A count or collapsible flag of the wrong type is treated as absent.
					{ kind: 'group', title: 'Facts', count: '3', collapsible: 'yes', sections: [] },
				],
			}],
		};
		const { extHost, connectionHandle, dtos } = await connectWithNodes([{
			name: 'CHAOS_MODEL',
			kind: 'semantic-view' as positron.DataConnectionNodeKind,
			getDetails: async () => details as positron.DataConnectionNodeDetails,
		}]);

		expect(await extHost.$nodeGetDetails(connectionHandle, dtos[0].nodeHandle)).toMatchInlineSnapshot(`
			{
			  "description": undefined,
			  "sections": [
			    {
			      "code": "123",
			      "kind": "code",
			      "languageId": "sql",
			      "title": undefined,
			    },
			  ],
			  "tabs": [
			    {
			      "sections": [
			        {
			          "kind": "properties",
			          "properties": [
			            {
			              "name": "Rows",
			              "value": "42",
			            },
			            {
			              "name": "Comment",
			              "value": "",
			            },
			          ],
			          "title": "5",
			        },
			        {
			          "columns": [
			            "Name",
			            "Size",
			          ],
			          "kind": "table",
			          "rows": [
			            [
			              "data.csv",
			              "1024",
			            ],
			          ],
			          "title": undefined,
			        },
			        {
			          "collapsible": true,
			          "count": 1,
			          "kind": "group",
			          "sections": [
			            {
			              "emptyText": "0",
			              "items": [
			                {
			                  "code": "7",
			                  "dataType": "NUMBER(37,4)",
			                  "description": undefined,
			                  "kind": "metric",
			                  "name": "NET_REVENUE",
			                },
			              ],
			              "kind": "items",
			              "title": undefined,
			            },
			          ],
			          "title": "Metrics",
			        },
			        {
			          "collapsible": false,
			          "count": undefined,
			          "kind": "group",
			          "sections": [],
			          "title": "Facts",
			        },
			      ],
			      "title": "Overview",
			    },
			  ],
			}
		`);
	});

	it('tells the main thread which nodes have details', async () => {
		const { dtos } = await connectWithNodes([
			{ name: 'CHAOS_MODEL', kind: 'semantic-view' as positron.DataConnectionNodeKind, getDetails: async () => ({ sections: [] }) },
			{ name: 'users', kind: 'table' as positron.DataConnectionNodeKind },
		]);

		expect(dtos.map(dto => [dto.name, dto.hasDetails])).toEqual([['CHAOS_MODEL', true], ['users', false]]);
	});

	it('gives another extension\'s nodes getDetails exactly when the main thread says they have details', async () => {
		// The reverse direction: an extension browsing a connection through the positron API.
		const detailsDTO = { description: 'Semantic view in DB.PUBLIC', sections: [] };
		const nodeGetDetails = vi.fn(async () => detailsDTO);
		const extHost = createExtHost({
			$connectToDataConnectionDriver: async () => 7,
			$connectionGetChildrenViaService: async () => [
				{ nodeHandle: 1, name: 'CHAOS_MODEL', kind: 'semantic-view', hasGetChildren: true, hasPreview: false, hasDetails: true },
				{ nodeHandle: 2, name: 'users', kind: 'table', hasGetChildren: true, hasPreview: true, hasDetails: false },
			],
			$nodeGetDetailsViaService: nodeGetDetails,
		});

		const connection = await extHost.connect('test-driver', 'default', {});
		const [semanticView, table] = await connection.getChildren();

		expect(table.getDetails).toBeUndefined();
		expect(await semanticView.getDetails!()).toEqual(detailsDTO);
		expect(nodeGetDetails).toHaveBeenCalledWith(7, 1);
	});

	it('refuses details for a node that has none', async () => {
		const { extHost, connectionHandle, dtos } = await connectWithNodes([{ name: 'users', kind: 'table' as positron.DataConnectionNodeKind }]);

		await expect(extHost.$nodeGetDetails(connectionHandle, dtos[0].nodeHandle)).rejects.toThrow('does not support getDetails');
	});
});
