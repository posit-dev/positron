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
import { IDataConnectionCodeCommandArgs, IDataConnectionSchemaCommandArgs, getDataConnectionCode, getDataConnectionSchema, getDataConnections } from '../../browser/positronDataConnectionsCommands.js';

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
		expect(result.summary).toBe(
			'name=My Connection | driver=test-driver | mechanism=test-mechanism | languages=python, r | parameters=host=localhost, apiKey=****last4');
	});

	it('omits a secret parameter when the driver has no redacted value for it', async () => {
		const dataConnectionsService = createDataConnectionsService({
			secretParameterIds: ['apiKey'],
			redactedValues: {},
		});

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=My Connection | driver=test-driver | mechanism=test-mechanism | languages=python, r | parameters=host=localhost');
	});

	// The catalog answers "which connections do I have?", and generating code for every profile in it
	// costs a round trip to the driver per profile per language. getConnectionCode generates code for
	// the one profile a caller settles on instead.
	it('generates no connection code, whatever the driver could produce', async () => {
		const generateConnectionCode = vi.fn(async () => [{ id: 'default', label: 'Default', code: 'conn = connect()\n' }]);
		const dataConnectionsService = createDataConnectionsService({
			profiles: [createProfile({ id: 'conn-1' }), createProfile({ id: 'conn-2' })],
			driver: createDriver({ generateConnectionCode }),
		});

		const result = await run(dataConnectionsService);

		expect(result.map(profile => Object.keys(profile))).toEqual([
			['profileId', 'connected', 'summary'],
			['profileId', 'connected', 'summary'],
		]);
		expect(generateConnectionCode).not.toHaveBeenCalled();
	});

	// The catalog's `languages` field is what tells a caller whether asking for code is worth a call
	// at all; an unregistered driver (extension not installed, or not yet activated) has none.
	it('omits the code languages when the profile\'s driver is unregistered', async () => {
		const dataConnectionsService = createDataConnectionsService({
			profiles: [createProfile({ driverMetadata: { ...createProfile().driverMetadata, id: 'absent-driver' } })],
		});

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=My Connection | driver=absent-driver | mechanism=test-mechanism | parameters=host=localhost');
	});

	// The summary line's own delimiters are ordinary characters in a connection string, so a value
	// containing one is quoted rather than silently splitting the line into extra parameters.
	it('quotes a parameter value containing a summary delimiter', async () => {
		const profile = createProfile({
			connectionName: 'Prod, EU',
			parameterValues: { dsn: 'Driver={ODBC},Server=db' },
		});
		const dataConnectionsService = createDataConnectionsService({ profiles: [profile] });

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name="Prod, EU" | driver=test-driver | mechanism=test-mechanism | languages=python, r | parameters=dsn="Driver={ODBC},Server=db"');
	});

	// A driver names its own parameters, so one may well collide with a reserved summary key. Nesting
	// them under `parameters=` keeps that from emitting a second `driver=` token on the same line.
	it('keeps a parameter named after a reserved summary key out of the line\'s own namespace', async () => {
		const profile = createProfile({ parameterValues: { driver: 'ODBC Driver 18', name: 'db1' } });
		const dataConnectionsService = createDataConnectionsService({ profiles: [profile] });

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=My Connection | driver=test-driver | mechanism=test-mechanism | languages=python, r | parameters=driver=ODBC Driver 18, name=db1');
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
		const dataConnectionsService = createDataConnectionsService({
			secretParameterIds: ['apiKey'],
			redactedValues: { apiKey: '****last4' },
			connectedProfileIds: ['conn-1'],
		});

		const result = await run(dataConnectionsService);

		expect(JSON.parse(JSON.stringify(result))).toEqual(result);
	});
});

// Two variants for python and one for r, so a test can tell the preferred variant, the fallback, and
// the language filter apart. The spy is returned alongside the driver: naming a language must not
// generate the others, which is a fact about calls rather than about the payload.
function createCodeDriver() {
	const generateConnectionCode = vi.fn(async (_mechanismId: string, languageId: string) => languageId === 'python'
		? [
			{ id: 'default', label: 'Default', code: 'import x\n\nconn = x.connect()\n' },
			{ id: 'sqlalchemy', label: 'SQLAlchemy', code: 'import sqlalchemy as sa\n\nengine = sa.create_engine("x")\n' },
		]
		: [{ id: 'dbi', label: 'DBI', code: 'con <- DBI::dbConnect(x)\n' }]);

	return { driver: createDriver({ generateConnectionCode }), generateConnectionCode };
}

const PYTHON_CODE = { code: 'import x\n\nconn = x.connect()\n', variableName: 'conn' };
const R_CODE = { code: 'con <- DBI::dbConnect(x)\n', variableName: 'con' };

