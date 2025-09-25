/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { formatLanguageRuntimeMetadata, formatLanguageRuntimeSession, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeClientType, RuntimeStartMode } from '../../common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from './testLanguageRuntimeSession.js';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from './testRuntimeSessionService.js';
import { TestRuntimeSessionManager } from '../../../../test/common/positronWorkbenchTestServices.js';
import { TestWorkspaceTrustManagementService } from '../../../../test/common/workbenchTestServices.js';
import { IConfigurationResolverService } from '../../../configurationResolver/common/configurationResolver.js';
import { NotebookSetting } from '../../../../contrib/notebook/common/notebookCommon.js';

type IStartSessionTask = (runtime: ILanguageRuntimeMetadata) => Promise<TestLanguageRuntimeSession>;

suite('Positron - RuntimeSessionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const startReason = 'Test requested to start a runtime session';
	const notebookUri = URI.file('/path/to/notebook');
	const notebookParent = '/path/to';
	let instantiationService: TestInstantiationService;
	let languageRuntimeService: ILanguageRuntimeService;
	let runtimeSessionService: IRuntimeSessionService;
	let configService: TestConfigurationService;
	let workspaceTrustManagementService: TestWorkspaceTrustManagementService;
	let configurationResolverService: IConfigurationResolverService;
	let manager: TestRuntimeSessionManager;
	let runtime: ILanguageRuntimeMetadata;
	let anotherRuntime: ILanguageRuntimeMetadata;
	let sessionName: string;
	let unregisteredRuntime: ILanguageRuntimeMetadata;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		createRuntimeServices(instantiationService, disposables);
		languageRuntimeService = instantiationService.get(ILanguageRuntimeService);
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		configService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		workspaceTrustManagementService = instantiationService.get(IWorkspaceTrustManagementService) as TestWorkspaceTrustManagementService;
		configurationResolverService = instantiationService.get(IConfigurationResolverService);
		manager = TestRuntimeSessionManager.instance;

		// Dispose all sessions on teardown.
		// TODO: Should this happen in RuntimeSessionService.dispose() instead?
		disposables.add({
			dispose() {
				runtimeSessionService.activeSessions.forEach(session => session.dispose());
			}
		});

		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		sessionName = runtime.runtimeName;
		unregisteredRuntime = { runtimeId: 'unregistered-runtime-id' } as ILanguageRuntimeMetadata;

		// Enable automatic startup.
		configService.setUserConfiguration('interpreters.startupBehavior', LanguageStartupBehavior.Auto);

		// Trust the workspace.
		workspaceTrustManagementService.setWorkspaceTrust(true);
	});

	function startSession(
		runtime: ILanguageRuntimeMetadata,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri?: URI,
	) {
		return startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime,
				sessionName,
				startReason,
				sessionMode,
				notebookUri,
			},
		);
	}

	function startConsole(runtime: ILanguageRuntimeMetadata) {
		return startSession(runtime, LanguageRuntimeSessionMode.Console);
	}

	function startNotebook(runtime: ILanguageRuntimeMetadata, notebookUri_ = notebookUri) {
		return startSession(runtime, LanguageRuntimeSessionMode.Notebook, notebookUri_);
	}

	function assertActiveSessions(expected: ILanguageRuntimeSession[]) {
		const actualSessionIds = runtimeSessionService.activeSessions.map(session => session.sessionId);
		const expectedSessionIds = expected.map(session => session.sessionId);
		assert.deepStrictEqual(actualSessionIds, expectedSessionIds, 'Unexpected active sessions');
	}

	function assertConsoleSessionForLanguage(languageId: string, expected: ILanguageRuntimeSession | undefined) {
		const actual = runtimeSessionService.getConsoleSessionForLanguage(languageId);
		const message = expected ?
			`Unexpected last used console session for language '${languageId}'` :
			`Expected no last used console session for language '${languageId}'`;
		assert.strictEqual(actual?.sessionId, expected?.sessionId, message);
	}

	function assertConsoleSessionForRuntime(
		runtimeId: string,
		expected: ILanguageRuntimeSession | undefined,
	) {
		const actual = runtimeSessionService.getConsoleSessionForRuntime(runtimeId);
		const message = expected ?
			`Unexpected last used console session for runtime '${runtimeId}'` :
			`Expected no last used console session for runtime '${runtimeId}'`;
		assert.strictEqual(actual?.sessionId, expected?.sessionId, message);
	}

	function assertHasStartingOrRunningConsole(expected: boolean) {
		const actual = runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId);
		const message = expected ?
			'Expected a starting or running console session but there was none' :
			'Expected no starting or running console session but there was one';
		assert.strictEqual(actual, expected, message);
	}

	function assertNotebookSessionForNotebookUri(
		notebookUri: URI,
		expected: ILanguageRuntimeSession | undefined,
	) {
		const actual = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		const message = expected ?
			`Unexpected notebook session for notebook URI '${notebookUri.toString()}'` :
			`Expected no notebook session for notebook URI '${notebookUri.toString()}'`;
		assert.strictEqual(actual?.sessionId, expected?.sessionId, message);
	}

	function assertSessionWillStart(
		runtime: ILanguageRuntimeMetadata,
		sessionMode: LanguageRuntimeSessionMode,
		action: string,
	) {
		assertActiveSessions([]);
		assertConsoleSessionForLanguage(runtime.languageId, undefined);
		assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
		// TODO: Post multisession, restoring a console does not mark it as starting. Should it?
		assertHasStartingOrRunningConsole(
			sessionMode === LanguageRuntimeSessionMode.Console && action !== 'restore'
		);
		assertNotebookSessionForNotebookUri(notebookUri, undefined);
	}

	/**
	 * Assert that a given session is the current active session.
	 *
	 * For a notebook session, checks that the session is the active notebook session for a given notebook URI.
	 * For a console session, checks that the session is the last used console session for a given runtime and language.
	 */
	function assertCurrentSession(
		runtime: ILanguageRuntimeMetadata,
		notebookUri: URI,
		session: ILanguageRuntimeSession,
	) {
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			assertConsoleSessionForLanguage(runtime.languageId, session);
			assertConsoleSessionForRuntime(runtime.runtimeId, session);
			assertHasStartingOrRunningConsole(true);
			assertNotebookSessionForNotebookUri(notebookUri, undefined);
		} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			assertConsoleSessionForLanguage(runtime.languageId, undefined);
			assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
			assertHasStartingOrRunningConsole(false);
			assertNotebookSessionForNotebookUri(notebookUri, session);
		}
	}

	async function restoreSession(
		sessionMetadata: IRuntimeSessionMetadata, runtime: ILanguageRuntimeMetadata,
	) {
		await runtimeSessionService.restoreRuntimeSession(runtime, sessionMetadata, sessionName, true, true);

		// Ensure that the session gets disposed after the test.
		const session = runtimeSessionService.getSession(sessionMetadata.sessionId);
		assert.ok(session instanceof TestLanguageRuntimeSession);
		disposables.add(session);

		return session;
	}

	function restoreConsole(runtime: ILanguageRuntimeMetadata) {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId: 'test-console-session-id',
			sessionMode: LanguageRuntimeSessionMode.Console,
			createdTimestamp: Date.now(),
			notebookUri: undefined,
			startReason,
		};
		return restoreSession(sessionMetadata, runtime);
	}

	function restoreNotebook(runtime: ILanguageRuntimeMetadata) {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId: 'test-notebook-session-id',
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			createdTimestamp: Date.now(),
			notebookUri,
			startReason,
		};
		return restoreSession(sessionMetadata, runtime);
	}

	async function autoStartSession(runtime: ILanguageRuntimeMetadata) {
		const sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason, true);
		assert.ok(sessionId);
		const session = runtimeSessionService.getSession(sessionId);
		assert.ok(session instanceof TestLanguageRuntimeSession);
		disposables.add(session);
		return session;
	}

	async function selectRuntime(runtime: ILanguageRuntimeMetadata, notebookUri?: URI) {
		await runtimeSessionService.selectRuntime(runtime.runtimeId, startReason, notebookUri);
		let session: ILanguageRuntimeSession | undefined;
		if (notebookUri) {
			session = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		} else {
			session = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId);
		}
		assert.ok(session instanceof TestLanguageRuntimeSession, 'No session found after selecting runtime');
		disposables.add(session);
		return session;
	}

	const data: { action: string; startConsole: IStartSessionTask; startNotebook?: IStartSessionTask }[] = [
		{ action: 'start', startConsole: startConsole, startNotebook: startNotebook },
		{ action: 'restore', startConsole: restoreConsole, startNotebook: restoreNotebook },
		{ action: 'auto start', startConsole: autoStartSession },
		{ action: 'select', startConsole: selectRuntime },
	];
	for (const { action, startConsole, startNotebook } of data) {

		for (const mode of [LanguageRuntimeSessionMode.Console, LanguageRuntimeSessionMode.Notebook]) {
			const start = mode === LanguageRuntimeSessionMode.Console ? startConsole : startNotebook;
			if (!start) {
				continue;
			}

			test(`${action} ${mode} returns the expected session`, async () => {
				const session = await start(runtime);

				assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
				assert.strictEqual(session.dynState.sessionName, sessionName);
				assert.strictEqual(session.metadata.sessionMode, mode);
				assert.strictEqual(session.metadata.startReason, startReason);
				assert.strictEqual(session.runtimeMetadata, runtime);

				if (mode === LanguageRuntimeSessionMode.Console) {
					assert.strictEqual(session.metadata.notebookUri, undefined);
				} else {
					assert.strictEqual(session.metadata.notebookUri, notebookUri);
				}
			});

			test(`${action} ${mode} sets the expected service state`, async () => {
				// Check the initial state.
				assertActiveSessions([]);
				assertConsoleSessionForLanguage(runtime.languageId, undefined);
				assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
				assertHasStartingOrRunningConsole(false);
				assertNotebookSessionForNotebookUri(notebookUri, undefined);

				const promise = start(runtime);

				// Check the state before awaiting the promise.
				assertSessionWillStart(runtime, mode, action);

				const session = await promise;

				// Check the state after awaiting the promise.
				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
			});

			test(`${action} ${mode} fires onWillStartSession`, async function () {
				let error: Error | undefined;
				const onWillStartSessionSpy = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
					try {
						assert.strictEqual(session.getRuntimeState(), RuntimeState.Uninitialized);

						// Check the service state when the event is fired.
						assertSessionWillStart(runtime, mode, action);
					} catch (e) {
						error = e;
					}
				});
				disposables.add(runtimeSessionService.onWillStartSession(onWillStartSessionSpy));
				const session = await start(runtime);

				sinon.assert.calledOnce(onWillStartSessionSpy);

				const event = onWillStartSessionSpy.getCall(0).args[0];
				if (action === 'restore') {
					assert.strictEqual(event.startMode, RuntimeStartMode.Reconnecting);
				} else {
					assert.strictEqual(event.startMode, RuntimeStartMode.Starting);
				}
				assert.strictEqual(event.session.sessionId, session.sessionId);
				assert.strictEqual(event.activate, true);

				assert.ifError(error);
			});

			test(`${action} ${mode} fires onDidStartRuntime`, async function () {
				let error: Error | undefined;
				const onDidStartRuntimeSpy = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
					try {
						// Check the service state when the event is fired.
						assertActiveSessions([session]);
						if (mode === LanguageRuntimeSessionMode.Console) {
							// TODO: Post multisession, the last used session for the language is set after
							//       the onDidStartRuntime event is fired. If we fix that, we could replace
							//       this if block with assertCurrentSession.
							assertConsoleSessionForLanguage(runtime.languageId, undefined);
							assertConsoleSessionForRuntime(runtime.runtimeId, session);
							assertHasStartingOrRunningConsole(true);
							assertNotebookSessionForNotebookUri(notebookUri, undefined);
						} else {
							assertConsoleSessionForLanguage(runtime.languageId, undefined);
							assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
							assertHasStartingOrRunningConsole(false);
							assertNotebookSessionForNotebookUri(notebookUri, session);
						}
						assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
					} catch (e) {
						error = e;
					}
				});
				disposables.add(runtimeSessionService.onDidStartRuntime(onDidStartRuntimeSpy));

				const session = await start(runtime);

				sinon.assert.calledOnce(onDidStartRuntimeSpy);

				const actualSession = onDidStartRuntimeSpy.getCall(0).args[0];
				assert.strictEqual(actualSession.sessionId, session.sessionId);

				assert.ifError(error);
			});

			test(`${action} ${mode} fires events in order`, async () => {
				const willStartSession = sinon.spy();
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				const didStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

				await start(runtime);

				sinon.assert.callOrder(willStartSession, didStartRuntime);
			});

			if (mode === LanguageRuntimeSessionMode.Console) {
				test(`${action} ${mode} sets foregroundSession`, async () => {
					const onDidChangeForegroundSessionSpy = sinon.spy();
					disposables.add(runtimeSessionService.onDidChangeForegroundSession(onDidChangeForegroundSessionSpy));

					const session = await start(runtime);

					assert.strictEqual(runtimeSessionService.foregroundSession?.sessionId, session.sessionId);

					await waitForRuntimeState(session, RuntimeState.Ready);

					// TODO: Feels a bit surprising that this isn't fired. It's because we set the private
					//       _foregroundSession property instead of the setter. When the 'ready' state is
					//       entered, we skip setting foregroundSession because it already matches the session.
					sinon.assert.notCalled(onDidChangeForegroundSessionSpy);
				});
			}

			if (action === 'start' || action === 'select') {
				test(`${action} ${mode} throws for unknown runtime`, async () => {
					const runtimeId = 'unknown-runtime-id';
					await assert.rejects(
						start({ runtimeId } as ILanguageRuntimeMetadata,),
						new Error(`No language runtime with id '${runtimeId}' was found.`),
					);
				});
			}

			const createOrRestoreMethod = action === 'restore' ? 'restoreSession' : 'createSession';
			test(`${action} ${mode} encounters ${createOrRestoreMethod}() error`, async () => {
				const error = new Error('Failed to create session');
				const stub = sinon.stub(manager, createOrRestoreMethod).rejects(error);

				await assert.rejects(start(runtime), error);

				// If we start now, without createOrRestoreMethod rejecting, it should work.
				stub.restore();
				const session = await start(runtime);

				assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
			});

			test(`${action} ${mode} encounters session.start() error`, async function () {
				// TODO: This test currently fails because selecting the runtime exits early
				//       if a session already exists for the runtime, even if the session is exited
				//       or uninitialized. Is that the expected behavior?
				if (action === 'select' && mode === LanguageRuntimeSessionMode.Console) {
					this.skip();
				}

				// Listen to the onWillStartSession event and stub session.start() to throw an error.
				const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
					sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
				});
				const willStartSessionDisposable = runtimeSessionService.onWillStartSession(willStartSession);

				const didFailStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidFailStartRuntime(didFailStartRuntime));

				const didStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

				// Start the session. It should error.
				await assert.rejects(start(runtime), new Error('Session failed to start'));

				// The session should still be created.
				assert.equal(runtimeSessionService.activeSessions.length, 1);
				const session1 = runtimeSessionService.activeSessions[0];
				disposables.add(session1);

				assert.strictEqual(session1.getRuntimeState(), RuntimeState.Uninitialized);

				// The session should not be returned by any service methods
				// but is still considered an active session.
				assertActiveSessions([session1]);
				assertConsoleSessionForLanguage(runtime.languageId, undefined);
				if (mode === LanguageRuntimeSessionMode.Console) {
					// TODO: getConsoleSessionForRuntime currently includes uninitialized sessions. Should it?
					assertConsoleSessionForRuntime(runtime.runtimeId, session1);
				} else if (mode === LanguageRuntimeSessionMode.Notebook) {
					assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
				}
				assertHasStartingOrRunningConsole(false);
				assertNotebookSessionForNotebookUri(notebookUri, undefined);

				sinon.assert.calledOnceWithExactly(didFailStartRuntime, session1);
				sinon.assert.callOrder(willStartSession, didFailStartRuntime);
				sinon.assert.notCalled(didStartRuntime);

				// If we start now, without session.start() rejecting, it should work.
				willStartSessionDisposable.dispose();
				const session2 = await start(runtime);

				if (action === 'select' || action === 'restore') {
					// Selecting/restoring the same session multiple times overwrites the session in activeSessions.
					// TODO: Should this be the case for selecting?
					assertActiveSessions([session1]);
				} else {
					assertActiveSessions([session1, session2]);
				}

				assertCurrentSession(runtime, notebookUri, session2);
				assert.strictEqual(session2.getRuntimeState(), RuntimeState.Starting);
			});

			test(`${action} ${mode} concurrently encounters session.start() error`, async function () {
				// TODO: Post multisession, concurrently restoring console sessions has undefined behavior.
				if ((action === 'restore' && mode === LanguageRuntimeSessionMode.Console)) {
					this.skip();
				}
				// Listen to the onWillStartSession event and stub session.start() to throw an error.
				const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
					sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
				});
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				// Start twice concurrently. Both should error.
				await Promise.all([
					assert.rejects(start(runtime)),
					assert.rejects(start(runtime)),
				]);
			});

			if (mode === LanguageRuntimeSessionMode.Notebook) {
				test(`${action} ${mode} throws if another runtime is starting for the language`, async () => {
					const error = new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
						`be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already starting for the notebook ${notebookUri.toString()}.`
						+ (action !== 'restore' ? ` Request source: ${startReason}` : ''));

					await assert.rejects(
						Promise.all([
							start(runtime),
							start(anotherRuntime),
						]),
						error);
				});

				test(`${action} ${mode} throws if another runtime is running for the language`, async () => {
					const error = new Error(`A notebook for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
						`be started because a notebook for ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already running for the URI ${notebookUri.toString()}.` +
						(action !== 'restore' ? ` Request source: ${startReason}` : ''));

					await start(runtime);
					await assert.rejects(
						start(anotherRuntime),
						error,
					);
				});
			}

			test(`${action} ${mode} successively`, async () => {
				const session1 = await start(runtime);
				const session2 = await start(runtime);
				const session3 = await start(runtime);

				if (mode === LanguageRuntimeSessionMode.Notebook
					// Restoring/selecting a console any number of times should return the same session.
					|| (mode === LanguageRuntimeSessionMode.Console
						&& (action === 'restore' || action === 'select'))) {
					assert.strictEqual(session1.sessionId, session2.sessionId);
					assert.strictEqual(session2.sessionId, session3.sessionId);

					assertActiveSessions([session1]);
					assertCurrentSession(runtime, notebookUri, session1);
					assert.strictEqual(session1.getRuntimeState(), RuntimeState.Starting);
				} else if (mode === LanguageRuntimeSessionMode.Console) {
					assert.notStrictEqual(session1.sessionId, session2.sessionId);
					assert.notStrictEqual(session2.sessionId, session3.sessionId);

					assertActiveSessions([session1, session2, session3]);
					assertCurrentSession(runtime, notebookUri, session3);
					assert.strictEqual(session1.getRuntimeState(), RuntimeState.Starting);
					assert.strictEqual(session2.getRuntimeState(), RuntimeState.Starting);
					assert.strictEqual(session3.getRuntimeState(), RuntimeState.Starting);
				}
			});

			test(`${action} ${mode} concurrently`, async function () {
				// TODO: Post multisession, concurrently restoring console sessions has undefined behavior.
				if ((action === 'restore' && mode === LanguageRuntimeSessionMode.Console)) {
					this.skip();
				}
				const [session1, session2, session3] = await Promise.all([start(runtime), start(runtime), start(runtime)]);

				assert.strictEqual(session1.sessionId, session2.sessionId);
				assert.strictEqual(session2.sessionId, session3.sessionId);

				assertActiveSessions([session1]);
				assertCurrentSession(runtime, notebookUri, session1);
				assert.strictEqual(session1.getRuntimeState(), RuntimeState.Starting);
			});

			if (mode === LanguageRuntimeSessionMode.Console) {
				test(`${action} console concurrently with no session manager for runtime (#5615)`, async () => {
					sinon.stub(manager, 'managesRuntime').resolves(false);

					// Start twice concurrently.
					const promise1 = start(runtime);
					const promise2 = start(runtime);

					// Both promises should reject.
					// This was not previously the case since the second call returns a deferred
					// promise that does not necessarily resolve/reject with the first call.
					await assert.rejects(promise1);
					await assert.rejects(promise2);
				});
			}
		}

		if (startNotebook) {
			test(`${action} console and notebook from the same runtime concurrently`, async () => {
				// Consoles and notebooks shouldn't interfere with each other, even for the same runtime.
				const [consoleSession, notebookSession] = await Promise.all([
					startConsole(runtime),
					startNotebook(runtime),
				]);

				assert.strictEqual(consoleSession.getRuntimeState(), RuntimeState.Starting);
				assert.strictEqual(notebookSession.getRuntimeState(), RuntimeState.Starting);

				assertActiveSessions([consoleSession, notebookSession]);
				assertConsoleSessionForLanguage(runtime.languageId, consoleSession);
				assertConsoleSessionForRuntime(runtime.runtimeId, consoleSession);
				assertHasStartingOrRunningConsole(true);
				assertNotebookSessionForNotebookUri(notebookUri, notebookSession);
			});
		}
	}

	test(`start notebook without notebook uri`, async () => {
		await assert.rejects(
			startSession(runtime, LanguageRuntimeSessionMode.Notebook, undefined),
			new Error('A notebook URI must be provided when starting a notebook session.'),
		);
	});

	test('restore console registers runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		assert.strictEqual(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		await restoreConsole(unregisteredRuntime);

		// The runtime should now be registered.
		assert.strictEqual(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), unregisteredRuntime);
	});

	test('auto start validates runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		assert.strictEqual(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		// Update the validator to add extra runtime data.
		const validatedMetadata: Partial<ILanguageRuntimeMetadata> = {
			extraRuntimeData: { someNewKey: 'someNewValue' }
		};
		manager.setValidateMetadata(async (metadata: ILanguageRuntimeMetadata) => {
			return { ...metadata, ...validatedMetadata };
		});

		await autoStartSession(unregisteredRuntime);

		// The validated metadata should now be registered.
		assert.deepStrictEqual(
			languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId),
			{ ...unregisteredRuntime, ...validatedMetadata }
		);
	});

	test('auto start throws if runtime validation errors', async () => {
		// The runtime should not yet be registered.
		assert.strictEqual(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		// Update the validator to throw.
		const error = new Error('Failed to validate runtime metadata');
		manager.setValidateMetadata(async (_metadata: ILanguageRuntimeMetadata) => {
			throw error;
		});

		await assert.rejects(autoStartSession(unregisteredRuntime), error);

		// The runtime should remain unregistered.
		assert.strictEqual(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);
	});

	test('auto start console does nothing if automatic startup is disabled', async () => {
		configService.setUserConfiguration('interpreters.startupBehavior', LanguageStartupBehavior.Disabled);

		const sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason, true);

		assert.strictEqual(sessionId, '');

		assertActiveSessions([]);
		assertHasStartingOrRunningConsole(false);
		assertConsoleSessionForLanguage(runtime.languageId, undefined);
		assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
		assertNotebookSessionForNotebookUri(notebookUri, undefined);
	});

	for (const action of ['auto start', 'start']) {
		test(`${action} console in an untrusted workspace defers until trust is granted`, async () => {
			workspaceTrustManagementService.setWorkspaceTrust(false);

			let sessionId: string;
			if (action === 'auto start') {
				sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason, true);
			} else {
				sessionId = await runtimeSessionService.startNewRuntimeSession(
					runtime.runtimeId, sessionName, LanguageRuntimeSessionMode.Console, undefined, startReason, RuntimeStartMode.Starting, true);
			}

			assert.strictEqual(sessionId, '');

			assertActiveSessions([]);
			assertConsoleSessionForLanguage(runtime.languageId, undefined);
			assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
			assertHasStartingOrRunningConsole(false);
			assertNotebookSessionForNotebookUri(notebookUri, undefined);

			workspaceTrustManagementService.setWorkspaceTrust(true);

			// The session should eventually start.
			const session = await Event.toPromise(runtimeSessionService.onDidStartRuntime);
			disposables.add(session);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
		});
	}

	test('start notebook in an untrusted workspace throws', async () => {
		workspaceTrustManagementService.setWorkspaceTrust(false);

		await assert.rejects(startNotebook(runtime), new Error('Cannot start a notebook session in an untrusted workspace.'));
	});

	for (const state of [RuntimeState.Exited, RuntimeState.Uninitialized]) {
		// TODO: This test fails because the console session for the runtime is undefined.
		//       This is because selecting the runtime exits early if a session already
		//       exists for the runtime, even if the session is exited or uninitialized.
		//       Is that the expected behavior?
		test.skip(`select console in '${state}' state`, async () => {
			// Start a console and override its state for this test.
			const session = await startConsole(runtime);
			if (session.getRuntimeState() !== state) {
				session.setRuntimeState(state);
			}

			// Select the same runtime for the console.
			await runtimeSessionService.selectRuntime(runtime.runtimeId, startReason);

			assertActiveSessions([session]);
			assertConsoleSessionForLanguage(runtime.languageId, session);
			assertConsoleSessionForRuntime(runtime.runtimeId, session);
			assertHasStartingOrRunningConsole(true);
			assertNotebookSessionForNotebookUri(notebookUri, undefined);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
		});
	}

	test('select console while another runtime is running for the language', async () => {
		const session1 = await startConsole(anotherRuntime);
		await waitForRuntimeState(session1, RuntimeState.Ready);
		const session2 = await selectRuntime(runtime);

		assert.notStrictEqual(session1.sessionId, session2.sessionId);

		assertActiveSessions([session1, session2]);
		assertConsoleSessionForLanguage(runtime.languageId, session2);
		assertConsoleSessionForRuntime(runtime.runtimeId, session2);
		assertConsoleSessionForRuntime(anotherRuntime.runtimeId, session1);
		assertHasStartingOrRunningConsole(true);
		assert.strictEqual(session1.getRuntimeState(), RuntimeState.Ready);
		assert.strictEqual(session2.getRuntimeState(), RuntimeState.Starting);
	});

	test('select console while another runtime is starting for the language', async () => {
		const [session1, session2] = await Promise.all([
			startConsole(anotherRuntime),
			selectRuntime(runtime),
		]);
		assert.notStrictEqual(session1.sessionId, session2.sessionId);

		assertActiveSessions([session1, session2]);
		assertConsoleSessionForLanguage(runtime.languageId, session2);
		assertConsoleSessionForRuntime(runtime.runtimeId, session2);
		assertConsoleSessionForRuntime(anotherRuntime.runtimeId, session1);
		assertHasStartingOrRunningConsole(true);
		assert.strictEqual(session1.getRuntimeState(), RuntimeState.Starting);
		assert.strictEqual(session2.getRuntimeState(), RuntimeState.Starting);
	});

	test('select console to the same runtime sets the foreground session', async () => {
		const session1 = await startConsole(runtime);

		runtimeSessionService.foregroundSession = undefined;

		const session2 = await selectRuntime(runtime);

		assert.strictEqual(session1, session2);
		assert.strictEqual(runtimeSessionService.foregroundSession, session1);
	});

	function restartSession(sessionId: string) {
		return runtimeSessionService.restartSession(sessionId, startReason, false);
	}

	for (const { mode, start } of [
		{ mode: LanguageRuntimeSessionMode.Console, start: startConsole },
		{ mode: LanguageRuntimeSessionMode.Notebook, start: startNotebook },
	]) {
		test(`restart ${mode} throws if session not found`, async () => {
			const sessionId = 'unknown-session-id';
			assert.rejects(
				restartSession(sessionId),
				new Error(`No session with ID '${sessionId}' was found.`),
			);
		});

		for (const state of [RuntimeState.Busy, RuntimeState.Idle, RuntimeState.Ready, RuntimeState.Exited]) {
			test(`restart ${mode} in '${state}' state`, async () => {
				// Start the session and wait for it to be ready.
				const session = await start(runtime);
				await waitForRuntimeState(session, RuntimeState.Ready);

				// Set the state to the desired state.
				if (session.getRuntimeState() !== state) {
					session.setRuntimeState(state);
				}

				const willStartSession = sinon.spy();
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				await restartSession(session.sessionId);

				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);

				sinon.assert.calledOnceWithExactly(willStartSession, {
					session,
					startMode: RuntimeStartMode.Restarting,
					hasConsole: mode === LanguageRuntimeSessionMode.Console,
					activate: false
				});
			});

			test(`restart ${mode} in '${state}' state encounters session.restart() error`, async () => {
				// Start the session and wait for it to be ready.
				const session = await start(runtime);
				await waitForRuntimeState(session, RuntimeState.Ready);

				// Set the state to the desired state.
				if (session.getRuntimeState() !== state) {
					session.setRuntimeState(state);
				}

				// Stub session.restart() to reject.
				let restartStub;
				if (state === RuntimeState.Exited) {
					// When in an exited state, we actually call session.start() instead of session.restart().
					restartStub = sinon.stub(session, 'start').rejects(new Error('Session failed to restart'));
				} else {
					restartStub = sinon.stub(session, 'restart').rejects(new Error('Session failed to restart'));
				}

				// Restart the session. It should error.
				await assert.rejects(restartSession(session.sessionId));

				// The session's state should not have changed.
				assert.strictEqual(session.getRuntimeState(), state);

				// If we restart now, without session.restart() rejecting, it should work.
				restartStub.restore();
				await restartSession(session.sessionId);

				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);
			});

			test(`restart ${mode} in '${state}' state and session never reaches ready state`, async () => {
				// Start the session and wait for it to be ready.
				const session = await start(runtime);
				await waitForRuntimeState(session, RuntimeState.Ready);

				// Set the state to the desired state.
				if (session.getRuntimeState() !== state) {
					session.setRuntimeState(state);
				}

				// Stub onDidChangeRuntimeState to never fire, causing the restart to time out.
				sinon.stub(session, 'onDidChangeRuntimeState').returns({ dispose: () => { } });

				// Use a fake timer to avoid actually having to wait for the timeout.
				const clock = sinon.useFakeTimers();
				const promise = assert.rejects(restartSession(session.sessionId), new Error(`Timed out waiting for runtime ` +
					`${formatLanguageRuntimeSession(session)} to be 'ready'.`));
				await clock.tickAsync(10_000);
				await promise;
			});
		}

		test(`restart ${mode} in 'uninitialized' state`, async () => {
			// Get a session to the uninitialized state.
			const state = RuntimeState.Uninitialized;

			const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
				sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
			});
			const willStartSessionDisposable = runtimeSessionService.onWillStartSession(willStartSession);

			await assert.rejects(start(runtime), new Error('Session failed to start'));

			assert.equal(runtimeSessionService.activeSessions.length, 1);
			const session = runtimeSessionService.activeSessions[0];
			disposables.add(session);

			assert.strictEqual(session.getRuntimeState(), state);

			// Set the state to the desired state.
			willStartSessionDisposable.dispose();

			const willStartSession2 = sinon.spy();
			disposables.add(
				runtimeSessionService.onWillStartSession(willStartSession2)
			);

			await restartSession(session.sessionId);

			// The existing session should remain exited.
			assert.strictEqual(session.getRuntimeState(), state);

			// A new session should be starting.
			let newSession: ILanguageRuntimeSession | undefined;
			if (mode === LanguageRuntimeSessionMode.Console) {
				newSession = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId);
			} else {
				newSession = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
			}
			assert.ok(newSession);
			disposables.add(newSession);

			sinon.assert.calledOnceWithExactly(willStartSession2, {
				session: newSession,
				// Since we restarted from an exited state, the start mode is 'starting'.
				startMode: RuntimeStartMode.Starting,
				activate: true
			});

			assert.strictEqual(newSession.dynState.sessionName, session.dynState.sessionName);
			assert.strictEqual(newSession.metadata.sessionMode, session.metadata.sessionMode);
			assert.strictEqual(newSession.metadata.notebookUri, session.metadata.notebookUri);
			assert.strictEqual(newSession.runtimeMetadata, session.runtimeMetadata);

			assertActiveSessions([session, newSession]);
			assertCurrentSession(runtime, notebookUri, newSession);
			assert.strictEqual(newSession.getRuntimeState(), RuntimeState.Starting);
		});

		test(`restart ${mode} in 'starting' state`, async () => {
			const session = await start(runtime);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);

			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Starting);
		});

		test(`restart ${mode} in 'restarting' state`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			session.restart();
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Restarting);

			const target = sinon.spy(session, 'restart');

			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Restarting);

			sinon.assert.notCalled(target);
		});

		test(`restart ${mode} concurrently`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const target = sinon.spy(session, 'restart');

			await Promise.all([
				restartSession(session.sessionId),
				restartSession(session.sessionId),
				restartSession(session.sessionId),
			]);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);

			sinon.assert.calledOnce(target);
		});

		test(`restart ${mode} successively`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const target = sinon.spy(session, 'restart');

			await restartSession(session.sessionId);
			await restartSession(session.sessionId);
			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);

			sinon.assert.calledThrice(target);
		});

		test(`restart ${mode} while 'ready', then start successively`, async function () {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			await restartSession(session.sessionId);
			const newSession = await start(runtime);

			if (mode === LanguageRuntimeSessionMode.Notebook) {
				// The existing session for the notebook should be reused.
				assert.strictEqual(session.sessionId, newSession.sessionId);
				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);
			} else if (mode === LanguageRuntimeSessionMode.Console) {
				// A new console session should be created.
				assert.notStrictEqual(session.sessionId, newSession.sessionId);
				assertActiveSessions([session, newSession]);
				assertCurrentSession(runtime, notebookUri, newSession);
				assert.strictEqual(session.getRuntimeState(), RuntimeState.Ready);
				assert.strictEqual(newSession.getRuntimeState(), RuntimeState.Starting);
			}
		});

		test(`restart ${mode} while 'ready', then start concurrently`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const [, newSession] = await Promise.all([restartSession(session.sessionId), start(runtime)]);

			// TODO: Perhaps a new console should be started in this case?
			// The existing session is reused.
			assert.strictEqual(session.sessionId, newSession.sessionId);
			assertActiveSessions([newSession]);
			assertCurrentSession(runtime, notebookUri, newSession);
			assert.strictEqual(newSession.getRuntimeState(), RuntimeState.Ready);
		});
	}

	async function shutdownNotebook() {
		await runtimeSessionService.shutdownNotebookSession(
			notebookUri, RuntimeExitReason.Shutdown, 'Test requested to shutdown a notebook',
		);
	}

	test('shutdown notebook', async () => {
		const session = await startNotebook(runtime);
		await waitForRuntimeState(session, RuntimeState.Ready);

		await shutdownNotebook();

		assertActiveSessions([session]);
		assertNotebookSessionForNotebookUri(notebookUri, undefined);
		assert.strictEqual(session.getRuntimeState(), RuntimeState.Exited);
	});

	test('select notebook while shutting down notebook', async () => {
		const session = await startNotebook(runtime);
		await waitForRuntimeState(session, RuntimeState.Ready);

		const [, newSession] = await Promise.all([
			shutdownNotebook(),
			selectRuntime(runtime, notebookUri),
		]);

		assertActiveSessions([session, newSession]);
		assertNotebookSessionForNotebookUri(notebookUri, newSession);
		assert.strictEqual(session.getRuntimeState(), RuntimeState.Exited);
		assert.strictEqual(newSession.getRuntimeState(), RuntimeState.Starting);
	});

	test('shutdown notebook while selecting notebook', async () => {
		const [session,] = await Promise.all([
			selectRuntime(runtime, notebookUri),
			shutdownNotebook(),
		]);

		assertActiveSessions([session]);
		assertNotebookSessionForNotebookUri(notebookUri, undefined);
		assert.strictEqual(session.getRuntimeState(), RuntimeState.Exited);
	});

	test(`only one UI comm is created`, async () => {
		// Create the session
		const session = await startConsole(runtime);

		// Wait for a tick to yield the thread (since comm creation is async)
		await timeout(0);

		// At this point, it should have exactly one UI comm
		const uiCommsBefore = await session.listClients(RuntimeClientType.Ui);
		assert.strictEqual(uiCommsBefore.length, 1);

		// Put the session back into the Ready state. This typically triggers
		// the creation of the UI comm as a side effect, but since the UI comm
		// is already open, we shouldn't create another one.
		session.setRuntimeState(RuntimeState.Ready);

		// Wait for a tick to yield the thread (since comm creation is async)
		await timeout(0);

		// We should still have exactly one UI comm
		const uiCommsAfter = await session.listClients(RuntimeClientType.Ui);
		assert.strictEqual(uiCommsAfter.length, 1);
	});

	test(`can set the working directory`, async () => {
		// Create the session
		const session = await startConsole(runtime);
		await timeout(0);

		const dir = '/foo/bar/baz';
		session.setWorkingDirectory(dir);

		assert.strictEqual(session.getWorkingDirectory(), dir);
	});

	test(`working directory sticks after a restart`, async () => {
		// Create the session
		const session = await startConsole(runtime);
		await timeout(0);

		const dir = '/baz/bar/foo';
		session.setWorkingDirectory(dir);

		// Clear the working directory. This clears the state w/o firing an event.
		session.clearWorkingDirectory();

		// This should restore the working directory to the last state Positron
		// saw.
		await runtimeSessionService.restartSession(session.sessionId, startReason);
		await timeout(0);

		assert.strictEqual(session.getWorkingDirectory(), dir);
	});

	test('updateNotebookSessionUri updates URI mapping correctly', async () => {
		// Create an untitled notebook URI (simulating new untitled notebook)
		const untitledUri = URI.parse('untitled:notebook.ipynb');

		// Create a new URI (simulating saving the notebook to a file)
		const savedUri = URI.file('/path/to/saved/notebook.ipynb');

		// Start a notebook session with the untitled URI
		const session = await startSession(runtime, LanguageRuntimeSessionMode.Notebook, untitledUri);

		// Ensure the session is retrievable with the untitled URI
		const sessionBeforeUpdate = runtimeSessionService.getNotebookSessionForNotebookUri(untitledUri);
		assert.strictEqual(sessionBeforeUpdate, session, 'Session should be accessible via untitled URI before update');

		// Update the session's URI
		const returnedSessionId = runtimeSessionService.updateNotebookSessionUri(untitledUri, savedUri);

		// Verify returned sessionId matches the session's ID
		assert.strictEqual(returnedSessionId, session.sessionId, 'Function should return the correct session ID');

		// Verify the session is no longer accessible via the old URI
		const oldUriSession = runtimeSessionService.getNotebookSessionForNotebookUri(untitledUri);
		assert.strictEqual(oldUriSession, undefined, 'Session should no longer be accessible via old URI');

		// Verify the session is accessible via the new URI
		const newUriSession = runtimeSessionService.getNotebookSessionForNotebookUri(savedUri);
		assert.strictEqual(newUriSession, session, 'Session should be accessible via new URI');
	});

	test('updateNotebookSessionUri returns undefined when session not found', async () => {
		// Create URIs that don't have associated sessions
		const nonExistentUri = URI.file('/path/to/nonexistent/notebook.ipynb');
		const newUri = URI.file('/path/to/new/notebook.ipynb');

		// Attempt to update a non-existent session
		const returnedSessionId = runtimeSessionService.updateNotebookSessionUri(nonExistentUri, newUri);

		// Verify no session ID is returned
		assert.strictEqual(returnedSessionId, undefined,
			'Function should return undefined when no session exists for the old URI');
	});

	test('updateSessionName updates session name correctly', async () => {
		// Create a new session
		const session = await startConsole(runtime);
		const otherSession = await startConsole(runtime);

		await waitForRuntimeState(session, RuntimeState.Ready);
		await waitForRuntimeState(otherSession, RuntimeState.Ready);

		assert.strictEqual(session.dynState.sessionName, runtime.runtimeName, 'Initial session name should match');
		assert.strictEqual(otherSession.dynState.sessionName, runtime.runtimeName, 'Initial session name should match');

		// Set a new name for the session
		const newName = 'updated-session-name';
		runtimeSessionService.updateSessionName(session.sessionId, newName);

		// Verify the session's name has been updated
		assert.strictEqual(session.dynState.sessionName, newName, 'Session name should be updated correctly');
		assert.strictEqual(otherSession.dynState.sessionName, runtime.runtimeName, 'Other session name should remain unchanged');
	});

	suite('Working Directory Configuration', () => {
		test('working directory is applied to notebook sessions when configured', async () => {
			const workingDir = '/custom/working/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, workingDir, 'Working directory should be set for notebook sessions');
		});

		test('working directory is default for console sessions even when notebook working directory is configured', async () => {
			const workingDir = '/custom/working/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startConsole(runtime);

			assert.strictEqual(session.metadata.workingDirectory, undefined, 'Working directory should be undefined for console sessions');
		});

		test('working directory is default when configuration is empty string', async () => {
			configService.setUserConfiguration(NotebookSetting.workingDirectory, '');

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, notebookParent, 'Working directory should be default for empty string');
		});

		test('working directory is default when configuration is whitespace only', async () => {
			configService.setUserConfiguration(NotebookSetting.workingDirectory, '   ');

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, notebookParent, 'Working directory should be default for whitespace only');
		});

		test('working directory supports variable resolution for notebook sessions', async () => {
			const workingDir = '/workspace/folder';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			// Create a mock that actually resolves variables
			const mockConfigResolver = configurationResolverService as any;
			mockConfigResolver.resolveAsync = sinon.stub().resolves('/resolved/workspace/folder');

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, '/resolved/workspace/folder', 'Working directory should be resolved');
			sinon.assert.calledOnce(mockConfigResolver.resolveAsync);
		});

		test('working directory falls back to default when resolution fails for notebook sessions', async () => {
			const workingDir = '/workspace/folder';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			// Create a mock that throws an error during resolution
			const mockConfigResolver = configurationResolverService as any;
			mockConfigResolver.resolveAsync = sinon.stub().rejects(new Error('Resolution failed'));

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, notebookParent, 'Working directory should fall back to default');
			sinon.assert.calledOnce(mockConfigResolver.resolveAsync);
		});

		test('working directory falls back to default when it doesnt exist', async () => {
			const workingDir = '/non/existent/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, notebookParent, 'Working directory should fall back to default for non-existent directory');
		});

		test('working directory is resource-scoped for notebook sessions', async () => {
			const workingDir = '/notebook/specific/directory';
			await configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir, notebookUri);

			const session = await startNotebook(runtime);

			assert.strictEqual(session.metadata.workingDirectory, workingDir, 'Working directory should be resource-scoped');
		});

		test('working directory differs between console and notebook sessions', async () => {
			const consoleWorkingDir = '/console/directory';
			const notebookWorkingDir = '/notebook/directory';

			await configService.setUserConfiguration(NotebookSetting.workingDirectory, consoleWorkingDir);
			await configService.setUserConfiguration(NotebookSetting.workingDirectory, notebookWorkingDir, notebookUri);

			const consoleSession = await startConsole(runtime);
			const notebookSession = await startNotebook(runtime);

			assert.strictEqual(consoleSession.metadata.workingDirectory, undefined, 'Console session should not use working directory configuration');
			assert.strictEqual(notebookSession.metadata.workingDirectory, notebookWorkingDir, 'Notebook session should use resource-scoped configuration');
		});
	});
});
