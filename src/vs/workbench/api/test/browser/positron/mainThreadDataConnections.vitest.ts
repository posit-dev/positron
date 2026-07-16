/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IExtHostContext } from '../../../../services/extensions/common/extHostCustomers.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IDataConnectionDriver } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionDriverMetadataDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
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

	let registeredDrivers: IDataConnectionDriver[];
	let mainThread: MainThreadDataConnections;

	beforeEach(() => {
		registeredDrivers = [];
		const driverManager = stubInterface<IDataConnectionsDriverManager>({
			registerDriver: driver => { registeredDrivers.push(driver); },
			getDrivers: () => registeredDrivers,
		});
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ driverManager });
		const extHostContext = stubInterface<IExtHostContext>({
			getProxy: (<T>() => stubInterface<ExtHostDataConnectionsShape>({}) as T) as IExtHostContext['getProxy'],
		});
		mainThread = disposables.add(new MainThreadDataConnections(extHostContext, dataConnectionsService));
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
});
