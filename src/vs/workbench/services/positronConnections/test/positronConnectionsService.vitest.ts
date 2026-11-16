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
import { ConnectionsClientInstance } from '../../languageRuntime/common/languageRuntimeConnectionsClient.js';
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
import { IViewsService } from '../../views/common/viewsService.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IEditorCloseEvent } from '../../../common/editor.js';
import { IPositronDataConnectionsService, POSITRON_DATA_CONNECTIONS_VIEW_ID } from '../../positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { discoveredProfileId, PositronDataConnectionsService } from '../../positronDataConnections/browser/positronDataConnectionsService.js';
import { isRuntimeDataConnectionDriverId } from '../common/runtimeDataConnections.js';
import { RuntimeDataConnectionDriver } from '../browser/runtimeDataConnectionDriver.js';


describe('Positron - Connections Service', () => {

	// Fires when an editor closes, which is when the Data Connections service closes connections
	// waiting on their last Data Explorer.
	const onDidCloseEditor = new Emitter<IEditorCloseEvent>();

	const ctx = createLightTestContainer()
		.withRuntimeServices()
		.stub(ISecretStorageService, new TestSecretStorageService())
		// The service only handles runtime connections when Data Connections is off.
		.stub(IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': false }))
		.stub(IViewsService, { openView: async () => null })
		.stub(IEditorService, {
			onDidCloseEditor: onDidCloseEditor.event,
			findEditors: () => [],
			closeEditors: async () => { },
		})
		.build();
	let connectionsService: IPositronConnectionsService;

	// Records every client a test session opens, so teardown can close them. Registered after
	// build(), so its afterEach runs before the leak check's.
	const spyOnOpenedClients = () => vi.spyOn(TestLanguageRuntimeSession.prototype, 'receiveClientCreatedMessage');
	let openedClients: ReturnType<typeof spyOnOpenedClients>;
	beforeEach(() => {
		openedClients = spyOnOpenedClients();
	});

	// A session closes its comms when it ends, and a kept comm's wrapper is released when its comm
	// closes. Test sessions do neither, so the comms are closed here. Tests make their own
	// assertions about closing before this runs.
	afterEach(() => {
		for (const [client] of openedClients.mock.calls) {
			client.setClientState(RuntimeClientState.Closed);
		}
	});

	beforeEach(async () => {
		// The real Data Connections service, which runtime connections are shown in.
		ctx.instantiationService.stub(IPositronDataConnectionsService, ctx.disposables.add(
			ctx.instantiationService.createInstance(PositronDataConnectionsService)
		));
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

		describe('shown in Data Connections', () => {
			const dataConnections = () => ctx.get(IPositronDataConnectionsService);
			const runtimeProfiles = () => dataConnections().getDiscoveredProfiles()
				.filter(profile => isRuntimeDataConnectionDriverId(profile.driverMetadata.id));

			function focusEvent(): IRuntimeClientOutput<unknown> {
				return { data: { method: 'focus', params: {} }, buffers: [] };
			}

			/** Opens a comm and returns it with the id of the row it should become. */
			async function openRuntimeComm(languageId = 'r') {
				const service = createDataConnectionsModeService();
				const session = ctx.disposables.add(await createSession());
				const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, metadataIn(languageId)));
				const disposeSpy = vi.spyOn(client, 'dispose');
				const profileId = discoveredProfileId(`runtime-${languageId}`, `${session.sessionId}:${client.getClientId()}`);
				return { service, session, client, disposeSpy, profileId };
			}

			/** Opens a comm and waits for its row to connect. */
			async function openConnectedRow(languageId = 'r') {
				const opened = await openRuntimeComm(languageId);
				await vi.waitFor(() => expect(dataConnections().getInstanceForProfile(opened.profileId)).toBeDefined());
				return opened;
			}

			/** Waits until no runtime row is discovered or connected. */
			async function waitForNoRuntimeRows() {
				await vi.waitFor(() => expect({
					discovered: runtimeProfiles().length,
					connected: dataConnections().getInstances().length,
				}).toEqual({ discovered: 0, connected: 0 }));
			}

			it('shows a kept R comm as a connected row', async () => {
				const { disposeSpy, profileId } = await openConnectedRow('r');

				expect({
					rows: runtimeProfiles().map(profile => [profile.id, profile.driverMetadata.id, profile.connectionName]),
					disposed: disposeSpy.mock.calls.length,
				}).toEqual({
					rows: [[profileId, 'runtime-r', 'mtcars.sqlite']],
					disposed: 0,
				});
			});

			// Disconnect closes the comm, which removes the discovery; nothing may reopen it.
			it('does not reconnect after the user disconnects', async () => {
				const connectSpy = vi.spyOn(RuntimeDataConnectionDriver.prototype, 'connect');
				const { disposeSpy, profileId } = await openConnectedRow('r');

				await dataConnections().disconnect(profileId);
				await waitForNoRuntimeRows();

				expect({
					disposed: disposeSpy.mock.calls.length,
					connects: connectSpy.mock.calls.length,
					connected: dataConnections().getInstanceForProfile(profileId) !== undefined,
				}).toEqual({ disposed: 1, connects: 1, connected: false });
			});

			// Disconnect disposes the wrapper, and the comm's close must still reach the service's
			// release listener, which disposes the wrapper a second time as it lets it go.
			it('releases the wrapper when the user disconnects', async () => {
				const { client, profileId } = await openConnectedRow('r');
				// The real client reports Closed while it is disposed; the test client does not.
				ctx.disposables.add(client.onDidDispose(() => client.setClientState(RuntimeClientState.Closed)));
				const wrapperDispose = vi.spyOn(ConnectionsClientInstance.prototype, 'dispose');

				await dataConnections().disconnect(profileId);

				expect(wrapperDispose).toHaveBeenCalledTimes(2);
			});

			// A comm that opens between subscribing and listing arrives on both paths.
			it('a comm seen on both paths makes one row', async () => {
				const session = ctx.disposables.add(await createSession());
				const listed = new DeferredPromise<void>();
				const listClients = session.listClients.bind(session);
				vi.spyOn(session, 'listClients').mockImplementation(async type => {
					await listed.p;
					return listClients(type);
				});
				const onDidStartRuntime = ctx.disposables.add(new Emitter<ILanguageRuntimeSession>());
				const instantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
					[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })],
					[IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
						onDidStartRuntime: onDidStartRuntime.event,
						onDidDeleteRuntimeSession: Event.None,
					})],
				)));
				ctx.disposables.add(instantiationService.createInstance(PositronConnectionsService));

				onDidStartRuntime.fire(session);
				const client = ctx.disposables.add(await session.createClient(RuntimeClientType.Connection, metadataIn('r')));
				client.rpcHandler = async () => ({ data: { result: metadataIn('r') } });
				const disposeSpy = vi.spyOn(client, 'dispose');
				listed.complete();
				const profileId = discoveredProfileId('runtime-r', `${session.sessionId}:${client.getClientId()}`);
				await vi.waitFor(() => expect(dataConnections().getInstanceForProfile(profileId)).toBeDefined());
				// Let the startup path finish with the same comm.
				await vi.waitFor(() => expect(vi.mocked(session.listClients)).toHaveReturned());
				await new Promise(resolve => setTimeout(resolve, 20));

				expect({
					rows: runtimeProfiles().map(profile => profile.id),
					instances: dataConnections().getInstances().map(instance => instance.profileId),
					disposed: disposeSpy.mock.calls.length,
				}).toEqual({ rows: [profileId], instances: [profileId], disposed: 0 });
			});

			// The startup path is waiting on metadata when the same comm arrives as new, so the
			// driver keeps the new path's wrapper. The startup wrapper must still be released.
			it('releases the startup wrapper of a comm that also arrived as new', async () => {
				const session = ctx.disposables.add(await createSession());
				const client = ctx.disposables.add(new TestRuntimeClientInstance('connection-1', RuntimeClientType.Connection));
				client.setClientState(RuntimeClientState.Connected);
				session.receiveClientCreatedMessage(client, { data: metadataIn('r') });
				const metadataAnswered = new DeferredPromise<void>();
				const metadataAsked = new DeferredPromise<void>();
				client.rpcHandler = async () => {
					metadataAsked.complete();
					await metadataAnswered.p;
					return { data: { result: metadataIn('r') } };
				};
				const onDidStartRuntime = ctx.disposables.add(new Emitter<ILanguageRuntimeSession>());
				const instantiationService = ctx.disposables.add(ctx.instantiationService.createChild(new ServiceCollection(
					[IConfigurationService, new TestConfigurationService({ 'dataConnections.enabled': true })],
					[IRuntimeSessionService, stubInterface<IRuntimeSessionService>({
						onDidStartRuntime: onDidStartRuntime.event,
						onDidDeleteRuntimeSession: Event.None,
					})],
				)));
				ctx.disposables.add(instantiationService.createInstance(PositronConnectionsService));
				const wrapperDispose = vi.spyOn(ConnectionsClientInstance.prototype, 'dispose');

				onDidStartRuntime.fire(session);
				await metadataAsked.p;
				session.receiveClientCreatedMessage(client, { data: metadataIn('r') });
				metadataAnswered.complete();
				await new Promise(resolve => setTimeout(resolve, 20));
				expect(wrapperDispose).not.toHaveBeenCalled();

				client.setClientState(RuntimeClientState.Closed);

				expect(wrapperDispose).toHaveBeenCalledTimes(2);
			});

			it('removes the row when the session ends', async () => {
				const { session } = await openConnectedRow('r');

				await session.shutdown(RuntimeExitReason.Shutdown);

				await waitForNoRuntimeRows();
			});

			it('reveals a row whose focus arrived before it connected', async () => {
				const openView = vi.spyOn(ctx.get(IViewsService), 'openView');
				const revealConnection = vi.spyOn(dataConnections(), 'revealConnection');
				const order: string[] = [];
				// The legacy-mode service the top-level beforeEach creates opens its own view on focus.
				openView.mockImplementation(async id => {
					if (id === POSITRON_DATA_CONNECTIONS_VIEW_ID) {
						order.push('openView');
					}
					return null;
				});
				revealConnection.mockImplementation(profileId => {
					order.push(dataConnections().getInstanceForProfile(profileId) ? 'reveal connected' : 'reveal unconnected');
				});

				// The connect is held until after the focus, so the focus takes the pending path.
				const connectHeld = new DeferredPromise<void>();
				const realConnect = RuntimeDataConnectionDriver.prototype.connect;
				const connectSpy = vi.spyOn(RuntimeDataConnectionDriver.prototype, 'connect').mockImplementation(async function (this: RuntimeDataConnectionDriver, mechanismId, params) {
					await connectHeld.p;
					return realConnect.call(this, mechanismId, params);
				});

				const { client, profileId } = await openRuntimeComm('r');
				await vi.waitFor(() => expect(connectSpy).toHaveBeenCalled());
				expect(dataConnections().getInstanceForProfile(profileId)).toBeUndefined();
				client.receiveData(focusEvent());
				connectHeld.complete();

				await vi.waitFor(() => expect(revealConnection).toHaveBeenCalled());
				// Neither the view nor the row takes focus from the Console the user is typing in.
				expect({
					order,
					views: openView.mock.calls.filter(([id]) => id === POSITRON_DATA_CONNECTIONS_VIEW_ID),
					revealed: revealConnection.mock.calls,
				}).toEqual({
					order: ['openView', 'reveal connected'],
					views: [[POSITRON_DATA_CONNECTIONS_VIEW_ID, false]],
					revealed: [[profileId, { preserveFocus: true }]],
				});
			});

			it('reveals a connected row on a later focus event', async () => {
				const revealConnection = vi.spyOn(dataConnections(), 'revealConnection');
				const { client, profileId } = await openConnectedRow('r');
				client.receiveData(focusEvent());
				await vi.waitFor(() => expect(revealConnection).toHaveBeenCalledTimes(1));

				client.receiveData(focusEvent());

				await vi.waitFor(() => expect(revealConnection.mock.calls).toEqual([
					[profileId, { preserveFocus: true }],
					[profileId, { preserveFocus: true }],
				]));
			});

			// Real Python sends focus whenever the pane should show; the reveal follows the event.
			it('does not reveal a row on open without a focus event', async () => {
				const revealConnection = vi.spyOn(dataConnections(), 'revealConnection');

				await openConnectedRow('python');
				await new Promise(resolve => setTimeout(resolve, 20));

				expect(revealConnection).not.toHaveBeenCalled();
			});

			// Ark sends update after a change such as DBI::dbWriteTable, so the row's loaded
			// subtree is re-fetched.
			it('refreshes the row on an update event', async () => {
				const requestRefresh = vi.spyOn(dataConnections(), 'requestRefresh');
				const { client, profileId } = await openConnectedRow('r');

				client.receiveData({ data: { method: 'update', params: {} }, buffers: [] });

				await vi.waitFor(() => expect(requestRefresh.mock.calls).toEqual([[profileId]]));
			});

			// Collapsing a row calls disconnectWhenUnused; for a runtime row that would run the
			// user's disconnect() in R.
			it('disconnectWhenUnused leaves a runtime profile connected', async () => {
				const { disposeSpy, profileId } = await openConnectedRow('r');

				dataConnections().disconnectWhenUnused(profileId);
				onDidCloseEditor.fire(stubInterface<IEditorCloseEvent>({}));
				await new Promise(resolve => setTimeout(resolve, 20));

				expect({
					connected: dataConnections().getInstanceForProfile(profileId) !== undefined,
					disposed: disposeSpy.mock.calls.length,
				}).toEqual({ connected: true, disposed: 0 });
			});
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

			it('adopts an R comm already open at startup', async () => {
				const metadata = { name: 'mtcars.sqlite', language_id: 'r', code: 'con <- dbConnect(RSQLite::SQLite(), "mtcars.sqlite")' };
				const session = ctx.disposables.add(await createSession());
				const { client, reply } = await openStartupComm(session, metadata);
				const disposeSpy = vi.spyOn(client, 'dispose');
				const { onDidStartRuntime } = createServiceWatchingStarts();
				const dataConnections = ctx.get(IPositronDataConnectionsService);
				const profileId = discoveredProfileId('runtime-r', `${session.sessionId}:${client.getClientId()}`);

				onDidStartRuntime.fire(session);
				reply.complete();

				await vi.waitFor(() => expect(dataConnections.getInstanceForProfile(profileId)).toBeDefined());
				expect({
					name: dataConnections.getProfile(profileId)?.connectionName,
					disposed: disposeSpy.mock.calls.length,
				}).toEqual({ name: 'mtcars.sqlite', disposed: 0 });
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
