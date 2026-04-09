/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { PositronConnectionsService } from '../browser/positronConnectionsService.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';
import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { TestConnectionInstance } from './positronConnectionInstanceMock.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { createRuntimeServices, startTestLanguageRuntimeSession } from '../../runtimeSession/test/common/testRuntimeSessionService.js';
import { RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';


suite('Positron - Connections Service', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let instantiationService: TestInstantiationService;
	let secretStorageService: TestSecretStorageService;
	let connectionsService: IPositronConnectionsService;

	setup(async () => {
		instantiationService = new TestInstantiationService();
		createRuntimeServices(instantiationService, disposables);

		secretStorageService = new TestSecretStorageService();
		instantiationService.stub(ISecretStorageService, secretStorageService);

		connectionsService = disposables.add(instantiationService.createInstance(
			PositronConnectionsService
		));
	});

	teardown(() => {
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

	test('Add a connection', async () => {
		const changeConnectionsSpy = sinon.spy();
		disposables.add(connectionsService.onDidChangeConnections(changeConnectionsSpy));

		const connectionId = 'test-connection-1';
		const connectionInstance = disposables.add(new TestConnectionInstance(connectionId));

		connectionsService.addConnection(connectionInstance);
		assert.equal(connectionsService.getConnections().length, 1);
		assert.equal(changeConnectionsSpy.callCount, 1);

		connectionsService.closeConnection('test-connection-1');
		assert.equal(changeConnectionsSpy.callCount, 2);
		assert.equal(connectionInstance.disconnectFired, 1);
		assert.equal(connectionInstance.active, false);
		assert.equal(connectionsService.getConnections().length, 1);

		connectionsService.clearAllConnections();
		assert.equal(changeConnectionsSpy.callCount, 3); // the event fires once per connection
		assert.equal(connectionsService.getConnections().length, 0);
	});

	test('Sessions created by runtimes', async () => {
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
			assert.equal(changeConnectionsSpy.callCount, 1);
			assert.equal(connectionsService.getConnections().length, 1);
		});

		const instance = connectionsService.getConnections()[0];
		assert.equal(instance.metadata.name, 'test-connection');
		const instanceEntriesChangedSpy = sinon.spy();
		disposables.add(instance.onDidChangeEntries(instanceEntriesChangedSpy));

		// Toggle expansion should trigger the connections service
		// entries to change
		instance.onToggleExpandEmitter.fire('test-connection');
		await waitUntilOk(() => {
			assert.equal(instanceEntriesChangedSpy.callCount, 1);
		});
	});

	suite('Driver Manager', () => {
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

		test('registerDriver fires onDidChangeDrivers', () => {
			const driverManager = connectionsService.driverManager;
			const changeDriversSpy = sinon.spy();
			disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			assert.equal(changeDriversSpy.callCount, 1);
			assert.equal(driverManager.getDrivers().length, 1);
		});

		test('removeDriver fires onDidChangeDrivers', () => {
			const driverManager = connectionsService.driverManager;
			const changeDriversSpy = sinon.spy();

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));
			driverManager.removeDriver('driver-1');

			assert.equal(changeDriversSpy.callCount, 1);
			assert.equal(driverManager.getDrivers().length, 0);
		});

		test('removeDriver at index 0 works correctly', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1');
			const driver2 = createTestDriver('driver-2');
			driverManager.registerDriver(driver1);
			driverManager.registerDriver(driver2);

			assert.equal(driverManager.getDrivers().length, 2);

			// Remove the first driver (index 0)
			driverManager.removeDriver('driver-1');

			assert.equal(driverManager.getDrivers().length, 1);
			assert.equal(driverManager.getDrivers()[0].driverId, 'driver-2');
		});

		test('registerDriver replaces existing driver with same id', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1', 'Original');
			const driver1Updated = createTestDriver('driver-1', 'Updated');

			driverManager.registerDriver(driver1);
			assert.equal(driverManager.getDrivers()[0].metadata.name, 'Original');

			driverManager.registerDriver(driver1Updated);
			assert.equal(driverManager.getDrivers().length, 1);
			assert.equal(driverManager.getDrivers()[0].metadata.name, 'Updated');
		});

		test('registerDriver replaces driver at index 0', () => {
			const driverManager = connectionsService.driverManager;

			const driver1 = createTestDriver('driver-1', 'Original');
			driverManager.registerDriver(driver1);

			const driver1Updated = createTestDriver('driver-1', 'Updated');
			driverManager.registerDriver(driver1Updated);

			assert.equal(driverManager.getDrivers().length, 1);
			assert.equal(driverManager.getDrivers()[0].metadata.name, 'Updated');
		});
	});
});
