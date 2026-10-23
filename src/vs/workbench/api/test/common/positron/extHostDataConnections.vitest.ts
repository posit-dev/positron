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
	const { extHost, connectionHandle } = await connectWith(stubInterface<positron.DataConnection>({ getChildren: async () => nodes }));
	const dtos = await extHost.$connectionGetChildren(connectionHandle);
	return { extHost, connectionHandle, dtos };
}

/**
 * Registers a driver whose one connection is the given one, and connects it the way the main thread
 * does. Returns the ext host and the connection's handle.
 */
async function connectWith(connection: positron.DataConnection) {
	const extHost = createExtHost({
		$registerDataConnectionDriver: () => { },
		$removeDataConnectionDriver: () => { },
	});
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
	return { extHost, connectionHandle };
}

// A connection that only browses: getLineage is left out, the way most drivers leave it. A literal,
// since the ext host probes for the optional member and a stub throws on an unset read.
function createConnection(overrides: Partial<positron.DataConnection> = {}): positron.DataConnection {
	return {
		isReadOnly: async () => true,
		getChildren: async () => [],
		disconnect: async () => { },
		isConnected: async () => true,
		...overrides,
	};
}

const LINEAGE_REQUEST: positron.DataConnectionLineageRequest = {
	path: ['SALES', 'PUBLIC', 'ORDERS'],
	domain: 'table',
	direction: 'downstream',
	depth: 2,
	maxEdges: 200,
};

describe('ExtHostDataConnections lineage', () => {
	it('reports a connection without getLineage as not supporting lineage', async () => {
		const { extHost, connectionHandle } = await connectWith(createConnection());

		expect(await extHost.$connectionGetLineage(connectionHandle, LINEAGE_REQUEST)).toBeUndefined();
	});

	it('refuses a connection handle it does not know', async () => {
		const { extHost } = await connectWith(createConnection());

		await expect(extHost.$connectionGetLineage(999, LINEAGE_REQUEST)).rejects.toThrow('Connection handle 999 not found');
	});

	it('passes the request to the driver and a declined request back as it came', async () => {
		const getLineage = vi.fn(async (): Promise<positron.DataConnectionLineage> => ({ available: false, message: 'Not authorized.' }));
		const { extHost, connectionHandle } = await connectWith(createConnection({ getLineage }));

		expect(await extHost.$connectionGetLineage(connectionHandle, LINEAGE_REQUEST))
			.toEqual({ available: false, message: 'Not authorized.' });
		expect(getLineage).toHaveBeenCalledWith(LINEAGE_REQUEST);
	});

	it('lets a driver failure reject, for the main thread to report', async () => {
		const { extHost, connectionHandle } = await connectWith(createConnection({
			getLineage: async () => { throw new Error('Snowflake client is closed'); },
		}));

		await expect(extHost.$connectionGetLineage(connectionHandle, LINEAGE_REQUEST)).rejects.toThrow('Snowflake client is closed');
	});

	it('sends a driver\'s edges with the types the wire promises, dropping edges that identify nothing', async () => {
		// Deliberately not the declared shape: a driver mapping query rows can easily hand back
		// numbers and nulls where strings belong, and extra fields besides.
		const lineage: unknown = {
			available: true,
			truncated: 'yes',
			edges: [
				{
					source: { database: 'SALES', schema: null, name: 42, domain: 'table', extra: 'dropped' },
					target: { database: 'SALES', schema: 'PUBLIC', name: 'ORDERS', column: null, domain: 'table', masked: false },
					distance: '1',
				},
				// A masked end has no name, and still identifies something.
				{ source: { masked: true, domain: 'table' }, target: { name: 'ORDERS', domain: 'table' }, distance: 2 },
				// An end with neither a name nor the masked flag, and a distance that isn't a number.
				{ source: { domain: 'table' }, target: { name: 'ORDERS', domain: 'table' }, distance: 1 },
				{ source: { name: 'A', domain: 'table' }, target: { name: 'B', domain: 'table' }, distance: 'far' },
			],
		};
		const { extHost, connectionHandle } = await connectWith(createConnection({
			getLineage: async () => lineage as positron.DataConnectionLineage,
		}));

		expect(await extHost.$connectionGetLineage(connectionHandle, LINEAGE_REQUEST)).toStrictEqual({
			available: true,
			truncated: false,
			edges: [
				{
					source: { database: 'SALES', schema: undefined, name: '42', column: undefined, domain: 'table', masked: undefined },
					target: { database: 'SALES', schema: 'PUBLIC', name: 'ORDERS', column: undefined, domain: 'table', masked: undefined },
					distance: 1,
				},
				{
					source: { database: undefined, schema: undefined, name: undefined, column: undefined, domain: 'table', masked: true },
					target: { database: undefined, schema: undefined, name: 'ORDERS', column: undefined, domain: 'table', masked: undefined },
					distance: 2,
				},
			],
		});
	});
});

