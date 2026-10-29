/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { PositronConnectionsService } from '../browser/positronConnectionsService.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';
import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { TestConnectionInstance } from './positronConnectionInstanceMock.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { createLightTestContainer } from '../../../../test/vitest/lightTestContainer.js';
import { startTestLanguageRuntimeSession } from '../../runtimeSession/test/common/testRuntimeSessionService.js';
import { IRuntimeClientOutput, RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { TestRuntimeClientInstance } from '../../languageRuntime/test/common/testRuntimeClientInstance.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { RuntimeExitReason } from '../../languageRuntime/common/languageRuntimeService.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { DeferredPromise } from '../../../../base/common/async.js';
import { stubInterface } from '../../../../test/vitest/stubInterface.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../runtimeSession/common/runtimeSessionService.js';
import { TestLanguageRuntimeSession } from '../../runtimeSession/test/common/testLanguageRuntimeSession.js';


describe('Positron - Connections Service', () => {

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(ISecretStorageService, new TestSecretStorageService())
		// The service only handles runtime connections when Data Connections is off.
		.stub(IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': false }))
		.build();
	let connectionsService: IPositronConnectionsService;

	beforeEach(async () => {
		connectionsService = ctx.disposables.add(ctx.instantiationService.createInstance(
			PositronConnectionsService
		));
	});

	async function createSession() {
		const session = await startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables);
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
		const changeConnectionsSpy = vi.fn();
		ctx.disposables.add(connectionsService.onDidChangeConnections(changeConnectionsSpy));

		const connectionId = 'test-connection-1';
		const connectionInstance = ctx.disposables.add(new TestConnectionInstance(connectionId));

		connectionsService.addConnection(connectionInstance);
		expect(connectionsService.getConnections().length).toBe(1);
		expect(changeConnectionsSpy).toHaveBeenCalledTimes(1);

		connectionsService.closeConnection('test-connection-1');
		expect(changeConnectionsSpy).toHaveBeenCalledTimes(2);
		expect(connectionInstance.disconnectFired).toBe(1);
		expect(connectionInstance.active).toBe(false);
		expect(connectionsService.getConnections().length).toBe(1);

		connectionsService.clearAllConnections();
		expect(changeConnectionsSpy).toHaveBeenCalledTimes(3); // the event fires once per connection
		expect(connectionsService.getConnections().length).toBe(0);
	});

	it('Sessions created by runtimes', async () => {
		const changeConnectionsSpy = vi.fn();
		ctx.disposables.add(connectionsService.onDidChangeConnections(changeConnectionsSpy));

		const session = ctx.disposables.add(await createSession());

		const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, {
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
			expect(changeConnectionsSpy).toHaveBeenCalledTimes(1);
			expect(connectionsService.getConnections().length).toBe(1);
		});

		const instance = connectionsService.getConnections()[0];
		expect(instance.metadata.name).toBe('test-connection');
		const instanceEntriesChangedSpy = vi.fn();
		ctx.disposables.add(instance.onDidChangeEntries(instanceEntriesChangedSpy));

		// Toggle expansion should trigger the connections service
		// entries to change
		instance.onToggleExpandEmitter.fire('test-connection');
		await waitUntilOk(() => {
			expect(instanceEntriesChangedSpy).toHaveBeenCalledTimes(1);
		});
	});

	it('Closes runtime connections when Data Connections is enabled', async () => {
		const dataConnectionsInstantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
			[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })]
		)));
		const dataConnectionsModeService = ctx.disposables.add(dataConnectionsInstantiationService.createInstance(
			PositronConnectionsService
		));
		const disposeSpy = vi.spyOn(TestRuntimeClientInstance.prototype, 'dispose');

		const session = ctx.disposables.add(await createSession());
		const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, {
			name: 'test-connection',
			language_id: 'test',
			code: 'hello world'
		}));

		expect(disposeSpy.mock.contexts).toContain(client);
		expect(dataConnectionsModeService.getConnections()).toEqual([]);
	});

	describe('session connection code', () => {
		// The ggsql kernel opens a connection comm at startup, and again whenever it switches
		// database, with the meta-command that reaches the database as the comm's code.
		const memory = { name: 'memory', language_id: 'ggsql', code: '-- @connect: duckdb://memory' };
		const file = { name: 'shop.duckdb', language_id: 'ggsql', code: '-- @connect: duckdb:///data/shop.duckdb' };

		function createDataConnectionsModeService() {
			const instantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
				[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })]
			)));
			return ctx.disposables.add(instantiationService.createInstance(PositronConnectionsService));
		}

		it('follows the comms a session opens, and forgets them when it exits', async () => {
			const service = createDataConnectionsModeService();
			const changes = vi.fn();
			ctx.disposables.add(service.onDidChangeSessionConnectionCode(changes));
			const session = ctx.disposables.add(await createSession());

			await session.createClient(RuntimeClientType.Connection, memory);
			await session.createClient(RuntimeClientType.Connection, file);
			const whileRunning = service.getSessionConnectionCode(session.sessionId);
			session.endSession();

			expect({
				whileRunning,
				afterExit: service.getSessionConnectionCode(session.sessionId),
				changes: changes.mock.calls.map(([e]) => e.code),
			}).toEqual({
				whileRunning: file.code,
				afterExit: undefined,
				changes: [memory.code, file.code, undefined],
			});
		});

		it('follows a restarted session, whose new kernel opens comms without the session starting again', async () => {
			const service = createDataConnectionsModeService();
			const session = ctx.disposables.add(await createSession());
			await session.createClient(RuntimeClientType.Connection, file);

			session.endSession({ reason: RuntimeExitReason.Restart });
			await session.createClient(RuntimeClientType.Connection, memory);

			expect(service.getSessionConnectionCode(session.sessionId)).toBe(memory.code);
		});

		describe('a comm already open when the session starts', () => {
			/**
			 * A service told of a session's start by hand, so the session can have opened a comm
			 * before the service hears of it.
			 */
			function createServiceWatchingStarts() {
				const onDidStartRuntime = ctx.disposables.add(new Emitter<ILanguageRuntimeSession>());
				const instantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
					[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })],
					[IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
						onDidStartRuntime: onDidStartRuntime.event,
						onDidDeleteRuntimeSession: Event.None,
					})],
				)));
				const service = ctx.disposables.add(instantiationService.createInstance(PositronConnectionsService));
				return { service, onDidStartRuntime };
			}

			/** A startup comm whose metadata reply is held until the test releases it. */
			async function openStartupComm(session: TestLanguageRuntimeSession, metadata = memory) {
				const reply = new DeferredPromise<void>();
				const client = await session.createClient(RuntimeClientType.Connection, metadata);
				client.rpcHandler = async (): Promise<IRuntimeClientOutput<unknown>> => {
					await reply.p;
					return { data: { result: metadata } };
				};
				return { client, reply };
			}

			it('is recorded when it is the only one', async () => {
				const session = ctx.disposables.add(await createSession());
				const { client, reply } = await openStartupComm(session);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();

				onDidStartRuntime.fire(session);
				reply.complete();
				await waitUntilOk(() => expect(disposeSpy).toHaveBeenCalled());

				expect(service.getSessionConnectionCode(session.sessionId)).toBe(memory.code);
			});

			it('is not recorded when another is open too, since which is current is unknown', async () => {
				const session = ctx.disposables.add(await createSession());
				const first = await openStartupComm(session, memory);
				const second = await openStartupComm(session, file);
				const disposeSpies = [vi.spyOn(first.client, 'dispose'), vi.spyOn(second.client, 'dispose')];
				const { service, onDidStartRuntime } = createServiceWatchingStarts();

				onDidStartRuntime.fire(session);
				first.reply.complete();
				second.reply.complete();
				await waitUntilOk(() => disposeSpies.forEach(spy => expect(spy).toHaveBeenCalled()));

				expect(service.getSessionConnectionCode(session.sessionId)).toBeUndefined();
			});

			it('does not replace a comm opened after it, when its reply arrives late', async () => {
				const session = ctx.disposables.add(await createSession());
				const { client, reply } = await openStartupComm(session);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();

				onDidStartRuntime.fire(session);
				await session.createClient(RuntimeClientType.Connection, file);
				reply.complete();
				await waitUntilOk(() => expect(disposeSpy).toHaveBeenCalled());

				expect(service.getSessionConnectionCode(session.sessionId)).toBe(file.code);
			});

			it('is closed even when it never answers', async () => {
				const session = ctx.disposables.add(await createSession());
				const { client } = await openStartupComm(session);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { onDidStartRuntime } = createServiceWatchingStarts();
				vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
				try {
					onDidStartRuntime.fire(session);
					await vi.advanceTimersByTimeAsync(5000);

					expect(disposeSpy).toHaveBeenCalled();
				} finally {
					vi.useRealTimers();
				}
			});
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
			const changeDriversSpy = vi.fn();
			ctx.disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			expect(changeDriversSpy).toHaveBeenCalledTimes(1);
			expect(driverManager.getDrivers().length).toBe(1);
		});

		it('removeDriver fires onDidChangeDrivers', () => {
			const driverManager = connectionsService.driverManager;
			const changeDriversSpy = vi.fn();

			const driver = createTestDriver('driver-1');
			driverManager.registerDriver(driver);

			ctx.disposables.add(driverManager.onDidChangeDrivers(changeDriversSpy));
			driverManager.removeDriver('driver-1');

			expect(changeDriversSpy).toHaveBeenCalledTimes(1);
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
