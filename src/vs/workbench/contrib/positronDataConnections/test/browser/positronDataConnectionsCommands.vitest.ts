/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionInstance } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IDataConnectionDriver, IDataConnectionHandle, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionSchemaCommandArgs, getDataConnectionSchema, getDataConnections } from '../../browser/positronDataConnectionsCommands.js';

function createProfile(overrides: Partial<IDataConnectionProfile> = {}): IDataConnectionProfile {
	return {
		id: 'conn-1',
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
		},
		connectionName: 'My Connection',
		mechanismId: 'test-mechanism',
		parameterValues: { host: 'localhost' },
		...overrides,
	};
}

function createDriver(overrides: Partial<IDataConnectionDriver> = {}): IDataConnectionDriver {
	return stubInterface<IDataConnectionDriver>({
		id: 'test-driver',
		metadata: {
			id: 'test-driver',
			name: 'Test Driver',
			description: '',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
			mechanisms: [{ id: 'test-mechanism', label: 'Test Mechanism', description: '', parameters: [] }],
		},
		// No code by default; tests that care about the languages payload override this.
		generateConnectionCode: vi.fn(async () => []),
		...overrides,
	});
}

interface CreateServiceOptions {
	profiles?: IDataConnectionProfile[];
	driver?: IDataConnectionDriver;
	secretParameterIds?: string[];
	redactedValues?: Record<string, string>;
	connectedProfileIds?: string[];
}

// Builds a stubInterface-backed IPositronDataConnectionsService exposing only the members
// getDataConnections actually uses. stubInterface throws on any unset property read, so if the
// command ever grows a call to e.g. getProfileWithSecrets (which reads secret storage), the test
// fails loudly instead of silently passing.
function createDataConnectionsService(options: CreateServiceOptions = {}): IPositronDataConnectionsService {
	const {
		profiles = [createProfile()],
		driver = createDriver(),
		secretParameterIds = [],
		redactedValues = {},
		connectedProfileIds = [],
	} = options;

	const driverManager = stubInterface<IDataConnectionsDriverManager>({
		getDriver: vi.fn((driverId: string) => driverId === driver.id ? driver : undefined),
	});

	return stubInterface<IPositronDataConnectionsService>({
		driverManager,
		getProfiles: vi.fn(() => profiles),
		getProfileSecretIds: vi.fn(() => secretParameterIds),
		getRedactedParameterValues: vi.fn(async (_id: string, parameterIds: readonly string[]) =>
			Object.fromEntries(parameterIds
				.filter(parameterId => redactedValues[parameterId] !== undefined)
				.map(parameterId => [parameterId, redactedValues[parameterId]]))),
		getInstanceForProfile: vi.fn((profileId: string) => connectedProfileIds.includes(profileId)
			? stubInterface<IDataConnectionInstance>({ id: 'instance-1' })
			: undefined),
	});
}

