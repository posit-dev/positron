/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionHandle } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionNodeDTO } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDTOs.js';
import { getDataConnectionSchema } from '../../browser/positronDataConnectionsCommands.js';

function node(overrides: Partial<IDataConnectionNodeDTO> & Pick<IDataConnectionNodeDTO, 'nodeHandle' | 'name' | 'kind'>): IDataConnectionNodeDTO {
	return { hasGetChildren: false, hasPreview: false, ...overrides };
}

// Builds a connectionHandle whose getChildren()/nodeGetChildren() serve a single table with two
// columns -- just enough shape for the command's plumbing; summarizeDataConnectionSchema's own
// tree-walking behavior (flattening, truncation, depth) is covered by its own test suite.
function createConnectionHandle(rootChildren: IDataConnectionNodeDTO[] = [
	node({ nodeHandle: 1, name: 'widgets', kind: 'table', hasGetChildren: true }),
]): IDataConnectionHandle {
	return stubInterface<IDataConnectionHandle>({
		getChildren: async () => rootChildren,
		nodeGetChildren: async (nodeHandle: number) => nodeHandle === 1
			? [
				node({ nodeHandle: 2, name: 'id', kind: 'field', dataType: 'INTEGER', isPrimaryKey: true }),
				node({ nodeHandle: 3, name: 'name', kind: 'field', dataType: 'TEXT' }),
			]
			: [],
	});
}

// Builds a stubInterface-backed IPositronDataConnectionsService exposing only getInstanceForProfile
// -- the one member getDataConnectionSchema reads. stubInterface throws on any other property
// read, so a future call to e.g. getProfile would fail the test loudly instead of silently passing.
function createDataConnectionsService(connectedInstances: Record<string, IDataConnectionHandle> = {}): IPositronDataConnectionsService {
	return stubInterface<IPositronDataConnectionsService>({
		getInstanceForProfile: vi.fn((profileId: string) => {
			const connectionHandle = connectedInstances[profileId];
			return connectionHandle === undefined ? undefined : stubInterface<IDataConnectionInstance>({ connectionHandle });
		}),
	});
}

describe('getDataConnectionSchema', () => {
	const ctx = createTestContainer().build();

	function run(dataConnectionsService: IPositronDataConnectionsService, profileId: string, maxDepth?: number, enabled: boolean = true) {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': enabled,
		}));
		ctx.instantiationService.stub(IPositronDataConnectionsService, dataConnectionsService);
		return getDataConnectionSchema(ctx.instantiationService, { profileId, maxDepth });
	}

	it('returns { enabled: false } when the feature flag is off, without touching the service', async () => {
		const getInstanceForProfile = vi.fn();
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getInstanceForProfile });

		const result = await run(dataConnectionsService, 'conn-1', undefined, false);

		expect(result).toEqual({ enabled: false });
		expect(getInstanceForProfile).not.toHaveBeenCalled();
	});

	it('returns { connected: false } when no live instance exists for the profile', async () => {
		const dataConnectionsService = createDataConnectionsService();

		const result = await run(dataConnectionsService, 'conn-1');

		expect(result).toEqual({ connected: false });
	});

	it('returns the summarized schema for a connected profile', async () => {
		const dataConnectionsService = createDataConnectionsService({ 'conn-1': createConnectionHandle() });

		const result = await run(dataConnectionsService, 'conn-1');

		expect(result).toEqual({
			connected: true,
			profileId: 'conn-1',
			schema: [{
				name: 'widgets',
				kind: 'table',
				children: [
					{ name: 'id', kind: 'field', dataType: 'INTEGER', isPrimaryKey: true },
					{ name: 'name', kind: 'field', dataType: 'TEXT' },
				],
			}],
			truncated: false,
		});
	});

	it('forwards maxDepth to the schema summary, truncating the table before its columns', async () => {
		const dataConnectionsService = createDataConnectionsService({ 'conn-1': createConnectionHandle() });

		const result = await run(dataConnectionsService, 'conn-1', 1);

		expect(result).toEqual({
			connected: true,
			profileId: 'conn-1',
			schema: [{ name: 'widgets', kind: 'table', truncated: true }],
			truncated: true,
		});
	});

	it('surfaces truncation markers for a large schema', async () => {
		const manyTables = Array.from({ length: 250 }, (_, i) => node({ nodeHandle: 100 + i, name: `table_${i}`, kind: 'table' }));
		const dataConnectionsService = createDataConnectionsService({ 'conn-1': createConnectionHandle(manyTables) });

		const result = await run(dataConnectionsService, 'conn-1');

		expect(result.connected).toBe(true);
		expect(result).toMatchObject({ truncated: true });
		if (result.connected) {
			expect(result.schema).toHaveLength(200);
		}
	});

	it('produces a payload that survives a JSON round-trip', async () => {
		const dataConnectionsService = createDataConnectionsService({ 'conn-1': createConnectionHandle() });

		const result = await run(dataConnectionsService, 'conn-1');

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});
