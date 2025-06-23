/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { TestInstantiationService } from '../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { PositronConnectionsService } from '../browser/positronConnectionsService.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';
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
				if (Date.now() - start > timeout) throw new Error('Timeout waiting for condition');
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
				}
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
});