describe('getDataConnections', () => {
	const ctx = createTestContainer().build();

	function run(dataConnectionsService: IPositronDataConnectionsService, enabled: boolean = true) {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': enabled,
		}));
		ctx.instantiationService.stub(IPositronDataConnectionsService, dataConnectionsService);
		return getDataConnections(ctx.instantiationService);
	}

	it('returns an empty list when the feature flag is off, without touching the service', async () => {
		const getProfiles = vi.fn(() => [createProfile()]);
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getProfiles });

		const result = await run(dataConnectionsService, false);

		expect(result).toEqual([]);
		expect(getProfiles).not.toHaveBeenCalled();
	});

	// ai.enabled is deliberately not a gate: these payloads are the user's own configuration, not an
	// AI feature, and no other agentCompatible command gates on it. A stray check here would take the
	// inspect actions away from a user who turned AI off.
	it('reports connections even when ai.enabled is off', async () => {
		const dataConnectionsService = createDataConnectionsService();
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': true,
			'ai.enabled': false,
		}));
		ctx.instantiationService.stub(IPositronDataConnectionsService, dataConnectionsService);

		const result = await getDataConnections(ctx.instantiationService);

		expect(result).toHaveLength(1);
	});

	it('never exposes secret parameter values, and never reads secret storage', async () => {
		const profile = createProfile({ parameterValues: { host: 'localhost' } });
		const dataConnectionsService = createDataConnectionsService({
			profiles: [profile],
			secretParameterIds: ['apiKey'],
			redactedValues: { apiKey: '****last4' },
		});

		const [result] = await run(dataConnectionsService);

		// Only the redacted form is present; the stub never received or exposed the raw secret, and
		// stubInterface would have thrown had the command tried to read secret storage directly
		// (e.g. via a getProfileWithSecrets call, which this stub deliberately omits).
		expect(result.parameterValues).toEqual({ host: 'localhost', apiKey: '****last4' });
	});

	it('omits a secret parameter when the driver has no redacted value for it', async () => {
		const dataConnectionsService = createDataConnectionsService({
			secretParameterIds: ['apiKey'],
			redactedValues: {},
		});

		const [result] = await run(dataConnectionsService);

		expect(result.parameterValues).toEqual({ host: 'localhost' });
	});

	it('honors the preferred variant per language, falling back to variants[0]', async () => {
		const driver = createDriver({
			generateConnectionCode: vi.fn(async (_mechanismId: string, languageId: string) => languageId === 'python'
				? [
					{ id: 'default', label: 'Default', code: 'import x\n\nconn = x.connect()\n' },
					{ id: 'sqlalchemy', label: 'SQLAlchemy', code: 'import sqlalchemy as sa\n\nengine = sa.create_engine("x")\n' },
				]
				: []),
		});

		const preferred = createProfile({ id: 'conn-preferred', preferredCodeVariants: { python: 'sqlalchemy' } });
		const unset = createProfile({ id: 'conn-unset' });

		const dataConnectionsService = createDataConnectionsService({ profiles: [preferred, unset], driver });
		const [preferredResult, unsetResult] = await run(dataConnectionsService);

		expect(preferredResult.languages.python).toEqual({
			preferredVariantId: 'sqlalchemy',
			code: 'import sqlalchemy as sa\n\nengine = sa.create_engine("x")\n',
			variableName: 'engine',
		});
		expect(unsetResult.languages.python).toEqual({
			preferredVariantId: 'default',
			code: 'import x\n\nconn = x.connect()\n',
			variableName: 'conn',
		});
	});

	it('reflects live vs. disconnected state per profile', async () => {
		const live = createProfile({ id: 'conn-live' });
		const disconnected = createProfile({ id: 'conn-disconnected' });

		const dataConnectionsService = createDataConnectionsService({
			profiles: [live, disconnected],
			connectedProfileIds: ['conn-live'],
		});

		const [liveResult, disconnectedResult] = await run(dataConnectionsService);

		expect(liveResult.connected).toBe(true);
		expect(disconnectedResult.connected).toBe(false);
	});

	it('produces a payload that survives a JSON round-trip', async () => {
		const driver = createDriver({
			generateConnectionCode: vi.fn(async () => [{ id: 'default', label: 'Default', code: 'conn = connect()\n' }]),
		});
		const dataConnectionsService = createDataConnectionsService({
			driver,
			secretParameterIds: ['apiKey'],
			redactedValues: { apiKey: '****last4' },
			connectedProfileIds: ['conn-1'],
		});

		const result = await run(dataConnectionsService);

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});

// A live connection whose schema is a flat list of tables. Only the handle members
// summarizeDataConnectionSchema actually reads are set, so an unexpected call (e.g. expanding a
// leaf node) throws rather than quietly returning undefined.
function createInstance(profileId: string, handle: number, tableNames: string[]): IDataConnectionInstance {
	return stubInterface<IDataConnectionInstance>({
		profileId,
		connectionHandle: stubInterface<IDataConnectionHandle>({
			handle,
			getChildren: vi.fn(async () => tableNames.map((name, index) => ({
				nodeHandle: index + 1,
				name,
				kind: 'table',
				hasGetChildren: false,
				hasPreview: false,
			}))),
		}),
	});
}

