/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
import { TestSecretStorageService } from '../../../../../platform/secrets/test/common/testSecretStorageService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import { NullExtensionService, IExtensionService } from '../../../extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IDataConnectionDriver, IDataConnectionProfile } from '../../common/interfaces/dataConnectionDriver.js';
import { IPositronDataConnectionsService } from '../../common/interfaces/positronDataConnectionsService.js';
import { PositronDataConnectionsService } from '../../browser/positronDataConnectionsService.js';

function createProfile(id: string): IDataConnectionProfile {
	return {
		id,
		driverMetadata: {
			id: 'test-driver',
			name: 'Test Driver',
			iconSvg: '',
			supportedLanguageIds: ['python', 'r'],
		},
		connectionName: `Connection ${id}`,
		mechanismId: 'test-mechanism',
		parameterValues: {},
	};
}

describe('PositronDataConnectionsService', () => {
	const ctx = createTestContainer()
		.stub(IExtensionService, new NullExtensionService())
		.stub(ILogService, new NullLogService())
		.build();

	let storageService: TestStorageService;
	let service: IPositronDataConnectionsService;

	beforeEach(() => {
		storageService = new TestStorageService();
		ctx.disposables.add(storageService);
		ctx.instantiationService.stub(IStorageService, storageService);
		ctx.instantiationService.stub(ISecretStorageService, new TestSecretStorageService());

		service = ctx.instantiationService.createInstance(PositronDataConnectionsService);
		ctx.disposables.add(service);
	});

	it('has no preferred code variant until one is set', () => {
		service.addUpdateProfile(createProfile('conn-1'));

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toBeUndefined();
	});

	it('sets and round-trips a preferred code variant through storage', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });

		// A fresh service instance backed by the same storage should see the persisted preference.
		const reloaded = ctx.instantiationService.createInstance(PositronDataConnectionsService);
		ctx.disposables.add(reloaded);
		expect(reloaded.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });
	});

	it('keeps preferred variants for other languages when setting a new one', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');
		service.setPreferredCodeVariant('conn-1', 'r', 'dbi');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy', r: 'dbi' });
	});

	it('overwrites the preferred variant for the same language', () => {
		service.addUpdateProfile(createProfile('conn-1'));
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlite3');
		service.setPreferredCodeVariant('conn-1', 'python', 'sqlalchemy');

		expect(service.getProfile('conn-1')?.preferredCodeVariants).toEqual({ python: 'sqlalchemy' });
	});

	it('is a no-op when the profile does not exist', () => {
		expect(() => service.setPreferredCodeVariant('missing', 'python', 'sqlalchemy')).not.toThrow();
		expect(service.getProfile('missing')).toBeUndefined();
	});

	it('keeps a secret in secret storage, not plaintext, when re-saved after its driver becomes unregistered', () => {
		const driver = stubInterface<IDataConnectionDriver>({
			id: 'test-driver',
			metadata: {
				id: 'test-driver',
				name: 'Test Driver',
				description: '',
				iconSvg: '',
				supportedLanguageIds: [],
				mechanisms: [{
					id: 'test-mechanism',
					label: 'Test Mechanism',
					description: '',
					parameters: [{ id: 'apiKey', label: 'API Key', type: 'password', secret: true }],
				}],
			},
		});
		service.driverManager.registerDriver(driver);

		// Save once while the driver is registered, so apiKey is recognized as a secret.
		service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues: { apiKey: 'sekret' } });
		expect(service.getProfile('conn-1')?.parameterValues).toEqual({});

		// The driver's extension unloads before the next save; the profile's secret schema is now
		// unknown at save time.
		service.driverManager.removeDriver('test-driver');
		service.addUpdateProfile({ ...createProfile('conn-1'), parameterValues: { apiKey: 'new-sekret' } });

		// The new value must still be routed to secret storage, not leaked as plaintext into the
		// public profile returned by getProfile.
		expect(service.getProfile('conn-1')?.parameterValues).toEqual({});
	});
});