describe('getDataConnectionCode', () => {
	const ctx = createTestContainer().build();

	function run(dataConnectionsService: IPositronDataConnectionsService, args: IDataConnectionCodeCommandArgs, enabled: boolean = true) {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({
			'dataConnections.enabled': enabled,
		}));
		// The command logs why it declined to generate code; the tests assert the reason it reports to
		// the caller rather than the log wording.
		ctx.instantiationService.stub(ILogService, new NullLogService());
		ctx.instantiationService.stub(IPositronDataConnectionsService, dataConnectionsService);
		return getDataConnectionCode(ctx.instantiationService, args);
	}

	it('reports the feature flag being off, without touching the service', async () => {
		const getProfiles = vi.fn(() => [createProfile()]);
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getProfiles });

		const result = await run(dataConnectionsService, { profileId: 'conn-1' }, false);

		expect(result).toEqual({ available: false, reason: 'disabled' });
		expect(getProfiles).not.toHaveBeenCalled();
	});

	it('honors the preferred variant per language, falling back to variants[0]', async () => {
		const preferred = createProfile({ id: 'conn-preferred', preferredCodeVariants: { python: 'sqlalchemy' } });
		const unset = createProfile({ id: 'conn-unset' });
		const dataConnectionsService = createDataConnectionsService({
			profiles: [preferred, unset],
			driver: createCodeDriver().driver,
		});

		expect(await run(dataConnectionsService, { profileId: 'conn-preferred', languageId: 'python' })).toEqual({
			profileId: 'conn-preferred',
			languages: {
				python: {
					code: 'import sqlalchemy as sa\n\nengine = sa.create_engine("x")\n',
					variableName: 'engine',
				},
			},
		});
		expect(await run(dataConnectionsService, { profileId: 'conn-unset', languageId: 'python' })).toEqual({
			profileId: 'conn-unset',
			languages: { python: PYTHON_CODE },
		});
	});

	// Naming a language is the caller's main lever on payload size, so it must not generate the
	// others: each one is a round trip to the driver as well as bytes the caller didn't ask for.
	it('generates only the language asked for', async () => {
		const { driver, generateConnectionCode } = createCodeDriver();
		const dataConnectionsService = createDataConnectionsService({ driver });

		const result = await run(dataConnectionsService, { profileId: 'conn-1', languageId: 'r' });

		expect(result).toEqual({ profileId: 'conn-1', languages: { r: R_CODE } });
		expect(generateConnectionCode).toHaveBeenCalledTimes(1);
	});

	it('generates every language the driver supports when none is named', async () => {
		const dataConnectionsService = createDataConnectionsService({ driver: createCodeDriver().driver });

		expect(await run(dataConnectionsService, { profileId: 'conn-1' })).toEqual({
			profileId: 'conn-1',
			languages: { python: PYTHON_CODE, r: R_CODE },
		});
	});

	// A missing profileId lands in the same place as an unknown one: the argument object comes from a
	// command invocation, so it can be absent however the schema describes it.
	it.each([
		{ label: 'an unknown profile id', args: { profileId: 'conn-missing' } },
		{ label: 'no arguments at all', args: undefined },
	])('reports $label', async ({ args }) => {
		expect(await run(createDataConnectionsService(), args as IDataConnectionCodeCommandArgs))
			.toEqual({ available: false, reason: 'not-found' });
	});

	// The same condition the catalog reports by leaving `languages` out of its summary: no driver,
	// nothing to generate code with.
	it('reports the profile\'s driver being unregistered', async () => {
		const dataConnectionsService = createDataConnectionsService({
			profiles: [createProfile({ driverMetadata: { ...createProfile().driverMetadata, id: 'absent-driver' } })],
		});

		expect(await run(dataConnectionsService, { profileId: 'conn-1' }))
			.toEqual({ available: false, reason: 'no-driver' });
	});

	// Naming a language the driver doesn't support is an easy mistake to make and a cheap one to
	// recover from -- as long as the payload says what could have been asked for instead.
	it('reports no code, naming the languages the driver does support', async () => {
		const dataConnectionsService = createDataConnectionsService({ driver: createCodeDriver().driver });

		expect(await run(dataConnectionsService, { profileId: 'conn-1', languageId: 'julia' })).toEqual({
			available: false,
			reason: 'no-code',
			supportedLanguageIds: ['python', 'r'],
		});
	});

	// A driver that throws is reported the same way as one that returns nothing: the caller gets a
	// reason, not a rejected promise.
	it('reports no code when the driver fails to generate any', async () => {
		const driver = createDriver({
			generateConnectionCode: vi.fn(async () => { throw new Error('no code for you'); }),
		});
		const dataConnectionsService = createDataConnectionsService({ driver });

		expect(await run(dataConnectionsService, { profileId: 'conn-1' }))
			.toEqual({ available: false, reason: 'no-code', supportedLanguageIds: ['python', 'r'] });
	});

	it('produces a payload that survives a JSON round-trip', async () => {
		const dataConnectionsService = createDataConnectionsService({ driver: createCodeDriver().driver });

		const result = await run(dataConnectionsService, { profileId: 'conn-1' });

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

		expect(result).toEqual({ instanceId: '2', lines: ['orders [table]'], truncated: false });
	});

	it('defaults to the only live connection when no profileId is given', async () => {
		const dataConnectionsService = createInstancesService([createInstance('conn-a', 1, ['employees'])]);

		const result = await run(dataConnectionsService);

		expect(result).toEqual({ instanceId: '1', lines: ['employees [table]'], truncated: false });
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

		expect(result).toEqual({ instanceId: '1', lines: ['t1 [table]'], truncated: true });
	});
});

