/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import * as sinon from 'sinon';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { PositronConnectionsService } from '../browser/positronConnectionsService.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';
import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { TestConnectionInstance } from './positronConnectionInstanceMock.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ensureNoLeakedDisposables } from '../../../../base/test/common/vitestUtils.js';
import { createRuntimeServices, startTestLanguageRuntimeSession } from '../../runtimeSession/test/common/testRuntimeSessionService.js';
import { RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';


describe('Positron - Connections Service', () => {

	const disposables = ensureNoLeakedDisposables();
	let instantiationService: TestInstantiationService;
	let secretStorageService: TestSecretStorageService;
	let connectionsService: IPositronConnectionsService;

	beforeEach(async () => {
		instantiationService = new TestInstantiationService();
		createRuntimeServices(instantiationService, disposables);

		secretStorageService = new TestSecretStorageService();
		instantiationService.stub(ISecretStorageService, secretStorageService);

		connectionsService = disposables.add(instantiationService.createInstance(
			PositronConnectionsService
		));
	});

	afterEach(() => {
		sinon.restore();
	});

	async function createSession() {
		const session = await startTestLanguageRuntimeSession(instantiationService, disposables);
		return session;
	}

	async function waitUntilOk(fn: () => void, timeout = 2000, interval = 10) {
		const start = Date.now();
		while (true) {
			try {
				fn();
				return;
			} catch (e) {
				if (Date.now() - start > timeout) { throw new Error('Timeout waiting for condition'); }
				await new Promise(r => setTimeout(r, interval));
			}
		}
	}

	it('Add a connection', async () => {
		const changeConnectionsSpy = sinon.spy();
		disposables.add(connectionsService.onDidChangeConnections(changeConnectionsSpy));

		const connectionId = 'test-connection-1';
		const connectionInstance = disposables.add(new TestConnectionInstance(connectionId));

		connectionsService.addConnection(connectionInstance);
		expect(connectionsService.getConnections().length).toBe(1);
		expect(changeConnectionsSpy.callCount).toBe(1);

		connectionsService.closeConnection('test-connection-1');
		expect(changeConnectionsSpy.callCount).toBe(2);
		expect(connectionInstance.disconnectFired).toBe(1);
		expect(connectionInstance.active).toBe(false);
		expect(connectionsService.getConnections().length).toBe(1);

		connectionsService.clearAllConnections();
		expect(changeConnectionsSpy.callCount).toBe(3); // the event fires once per connection
		expect(connectionsService.getConnections().length).toBe(0);
	});

	it('Sessions created by runtimes', async () => {
		const changeConnectionsSpy = sinon.spy();
		disposables.add(connectionsService.onDidChangeConnections(changeConnectionsSpy));

		const session = disposables.add(await createSession());

		const client = disposables.add(await session.createClient(RuntimeClientType.Connection, {
			name: 'test-connection',
			language_id: 'test',
			code: 'hello world'
		}));

		client.rpcHandler = async (request: any) => {
			if (request.method === "list_objects") {
				return {
					'data': {
						'result': [{
							'name': 'table1', 'kind': 'table'
						}]
					}
				};
			} else if (request.method === 'contains_data') {
				return {
					'data': {
						'result': true
					}
				};
			} else {
				throw new Error(`Unknown method: ${request.method}`);
			}
		};

		// When the client is created, a series of events are fired triggering the creation
		// of a connection instance.
		// It may take some time though, so we wait for it to complete.
		await waitUntilOk(() => {
			expect(changeConnectionsSpy.callCount).toBe(1);
			expect(connectionsService.getConnections().length).toBe(1);
		});

		const instance = connectionsService.getConnections()[0];
		expect(instance.metadata.name).toBe('test-connection');
		const instanceEntriesChangedSpy = sinon.spy();
		disposables.add(instance.onDidChangeEntries(instanceEntriesChangedSpy));

		// Toggle expansion should trigger the connections service
		// entries to change
		instance.onToggleExpandEmitter.fire('test-connection');
		await waitUntilOk(() => {
			expect(instanceEntriesChangedSpy.callCount).toBe(1);
		});
	});

	describe('Driver Manager', () => {
		function createTestDriver(id: string, name: string = 'Test Driver'): IDriver {
			return {
				driverId: id,
				metadata: {
					languageId: 'test',
					name,
					inputs: []
				}
			};
		}

		it('registerDriver fires onDidChangeDrivers', () => {
			const driverManager = connectionsService.driverManager;
			const changeDriversSpy = sinon.spy();
			disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			expect(changeDriversSpy.callCount).toBe(1);
			expect(driverManager.getDrivers().length).toBe(1);
		});

		it('removeDriver fires onDidChangeDrivers', () => {
			const driverManager = connectionsService.driverManager;
			const changeDriversSpy = sinon.spy();

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));
			driverManager.removeDriver('driver-1');

			expect(changeDriversSpy.callCount).toBe(1);
			expect(driverManager.getDrivers().length).toBe(0);
		});

		it('removeDriver at index 0 works correctly', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1');
			const driver2 = createTestDriver('driver-2');
			driverManager.registerDriver(driver1);
			driverManager.registerDriver(driver2);

			expect(driverManager.getDrivers().length).toBe(2);

			// Remove the first driver (index 0)
			driverManager.removeDriver('driver-1');

			expect(driverManager.getDrivers().length).toBe(1);
			expect(driverManager.getDrivers()[0].driverId).toBe('driver-2');
		});

		it('registerDriver replaces existing driver with same id', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1', 'Original');
			const driver1Updated = createTestDriver('driver-1', 'Updated');

			driverManager.registerDriver(driver1);
			expect(driverManager.getDrivers()[0].metadata.name).toBe('Original');

			driverManager.registerDriver(driver1Updated);
			expect(driverManager.getDrivers().length).toBe(1);
			expect(driverManager.getDrivers()[0].metadata.name).toBe('Updated');
		});

		it('registerDriver replaces driver at index 0', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1', 'Original');
			driverManager.registerDriver(driver1);

			const driver1Updated = createTestDriver('driver-1', 'Updated');
			driverManager.registerDriver(driver1Updated);

			expect(driverManager.getDrivers().length).toBe(1);
			expect(driverManager.getDrivers()[0].metadata.name).toBe('Updated');
		});
	});
});
