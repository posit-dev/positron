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

// A discovered ODBC data source, the way the service publishes one: a namespaced id, the
// discovered marker, and no description unless the test sets one.
function createDiscoveredProfile(overrides: Partial<IDataConnectionProfile> = {}): IDataConnectionProfile {
	return createProfile({
		id: 'discovered:test-driver:odbc-dsn:Pagila',
		connectionName: 'Pagila',
		parameterValues: { dsn: 'Pagila' },
		discovered: true,
		...overrides,
	});
}

// The catalog stubs both service factories share, mirroring the real service: getAllProfiles is
// the saved profiles followed by the discovered ones, and getProfile resolves ids across both.
function createCatalogStubs(
	profiles: IDataConnectionProfile[],
	discoveredProfiles: IDataConnectionProfile[],
) {
	const allProfiles = [...profiles, ...discoveredProfiles];
	return {
		getAllProfiles: vi.fn(() => allProfiles),
		getProfile: vi.fn((profileId: string) => allProfiles.find(profile => profile.id === profileId)),
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
	discoveredProfiles?: IDataConnectionProfile[];
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
		discoveredProfiles = [],
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
		...createCatalogStubs(profiles, discoveredProfiles),
		// Mirrors the real getDisplayParameterValues: every parameter the profile carries, plus the
		// secret ones it holds elsewhere, offered to the driver for redaction. A value the driver
		// redacts appears masked; a secret it cannot redact is left out entirely.
		getDisplayParameterValues: vi.fn(async (profile: IDataConnectionProfile) => {
			const displayValues = { ...profile.parameterValues };
			for (const parameterId of [...Object.keys(displayValues), ...secretParameterIds]) {
				if (redactedValues[parameterId] !== undefined) {
					displayValues[parameterId] = redactedValues[parameterId];
				} else if (secretParameterIds.includes(parameterId)) {
					delete displayValues[parameterId];
				}
			}
			return displayValues;
		}),
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
		const getAllProfiles = vi.fn(() => [createProfile()]);
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getAllProfiles });

		const result = await run(dataConnectionsService, false);

		expect(result).toEqual([]);
		expect(getAllProfiles).not.toHaveBeenCalled();
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

	// The parameter a driver declares `string` can still carry a credential -- an ODBC connection
	// string embedding PWD= -- and the driver is the only thing that can find it, so the catalog
	// offers it every value rather than only the declared secrets.
	it('masks a credential the driver redacts out of a non-secret parameter', async () => {
		const profile = createProfile({
			parameterValues: { connectionString: 'DSN=Pagila;UID=admin;PWD=hunter2' },
		});
		const dataConnectionsService = createDataConnectionsService({
			profiles: [profile],
			redactedValues: { connectionString: 'DSN=Pagila;UID=admin;PWD=****' },
		});

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=My Connection | driver=test-driver | mechanism=test-mechanism | languages=python, r | parameters=connectionString="DSN=Pagila;UID=admin;PWD=****"');
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

	// A registered driver that supports no languages is a different condition from a missing driver,
	// and the summary keeps them distinguishable: the field goes away entirely only when the driver
	// does. An empty `languages=` matches the `no-code` getConnectionCode would report.
	it('keeps an empty languages field when the registered driver supports no languages', async () => {
		const driverMetadata = { ...createProfile().driverMetadata, supportedLanguageIds: [] };
		const dataConnectionsService = createDataConnectionsService({
			profiles: [createProfile({ driverMetadata })],
			driver: createDriver({ metadata: { ...createDriver().metadata, supportedLanguageIds: [] } }),
		});

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=My Connection | driver=test-driver | mechanism=test-mechanism | languages= | parameters=host=localhost');
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

	// Discovered connections (e.g. ODBC data sources) are part of the catalog too: they answer
	// "which connections do I have?" just as well as a saved profile, and their ids work with
	// getConnectionCode and getSchema. Saved profiles come first, matching the pane's ordering.
	it('lists discovered connections after the saved profiles, marked in their summary', async () => {
		const discovered = createDiscoveredProfile({ description: 'localhost:5432/pagila' });
		const dataConnectionsService = createDataConnectionsService({
			profiles: [createProfile()],
			discoveredProfiles: [discovered],
		});

		const result = await run(dataConnectionsService);

		expect(result.map(entry => entry.profileId)).toEqual(['conn-1', 'discovered:test-driver:odbc-dsn:Pagila']);
		expect(result[1].summary).toBe(
			'name=Pagila | driver=test-driver | mechanism=test-mechanism | discovered=true | description=localhost:5432/pagila | languages=python, r | parameters=dsn=Pagila');
	});

	// `description` is optional on a discovery -- only the marker is guaranteed, and a saved
	// profile's summary carries neither, so the marker's absence means "saved".
	it('marks a discovered connection without a description with the bare discovered field', async () => {
		const discovered = createDiscoveredProfile();
		const dataConnectionsService = createDataConnectionsService({
			profiles: [],
			discoveredProfiles: [discovered],
		});

		const [result] = await run(dataConnectionsService);

		expect(result.summary).toBe(
			'name=Pagila | driver=test-driver | mechanism=test-mechanism | discovered=true | languages=python, r | parameters=dsn=Pagila');
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
		const getProfile = vi.fn(() => createProfile());
		const dataConnectionsService = stubInterface<IPositronDataConnectionsService>({ getProfile });

		const result = await run(dataConnectionsService, { profileId: 'conn-1' }, false);

		expect(result).toEqual({ available: false, reason: 'disabled' });
		expect(getProfile).not.toHaveBeenCalled();
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

	// A discovered connection's id, as reported by getConnections, is as good as a saved one: the
	// service resolves discovered profiles by id, so the code path is identical from here on.
	it('generates code for a discovered connection', async () => {
		const discovered = createDiscoveredProfile();
		const dataConnectionsService = createDataConnectionsService({
			profiles: [],
			discoveredProfiles: [discovered],
			driver: createCodeDriver().driver,
		});

		expect(await run(dataConnectionsService, { profileId: discovered.id, languageId: 'python' })).toEqual({
			profileId: discovered.id,
			languages: { python: PYTHON_CODE },
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

interface CreateInstancesServiceOptions {
	// The saved profiles auto-connect can target; empty by default so a test that expects no connect
	// attempt fails loudly (stubInterface throws) if one happens anyway.
	profiles?: IDataConnectionProfile[];

	// The discovered connections auto-connect can target, alongside the saved profiles.
	discoveredProfiles?: IDataConnectionProfile[];

	// What connecting a profile produces. Defaults to failing, so a test that expects a summary must
	// say what the connect yields.
	connect?: (profileId: string) => Promise<IDataConnectionInstance>;
}

function createInstancesService(
	instances: IDataConnectionInstance[],
	options: CreateInstancesServiceOptions = {},
): IPositronDataConnectionsService {
	const {
		profiles = [],
		discoveredProfiles = [],
		connect = async () => { throw new Error('connection refused'); },
	} = options;

	return stubInterface<IPositronDataConnectionsService>({
		driverManager: stubInterface<IDataConnectionsDriverManager>({
			getDriver: vi.fn((driverId: string) => driverId === 'test-driver' ? createDriver() : undefined),
		}),
		getInstances: vi.fn(() => instances),
		getInstanceForProfile: vi.fn((profileId: string) =>
			instances.find(instance => instance.profileId === profileId)),
		...createCatalogStubs(profiles, discoveredProfiles),
		connect: vi.fn(connect),
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

	// The auto-connect: naming a profile is enough, whether or not it is live yet. The service's
	// connect() resolves the stored secrets itself, so the command needs nothing beyond the id.
	it('connects the named profile when it is not live, then summarizes it', async () => {
		const connect = vi.fn(async (profileId: string) => createInstance(profileId, 3, ['invoices']));
		const dataConnectionsService = createInstancesService(
			[createInstance('conn-a', 1, ['employees'])],
			{ profiles: [createProfile({ id: 'conn-cold' })], connect });

		const result = await run(dataConnectionsService, { profileId: 'conn-cold' });

		expect(result).toEqual({ instanceId: '3', lines: ['invoices [table]'], truncated: false });
		expect(connect).toHaveBeenCalledWith('conn-cold');
	});

	it('reports the named profile not existing, without a connect attempt', async () => {
		const connect = vi.fn();
		const dataConnectionsService = createInstancesService(
			[createInstance('conn-a', 1, ['employees'])],
			{ connect });

		expect(await run(dataConnectionsService, { profileId: 'conn-missing' }))
			.toEqual({ connected: false, reason: 'not-found' });
		expect(connect).not.toHaveBeenCalled();
	});

	// The same condition getConnectionCode reports as no-driver: the profile's extension isn't
	// installed or hasn't activated, so a connect attempt could only throw.
	it('reports the named profile\'s driver being unregistered, without a connect attempt', async () => {
		const connect = vi.fn();
		const profile = createProfile({
			id: 'conn-cold',
			driverMetadata: { ...createProfile().driverMetadata, id: 'absent-driver' },
		});
		const dataConnectionsService = createInstancesService([], { profiles: [profile], connect });

		expect(await run(dataConnectionsService, { profileId: 'conn-cold' }))
			.toEqual({ connected: false, reason: 'no-driver' });
		expect(connect).not.toHaveBeenCalled();
	});

	// A connect that throws is reported the same way as any other no-summary case: the caller gets a
	// reason, not a rejected promise.
	it('reports the automatic connect failing', async () => {
		const dataConnectionsService = createInstancesService([], {
			profiles: [createProfile({ id: 'conn-cold' })],
		});

		expect(await run(dataConnectionsService, { profileId: 'conn-cold' }))
			.toEqual({ connected: false, reason: 'connect-failed' });
	});

	it('connects the only saved profile when nothing is live and no profileId is given', async () => {
		const connect = vi.fn(async (profileId: string) => createInstance(profileId, 3, ['invoices']));
		const dataConnectionsService = createInstancesService([], {
			profiles: [createProfile({ id: 'conn-cold' })],
			connect,
		});

		const result = await run(dataConnectionsService);

		expect(result).toEqual({ instanceId: '3', lines: ['invoices [table]'], truncated: false });
		expect(connect).toHaveBeenCalledWith('conn-cold');
	});

	// A discovered connection's id, as reported by getConnections, auto-connects just like a saved
	// one: the service resolves discovered profiles by id, so the code path is identical from here.
	it('connects the named discovered connection when it is not live, then summarizes it', async () => {
		const discovered = createDiscoveredProfile();
		const connect = vi.fn(async (profileId: string) => createInstance(profileId, 4, ['film']));
		// A saved profile sits alongside the discovery, so the single-candidate fallback can't be
		// what connects it: reaching the discovered profile takes the caller-supplied id.
		const dataConnectionsService = createInstancesService([], {
			profiles: [createProfile()],
			discoveredProfiles: [discovered],
			connect,
		});

		const result = await run(dataConnectionsService, { profileId: discovered.id });

		expect(result).toEqual({ instanceId: '4', lines: ['film [table]'], truncated: false });
		expect(connect).toHaveBeenCalledWith(discovered.id);
	});

	// The no-profileId fallback covers the whole catalog getConnections reports, so a machine whose
	// only connection is a detected ODBC data source still gets the auto-connect.
	it('connects the only discovered connection when nothing is live, nothing is saved, and no profileId is given', async () => {
		const discovered = createDiscoveredProfile();
		const connect = vi.fn(async (profileId: string) => createInstance(profileId, 4, ['film']));
		const dataConnectionsService = createInstancesService([], {
			discoveredProfiles: [discovered],
			connect,
		});

		const result = await run(dataConnectionsService);

		expect(result).toEqual({ instanceId: '4', lines: ['film [table]'], truncated: false });
		expect(connect).toHaveBeenCalledWith(discovered.id);
	});

	it('reports there being no connections at all', async () => {
		expect(await run(createInstancesService([])))
			.toEqual({ connected: false, reason: 'no-connections' });
	});

	// Summarizing an arbitrary one of them would be worse than reporting nothing: the caller would
	// have no way to tell it got the schema of a connection it didn't ask about. Listing the live
	// profiles turns the dead end into a retry.
	it('reports an ambiguous target, naming the live profiles to choose from', async () => {
		const dataConnectionsService = createInstancesService([
			createInstance('conn-a', 1, ['employees']),
			createInstance('conn-b', 2, ['orders']),
		]);

		expect(await run(dataConnectionsService)).toEqual({
			connected: false,
			reason: 'ambiguous',
			candidateProfileIds: ['conn-a', 'conn-b'],
		});
	});

	// Auto-connecting an arbitrary saved profile would be worse still: it has the wrong-schema
	// problem above plus a side effect (a connection opened) the caller never asked for.
	it('reports an ambiguous target among saved profiles when nothing is live, without connecting', async () => {
		const connect = vi.fn();
		const dataConnectionsService = createInstancesService([], {
			profiles: [createProfile({ id: 'conn-a' }), createProfile({ id: 'conn-b' })],
			connect,
		});

		expect(await run(dataConnectionsService)).toEqual({
			connected: false,
			reason: 'ambiguous',
			candidateProfileIds: ['conn-a', 'conn-b'],
		});
		expect(connect).not.toHaveBeenCalled();
	});

	// A single saved profile next to detected connections is no tiebreak: the user's one saved
	// profile says nothing about which connection they mean now, so the candidates span both.
	it('reports an ambiguous target across saved and discovered connections when nothing is live', async () => {
		const connect = vi.fn();
		const dataConnectionsService = createInstancesService([], {
			profiles: [createProfile({ id: 'conn-a' })],
			discoveredProfiles: [createDiscoveredProfile()],
			connect,
		});

		expect(await run(dataConnectionsService)).toEqual({
			connected: false,
			reason: 'ambiguous',
			candidateProfileIds: ['conn-a', 'discovered:test-driver:odbc-dsn:Pagila'],
		});
		expect(connect).not.toHaveBeenCalled();
	});

	it('passes the summary bounds through to the summarizer', async () => {
		const dataConnectionsService = createInstancesService([createInstance('conn-a', 1, ['t1', 't2', 't3'])]);

		const result = await run(dataConnectionsService, { maxNodesPerLevel: 1 });

		expect(result).toEqual({ instanceId: '1', lines: ['t1 [table]', '+2 more'], truncated: true });
	});
});