function createInstancesService(instances: IDataConnectionInstance[]): IPositronDataConnectionsService {
	return stubInterface<IPositronDataConnectionsService>({
		getInstances: vi.fn(() => instances),
		getInstanceForProfile: vi.fn((profileId: string) =>
			instances.find(instance => instance.profileId === profileId)),
	});
}

describe('getDataConnectionSchema', () => {
	const ctx = createTestContainer().build();

	function run(dataConnectionsService: IPositronDataConnectionsService, args?: IDataConnectionSchemaCommandArgs, enabled: boolean = true) {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': enabled,
		}));
		// getSchema logs why it declined to summarize anything; the tests assert the reason it reports
		// to the caller rather than the log wording.
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronDataConnectionsService, dataConnectionsService);
		return getDataConnectionSchema(ctx.instantiationService, args);
	}

	// The feature flag is also the inspect actions' precondition, so a caller only reaches this by
	// calling the command directly. It still gets a reason rather than an empty summary.
	it('reports the feature flag being off, without touching the service', async () => {
		const getInstances = vi.fn(() => []);
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getInstances });

		const result = await run(dataConnectionsService, undefined, false);

		expect(result).toEqual({ connected: false, reason: 'disabled' });
		expect(getInstances).not.toHaveBeenCalled();
	});

	it('summarizes the live connection named by profileId', async () => {
		const dataConnectionsService = createInstancesService([
			createInstance('conn-a', 1, ['employees']),
			createInstance('conn-b', 2, ['orders']),
		]);

		const result = await run(dataConnectionsService, { profileId: 'conn-b' });

		expect(result).toEqual({ instanceId: '2', nodes: [{ name: 'orders', kind: 'table' }], truncated: false });
	});

	it('defaults to the only live connection when no profileId is given', async () => {
		const dataConnectionsService = createInstancesService([createInstance('conn-a', 1, ['employees'])]);

		const result = await run(dataConnectionsService);

		expect(result).toEqual({ instanceId: '1', nodes: [{ name: 'employees', kind: 'table' }], truncated: false });
	});

	it('reports the named profile having no live connection', async () => {
		const dataConnectionsService = createInstancesService([createInstance('conn-a', 1, ['employees'])]);

		expect(await run(dataConnectionsService, { profileId: 'conn-missing' }))
			.toEqual({ connected: false, reason: 'not-connected' });
	});

	it('reports nothing being connected', async () => {
		expect(await run(createInstancesService([])))
			.toEqual({ connected: false, reason: 'no-live-connections' });
	});

	// Summarizing an arbitrary one of them would be worse than reporting nothing: the caller would
	// have no way to tell it got the schema of a connection it didn't ask about. Listing the live
	// profiles turns the dead end into a retry.
	it('reports an ambiguous target, naming the profiles to choose from', async () => {
		const dataConnectionsService = createInstancesService([
			createInstance('conn-a', 1, ['employees']),
			createInstance('conn-b', 2, ['orders']),
		]);

		expect(await run(dataConnectionsService)).toEqual({
			connected: false,
			reason: 'ambiguous',
			liveProfileIds: ['conn-a', 'conn-b'],
		});
	});

	it('passes the summary bounds through to the summarizer', async () => {
		const dataConnectionsService = createInstancesService([createInstance('conn-a', 1, ['t1', 't2', 't3'])]);

		const result = await run(dataConnectionsService, { maxNodesPerLevel: 1 });

		expect(result).toEqual({ instanceId: '1', nodes: [{ name: 't1', kind: 'table' }], truncated: true });
	});
});

