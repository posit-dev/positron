/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IDataConnectionDriver, IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionDriverMetadataDTO, IDiscoveredDataConnectionDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { ExtHostDataConnectionsShape } from '../../../common/positron/extHost.positron.protocol.js';
import { MainThreadDataConnections } from '../../../browser/positron/mainThreadDataConnections.js';

describe('MainThreadDataConnections', () => {
	const disposables = ensureNoLeakedDisposables();

	// Driver metadata as an extension would declare it, with a file parameter carrying two
	// file-picker filters (order matters: the first is the picker's default selection).
	const metadataDto: IDataConnectionDriverMetadataDTO = {
		id: 'duckdb',
		name: 'DuckDB',
		description: 'Connect to DuckDB databases',
		iconSvg: '<svg/>',
		supportedLanguageIds: ['python', 'r'],
		mechanisms: [{
			id: 'file',
			label: 'Database File',
			description: 'Connect to a database file',
			parameters: [
				{
					id: 'databasePath',
					label: 'Database File',
					type: 'file',
					required: true,
					filters: { 'DuckDB Files': ['duckdb', 'ddb'], 'Backups': ['bak'] },
				},
				{ id: 'readOnly', label: 'Read Only', type: 'boolean', defaultValue: false },
			],
		}],
	};

	// The ext host end of $discoverConnections, wired into the proxy below. The discovery test sets
	// what it answers with; the others never call it.
	const $discoverConnections = vi.fn<() => Promise<IDiscoveredDataConnectionDTO[]>>();

	// The ext host end of the change notification, so a test can see that one was sent.
	const $onDidChangeDataConnections = vi.fn<() => void>();

	// The service's own connect, which openConnection goes through. A test sets what it does; by
	// default it opens the profile it was asked for.
	const connect = vi.fn<(profileId: string) => Promise<IDataConnectionInstance>>();

	/** A saved connection, as the service reports one. Only the fields the DTO is built from. */
	function profile(id: string, name: string): IDataConnectionProfile {
		return {
			id,
			connectionName: name,
			mechanismId: 'file',
			parameterValues: {},
			driverMetadata: { id: 'duckdb', name: 'DuckDB', iconSvg: '<svg/>', supportedLanguageIds: ['python'] },
		};
	}

	/** A live connection for a profile, wrapping a handle whose tree the test controls. */
	function instance(profileId: string, handle: Partial<IDataConnectionHandle>): IDataConnectionInstance {
		return stubInterface<IDataConnectionInstance>({
			profileId,
			connectionHandle: stubInterface<IDataConnectionHandle>({ handle: 1, ...handle }),
		});
	}

	let registeredDrivers: IDataConnectionDriver[];
	let mainThread: MainThreadDataConnections;
	let configurationService: TestConfigurationService;
	let profiles: IDataConnectionProfile[];
	let instances: IDataConnectionInstance[];
	let onDidChangeInstances: Emitter<IDataConnectionInstance[]>;
	let onDidChangeProfiles: Emitter<IDataConnectionProfile[]>;

	beforeEach(() => {
		registeredDrivers = [];
		profiles = [];
		instances = [];
		onDidChangeInstances = disposables.add(new Emitter<IDataConnectionInstance[]>());
		onDidChangeProfiles = disposables.add(new Emitter<IDataConnectionProfile[]>());
		configurationService = new TestConfigurationService({ dataConnections: { enabled: true } });
		$onDidChangeDataConnections.mockClear();
		connect.mockReset();
		connect.mockImplementation(async (profileId: string) => instance(profileId, {}));
		const driverManager = stubInterface<IDataConnectionsDriverManager>({
			registerDriver: driver => { registeredDrivers.push(driver); },
			getDrivers: () => registeredDrivers,
		});
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({
			driverManager,
			getProfiles: () => profiles,
			getProfile: (id: string) => profiles.find(p => p.id === id),
			getInstances: () => instances,
			getInstanceForProfile: (profileId: string) => instances.find(i => i.profileId === profileId),
			connect,
			onDidChangeInstances: onDidChangeInstances.event,
			onDidChangeProfiles: onDidChangeProfiles.event,
		});
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostDataConnectionsShape>({
				$discoverConnections,
				$onDidChangeDataConnections,
			}) as T) as IExtHostContext['getProxy'],
		});
		mainThread = disposables.add(
			new MainThreadDataConnections(
				extHostContext, dataConnectionsService, configurationService, new NullLogService(),
			),
		);
	});

	/**
	 * Returns the file parameter of the single registered driver, narrowed to the file variant so
	 * its filters are accessible.
	 */
	function registeredFileParameter() {
		const parameter = registeredDrivers[0].metadata.mechanisms[0].parameters.find(p => p.type === 'file');
		if (parameter?.type !== 'file') {
			throw new Error('expected the registered driver to have a file parameter');
		}
		return parameter;
	}

	it('converts the file parameter filters dictionary to an ordered FileFilter array', () => {
		mainThread.$registerDataConnectionDriver('duckdb', metadataDto);

		expect(registeredFileParameter().filters).toMatchInlineSnapshot(`
			[
			  {
			    "extensions": [
			      "duckdb",
			      "ddb",
			    ],
			    "name": "DuckDB Files",
			  },
			  {
			    "extensions": [
			      "bak",
			    ],
			    "name": "Backups",
			  },
			]
		`);
	});

	it('round-trips driver mechanisms back to the wire shape in driver summaries', async () => {
		mainThread.$registerDataConnectionDriver('duckdb', metadataDto);

		const summaries = await mainThread.$getDataConnectionDrivers();

		// The summary must equal what the extension declared: the FileFilter array flattens back
		// to the label -> extensions dictionary and non-file parameters pass through untouched.
		expect(summaries[0].mechanisms).toEqual(metadataDto.mechanisms);
	});

	it('maps a discovered connection onto the service shape, renaming parameters to parameterValues', async () => {
		mainThread.$registerDataConnectionDriver('duckdb', metadataDto);
		$discoverConnections.mockResolvedValue([{
			id: 'pagila',
			name: 'Pagila',
			description: 'localhost:5432/pagila',
			mechanismId: 'file',
			parameters: { databasePath: '/data/pagila.duckdb', readOnly: true },
		}]);

		const discovered = await registeredDrivers[0].discoverConnections();

		// The one field that changes name across the boundary is `parameters` -> `parameterValues`.
		// A rename that silently stops landing leaves the connection with nothing to connect with,
		// which reaches the user as a failure on empty credentials rather than as a mapping bug --
		// so the whole mapped shape is pinned here, description included.
		expect(discovered).toMatchInlineSnapshot(`
			[
			  {
			    "description": "localhost:5432/pagila",
			    "id": "pagila",
			    "mechanismId": "file",
			    "name": "Pagila",
			    "parameterValues": {
			      "databasePath": "/data/pagila.duckdb",
			      "readOnly": true,
			    },
			  },
			]
		`);
	});

	// A driver that reports no summary must not invent one: the pane falls back to the driver name,
	// and an empty string would render as a bare separator with nothing after it.
	it('leaves a discovered connection description undefined when the driver reports none', async () => {
		mainThread.$registerDataConnectionDriver('duckdb', metadataDto);
		$discoverConnections.mockResolvedValue([{
			id: 'pagila',
			name: 'Pagila',
			mechanismId: 'file',
			parameters: {},
		}]);

		const discovered = await registeredDrivers[0].discoverConnections();

		expect(discovered[0].description).toBeUndefined();
	});

	it('leaves filters undefined across the boundary when the file parameter declares none', async () => {
		const withoutFilters: IDataConnectionDriverMetadataDTO = {
			...metadataDto,
			mechanisms: [{
				...metadataDto.mechanisms[0],
				parameters: [{ id: 'databasePath', label: 'Database File', type: 'file', required: true }],
			}],
		};
		mainThread.$registerDataConnectionDriver('duckdb', withoutFilters);

		expect(registeredFileParameter().filters).toBeUndefined();

		const summaries = await mainThread.$getDataConnectionDrivers();
		expect(summaries[0].mechanisms[0].parameters[0].filters).toBeUndefined();
	});

	describe('reading the user\'s own connections', () => {

		it('reports every saved connection, and which of them are live', async () => {
			profiles = [profile('p1', 'Sales'), profile('p2', 'Archive')];
			instances = [instance('p1', {})];

			await expect(mainThread.$getDataConnections()).resolves.toMatchInlineSnapshot(`
				[
				  {
				    "connected": true,
				    "driverId": "duckdb",
				    "driverName": "DuckDB",
				    "name": "Sales",
				    "profileId": "p1",
				  },
				  {
				    "connected": false,
				    "driverId": "duckdb",
				    "driverName": "DuckDB",
				    "name": "Archive",
				    "profileId": "p2",
				  },
				]
			`);
		});

		it('carries no connection parameters', async () => {
			// The payload says what the user is connected to, not how. A host name or an account
			// identifier here is one every consumer would then have to be careful with.
			profiles = [{ ...profile('p1', 'Sales'), parameterValues: { host: 'secret.internal', token: 'hunter2' } }];

			const [summary] = await mainThread.$getDataConnections();

			expect(JSON.stringify(summary)).not.toContain('secret.internal');
			expect(JSON.stringify(summary)).not.toContain('hunter2');
		});

		it('reports nothing when the feature is disabled', async () => {
			// Reads the same to a caller as the user having no connections, which is the point:
			// there is nothing for them to act on either way.
			profiles = [profile('p1', 'Sales')];
			configurationService.setUserConfiguration('dataConnections', { enabled: false });

			await expect(mainThread.$getDataConnections()).resolves.toEqual([]);
		});

		it('opens a connection the user configured', async () => {
			profiles = [profile('p1', 'Sales')];

			await expect(mainThread.$openDataConnection('p1')).resolves.toBe(true);
			expect(connect).toHaveBeenCalledWith('p1');
		});

		it('says no rather than opening anything for a profile that no longer exists', async () => {
			// A caller can hold an id the user has since removed -- a file that remembers the
			// database it was written against, say -- and that is ordinary, not an error.
			await expect(mainThread.$openDataConnection('gone')).resolves.toBe(false);
			expect(connect).not.toHaveBeenCalled();
		});

		it('opens nothing when the feature is disabled', async () => {
			profiles = [profile('p1', 'Sales')];
			configurationService.setUserConfiguration('dataConnections', { enabled: false });

			await expect(mainThread.$openDataConnection('p1')).resolves.toBe(false);
			expect(connect).not.toHaveBeenCalled();
		});

		it('surfaces the driver\'s failure rather than reporting a connection that is not open', async () => {
			// Credentials expire and hosts go away. The caller needs the reason to say anything
			// useful about it, and must not be told the connection is open when it is not.
			profiles = [profile('p1', 'Sales')];
			connect.mockRejectedValue(new Error('password authentication failed'));

			await expect(mainThread.$openDataConnection('p1')).rejects.toThrow('password authentication failed');
		});

		it('summarizes a live connection\'s schema', async () => {
			instances = [instance('p1', {
				getChildren: async () => [
					{ name: 'orders', kind: 'table', nodeHandle: 2, hasGetChildren: true, hasPreview: true },
				],
				nodeGetChildren: async () => [
					{ name: 'id', kind: 'field', dataType: 'int', nodeHandle: 3, hasGetChildren: false, hasPreview: false },
				],
			})];

			const schema = await mainThread.$getDataConnectionSchema('p1', {});

			expect(schema?.nodes).toMatchInlineSnapshot(`
				[
				  {
				    "children": [
				      {
				        "dataType": "int",
				        "kind": "field",
				        "name": "id",
				      },
				    ],
				    "kind": "table",
				    "name": "orders",
				  },
				]
			`);
		});

		it('says the schema was truncated when a bound left something out', async () => {
			// The caller needs this to know it cannot tell a name the schema is missing from a
			// name the user got wrong.
			instances = [instance('p1', {
				getChildren: async () => [
					{ name: 'a', kind: 'table', nodeHandle: 2, hasGetChildren: false, hasPreview: true },
					{ name: 'b', kind: 'table', nodeHandle: 3, hasGetChildren: false, hasPreview: true },
				],
			})];

			const schema = await mainThread.$getDataConnectionSchema('p1', { maxNodesPerLevel: 1 });

			expect(schema?.truncated).toBe(true);
		});

		it('has no schema for a connection that is not live', async () => {
			profiles = [profile('p1', 'Sales')];

			await expect(mainThread.$getDataConnectionSchema('p1', {})).resolves.toBeUndefined();
		});

		it('does not register a borrowed handle, so it cannot be released', async () => {
			// The connection belongs to the user. Releasing or disconnecting it is not something
			// an extension that merely read its schema should be able to do.
			const release = vi.fn();
			instances = [instance('p1', { getChildren: async () => [], release })];

			await mainThread.$getDataConnectionSchema('p1', {});
			mainThread.$releaseConnectionViaService(1);

			expect(release).not.toHaveBeenCalled();
		});

		it('tells the extension host when a connection opens or closes', () => {
			onDidChangeInstances.fire([]);

			expect($onDidChangeDataConnections).toHaveBeenCalledTimes(1);
		});

		it('tells the extension host when a profile is added or removed', () => {
			// Both events matter: instances are which connections are live, profiles are which
			// connections exist at all, and either changes what getConnections would answer.
			onDidChangeProfiles.fire([]);

			expect($onDidChangeDataConnections).toHaveBeenCalledTimes(1);
		});
	});
});
