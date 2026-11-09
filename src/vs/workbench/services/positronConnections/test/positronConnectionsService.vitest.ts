/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { PositronConnectionsService } from '../browser/positronConnectionsService.js';
import { IPositronConnectionsService } from '../common/interfaces/positronConnectionsService.js';
import { IDriver } from '../common/interfaces/positronConnectionsDriver.js';
import { TestConnectionInstance } from './positronConnectionInstanceMock.js';
import { TestSecretStorageService } from '../../../../platform/secrets/test/common/testSecretStorageService.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { createLightTestContainer } from '../../../../test/vitest/lightTestContainer.js';
import { createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from '../../runtimeSession/test/common/testRuntimeSessionService.js';
import { IRuntimeClientOutput, RuntimeClientState, RuntimeClientType } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { TestRuntimeClientInstance } from '../../languageRuntime/test/common/testRuntimeClientInstance.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { ServiceCollection } from '../../../../platform/instantiation/common/serviceCollection.js';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, RuntimeExitReason } from '../../languageRuntime/common/languageRuntimeService.js';
import { generateUuid } from '../../../../base/common/uuid.js';
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

	/** A session whose runtime reports the given language, such as 'r'. */
	async function createSessionInLanguage(languageId: string) {
		const base = createTestLanguageRuntimeMetadata(ctx.instantiationService, ctx.disposables);
		const runtime: ILanguageRuntimeMetadata = { ...base, languageId, runtimeId: generateUuid() };
		ctx.disposables.add(ctx.instantiationService.get(ILanguageRuntimeService).registerRuntime(runtime));
		return startTestLanguageRuntimeSession(ctx.instantiationService, ctx.disposables, { runtime });
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
			language_id: 'ggsql',
			code: 'hello world'
		}));

		expect(disposeSpy.mock.contexts).toContain(client);
		expect(dataConnectionsModeService.getConnections()).toEqual([]);
	});

	describe('with Data Connections enabled, R and Python comms', () => {
		// Closing one of these comms runs the user's disconnect() in the kernel, so the object the
		// user's code just opened would be invalid a moment later.
		function createDataConnectionsModeService() {
			const instantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
				[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })]
			)));
			return ctx.disposables.add(instantiationService.createInstance(PositronConnectionsService));
		}

		const metadataIn = (languageId: string) => ({
			name: 'mtcars.sqlite',
			language_id: languageId,
			host: 'localhost',
			code: 'con <- dbConnect(RSQLite::SQLite(), "mtcars.sqlite")',
		});

		async function openComm(languageId: string) {
			const service = createDataConnectionsModeService();
			const disposeSpy = vi.spyOn(TestRuntimeClientInstance.prototype, 'dispose');
			const session = ctx.disposables.add(await createSession());
			const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, metadataIn(languageId)));
			return {
				disposed: disposeSpy.mock.contexts.includes(client),
				code: service.getSessionConnectionCode(session.sessionId),
			};
		}

		it('keeps an R comm open', async () => {
			expect(await openComm('r')).toEqual({ disposed: false, code: metadataIn('r').code });
		});

		it('keeps a Python comm open', async () => {
			expect(await openComm('python')).toEqual({ disposed: false, code: metadataIn('python').code });
		});

		// Closing a comm can run disconnect() in the kernel, so only languages known to be safe are closed.
		it('keeps a comm in a language not known to be safe to close', async () => {
			expect(await openComm('julia')).toEqual({ disposed: false, code: metadataIn('julia').code });
		});

		it('still closes ggsql comms', async () => {
			expect(await openComm('ggsql')).toEqual({ disposed: true, code: metadataIn('ggsql').code });
		});

		// The same rule as a startup comm whose metadata never arrives.
		it('judges a comm that names no language by its session\'s language', async () => {
			createDataConnectionsModeService();
			const disposeSpy = vi.spyOn(TestRuntimeClientInstance.prototype, 'dispose');
			const openUnnamed = async (sessionLanguage: string) => {
				const session = ctx.disposables.add(await createSessionInLanguage(sessionLanguage));
				const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, { name: 'mtcars.sqlite' }));
				return disposeSpy.mock.contexts.includes(client);
			};

			expect({ r: await openUnnamed('r'), ggsql: await openUnnamed('ggsql'), test: await openUnnamed('test') })
				.toEqual({ r: false, ggsql: true, test: false });
		});
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
				const session = ctx.disposables.add(await createSessionInLanguage('ggsql'));
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

			it('keeps an R comm already open at startup', async () => {
				const metadata = { name: 'mtcars.sqlite', language_id: 'r', code: 'con <- dbConnect(RSQLite::SQLite(), "mtcars.sqlite")' };
				const session = ctx.disposables.add(await createSession());
				const { client, reply } = await openStartupComm(session, metadata);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();

				onDidStartRuntime.fire(session);
				reply.complete();
				await waitUntilOk(() => expect(service.getSessionConnectionCode(session.sessionId)).toBe(metadata.code));
				const disposedWhileOpen = disposeSpy.mock.calls.length > 0;
				// Once the runtime closes the comm, the wrapper read for its metadata is released.
				client.setClientState(RuntimeClientState.Closed);

				expect({ disposedWhileOpen, disposedOnClose: disposeSpy.mock.calls.length > 0 })
					.toEqual({ disposedWhileOpen: false, disposedOnClose: true });
			});

			// Ark answers get_metadata only when R is idle, so a window reloaded during a long
			// computation sees every R comm time out.
			it('keeps an R session\'s startup comm that never answers', async () => {
				const session = ctx.disposables.add(await createSessionInLanguage('r'));
				const { client } = await openStartupComm(session);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();
				vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
				try {
					onDidStartRuntime.fire(session);
					await vi.advanceTimersByTimeAsync(5000);

					const disposedWhileOpen = disposeSpy.mock.calls.length > 0;
					client.setClientState(RuntimeClientState.Closed);

					expect({
						disposedWhileOpen,
						disposedOnClose: disposeSpy.mock.calls.length > 0,
						code: service.getSessionConnectionCode(session.sessionId),
					}).toEqual({ disposedWhileOpen: false, disposedOnClose: true, code: undefined });
				} finally {
					vi.useRealTimers();
				}
			});

			// The close event has already fired by the time the comm is kept, so waiting for it
			// would hold the wrapper forever.
			it('releases a kept startup comm that closed while its metadata was pending', async () => {
				const metadata = { name: 'mtcars.sqlite', language_id: 'r', code: 'con <- dbConnect(RSQLite::SQLite(), "mtcars.sqlite")' };
				const session = ctx.disposables.add(await createSession());
				const client = await session.createClient(RuntimeClientType.Connection, metadata);
				const requested = new DeferredPromise<void>();
				const reply = new DeferredPromise<void>();
				client.rpcHandler = async (): Promise<IRuntimeClientOutput<unknown>> => {
					requested.complete();
					await reply.p;
					return { data: { result: metadata } };
				};
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();

				onDidStartRuntime.fire(session);
				// Close only once the metadata request is in flight, so the wrapper exists and is
				// waiting on its reply when the close fires.
				await requested.p;
				client.setClientState(RuntimeClientState.Closed);
				reply.complete();

				await waitUntilOk(() => expect(service.getSessionConnectionCode(session.sessionId)).toBe(metadata.code));
				await waitUntilOk(() => expect(disposeSpy).toHaveBeenCalled());
			});

			it('keeps an R session\'s startup comm whose metadata read fails', async () => {
				const session = ctx.disposables.add(await createSessionInLanguage('r'));
				const client = await session.createClient(RuntimeClientType.Connection, memory);
				client.rpcHandler = async () => { throw new Error('connection_metadata failed'); };
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { service, onDidStartRuntime } = createServiceWatchingStarts();
				const logged = vi.spyOn(service.logService, 'error');

				onDidStartRuntime.fire(session);
				await waitUntilOk(() => expect(logged).toHaveBeenCalled());
				const disposedWhileOpen = disposeSpy.mock.calls.length > 0;
				client.setClientState(RuntimeClientState.Closed);

				expect({ disposedWhileOpen, disposedOnClose: disposeSpy.mock.calls.length > 0 })
					.toEqual({ disposedWhileOpen: false, disposedOnClose: true });
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