describe('ExtHostDataConnections node details', () => {
	it('sends a driver\'s details as strings, recursing into groups, items, tables, and tabs', async () => {
		// Deliberately not the declared shape: a driver building details straight from a query result
		// can easily hand back numbers and nulls where strings belong, and extra fields besides.
		const details: unknown = {
			description: null,
			// A kind this version doesn't know (a newer driver, say) is dropped, not sent as undefined.
			sections: [{ kind: 'code', languageId: 'sql', code: 123, extra: 'dropped' }, { kind: 'chart', data: [1, 2, 3] }],
			tabs: [{
				title: 'Overview',
				sections: [
					{ kind: 'properties', title: 5, properties: [{ name: 'Rows', value: 42 }, { name: 'Comment', value: null }] },
					{ kind: 'table', columns: ['Name', 'Size'], rows: [['data.csv', 1024]], extra: 'dropped' },
					{
						kind: 'group', title: 'Metrics', count: 1, collapsible: true, treePath: [{ kind: 'group-metrics', name: 7 }], sections: [{
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
			          "treePath": [
			            {
			              "kind": "group-metrics",
			              "name": "7",
			            },
			          ],
			        },
			        {
			          "collapsible": false,
			          "count": undefined,
			          "kind": "group",
			          "sections": [],
			          "title": "Facts",
			          "treePath": undefined,
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

describe('ExtHostDataConnections parameter validation', () => {
	// Registers a driver built from the given members and returns the ext host.
	function registerDriver(members: Partial<positron.DataConnectionDriver>) {
		const extHost = createExtHost({ $registerDataConnectionDriver: () => { } });
		extHost.registerDriver({
			id: 'test-driver',
			name: 'Test',
			description: 'A test driver',
			iconSvg: '<svg/>',
			mechanisms: [],
			supportedLanguageIds: [],
			connect: async () => stubInterface<positron.DataConnection>({}),
			...members,
		});
		return extHost;
	}

	it('returns the driver\'s result to the main thread', async () => {
		const validateParameters = vi.fn(async () => ({
			normalizedValues: { databasePath: '/ws/db.sqlite' },
			errors: { other: 'Not valid.' },
		}));
		const extHost = registerDriver({ validateParameters });

		const validation = await extHost.$validateParameters('test-driver', 'file', { databasePath: 'db.sqlite' });

		expect({ validation, calls: validateParameters.mock.calls }).toEqual({
			validation: { normalizedValues: { databasePath: '/ws/db.sqlite' }, errors: { other: 'Not valid.' } },
			calls: [['file', { databasePath: 'db.sqlite' }]],
		});
	});

	it('tells the main thread whether each driver validates parameters', () => {
		const $registerDataConnectionDriver = vi.fn<MainThreadDataConnectionsShape['$registerDataConnectionDriver']>();
		const extHost = createExtHost({ $registerDataConnectionDriver });
		const driver = (id: string, members: Partial<positron.DataConnectionDriver>): positron.DataConnectionDriver => ({
			id,
			name: id,
			description: '',
			iconSvg: '<svg/>',
			mechanisms: [],
			supportedLanguageIds: [],
			connect: async () => stubInterface<positron.DataConnection>({}),
			...members,
		});

		extHost.registerDriver(driver('plain', {}));
		extHost.registerDriver(driver('validating', { validateParameters: async () => ({}) }));

		expect($registerDataConnectionDriver.mock.calls.map(([id, metadata]) => [id, metadata.validatesParameters])).toEqual([
			['plain', false],
			['validating', true],
		]);
	});

	it('accepts the values as entered for a driver that does not validate them, or is gone', async () => {
		const extHost = registerDriver({});

		expect([
			await extHost.$validateParameters('test-driver', 'file', { databasePath: 'db.sqlite' }),
			await extHost.$validateParameters('no-such-driver', 'file', { databasePath: 'db.sqlite' }),
		]).toEqual([{}, {}]);
	});
});

describe('ExtHostDataConnections unregistering a driver', () => {
	it('leaves the driver\'s connections open for the main thread to close', async () => {
		const removeDriver = vi.fn();
		const extHost = createExtHost({
			$registerDataConnectionDriver: () => { },
			$removeDataConnectionDriver: removeDriver,
		});
		const disconnect = vi.fn(async () => { });
		const connection = stubInterface<positron.DataConnection>({
			getChildren: async () => [{ name: 'users', kind: 'table' as positron.DataConnectionNodeKind }],
			disconnect,
		});
		const registration = extHost.registerDriver({
			id: 'test-driver',
			name: 'Test',
			description: 'A test driver',
			iconSvg: '<svg/>',
			mechanisms: [],
			supportedLanguageIds: [],
			connect: async () => connection,
		});
		const connectionHandle = await extHost.$driverConnect('test-driver', 'default', {});

		registration.dispose();

		// The main thread hears about it, and the connection still works until the main thread has
		// closed it: a browse already in flight completes, and the disconnect reaches the driver.
		// Releasing is what frees the handle.
		const childrenAfterDispose = (await extHost.$connectionGetChildren(connectionHandle)).map(dto => dto.name);
		await extHost.$connectionDisconnect(connectionHandle);
		extHost.$releaseConnection(connectionHandle);
		const afterRelease = await extHost.$connectionGetChildren(connectionHandle)
			.then(() => 'still open', (err: Error) => err.message);

		expect({
			removedDrivers: removeDriver.mock.calls,
			childrenAfterDispose,
			disconnects: disconnect.mock.calls.length,
			afterRelease,
		}).toEqual({
			removedDrivers: [['test-driver']],
			childrenAfterDispose: ['users'],
			disconnects: 1,
			afterRelease: `Connection handle ${connectionHandle} not found`,
		});
	});

	it('leaves a replacement registered under the same id in place when the old registration is disposed', async () => {
		const removeDriver = vi.fn();
		const extHost = createExtHost({
			$registerDataConnectionDriver: () => { },
			$removeDataConnectionDriver: removeDriver,
		});
		const driver = (name: string): positron.DataConnectionDriver => ({
			id: 'test-driver',
			name,
			description: '',
			iconSvg: '<svg/>',
			mechanisms: [],
			supportedLanguageIds: [],
			connect: async () => stubInterface<positron.DataConnection>({}),
			generateConnectionCode: async () => [{ id: name, label: name, code: '' }],
		});
		const stale = extHost.registerDriver(driver('old'));
		const current = extHost.registerDriver(driver('new'));

		// The stale registration goes after its replacement: nothing is removed, and the replacement
		// still answers. Disposing the replacement then removes the driver as usual.
		stale.dispose();
		const codeAfterStaleDispose = await extHost.$generateConnectionCode('test-driver', 'default', 'python', {});
		const removalsAfterStaleDispose = removeDriver.mock.calls.length;
		current.dispose();

		expect({
			removalsAfterStaleDispose,
			answeredBy: codeAfterStaleDispose.map(variant => variant.id),
			removalsAfterCurrentDispose: removeDriver.mock.calls,
		}).toEqual({
			removalsAfterStaleDispose: 0,
			answeredBy: ['new'],
			removalsAfterCurrentDispose: [['test-driver']],
		});
	});
});
