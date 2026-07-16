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
import { IDataConnectionDriver, IDataConnectionProfile } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionsDriverManager } from '../../../../services/positronDataConnections/common/interfaces/dataConnectionsDriverManager.js';
import { IPositronDataConnectionsService } from '../../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { getDataConnections } from '../../browser/positronDataConnectionsCommands.js';

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
		getRedactedParameterValue: vi.fn(async (_id: string, parameterId: string) => redactedValues[parameterId]),
		getInstanceForProfile: vi.fn((profileId: string) => connectedProfileIds.includes(profileId)
			? stubInterface<IDataConnectionInstance>({ id: 'instance-1' })
			: undefined),
	});
}

describe('getDataConnections', () => {
	const ctx = createTestContainer().build();

	function run(dataConnectionsService: IPositronDataConnectionsService, enabled: boolean = true) {
		ctx.instantiationService.stub(IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': enabled }));
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
