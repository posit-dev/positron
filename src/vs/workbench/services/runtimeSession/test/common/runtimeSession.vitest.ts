/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { timeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { URI } from '../../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IWorkspaceTrustManagementService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { formatLanguageRuntimeMetadata, formatLanguageRuntimeSession, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, LanguageStartupBehavior, RuntimeExitReason, RuntimeState } from '../../../languageRuntime/common/languageRuntimeService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent, RuntimeClientType, RuntimeStartMode } from '../../common/runtimeSessionService.js';
import { TestLanguageRuntimeSession, waitForRuntimeState } from './testLanguageRuntimeSession.js';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from './testRuntimeSessionService.js';
import { createTestContainer } from '../../../../test/browser/positronTestContainer.js';
import { TestRuntimeSessionManager } from '../../../../test/common/positronWorkbenchTestServices.js';
import { TestWorkspaceTrustManagementService } from '../../../../test/common/workbenchTestServices.js';
import { IConfigurationResolverService } from '../../../configurationResolver/common/configurationResolver.js';
import { NotebookSetting } from '../../../../contrib/notebook/common/notebookCommon.js';

type IStartSessionTask = (runtime: ILanguageRuntimeMetadata) => Promise<TestLanguageRuntimeSession>;

describe('Positron - RuntimeSessionService', () => {
	const ctx = createTestContainer().withRuntimeServices().build();
	const disposables = ctx.disposables;
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

	beforeEach(() => {
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
		expect(actualSessionIds).toEqual(expectedSessionIds);
	}

	function assertConsoleSessionForLanguage(languageId: string, expected: ILanguageRuntimeSession | undefined) {
		const actual = runtimeSessionService.getConsoleSessionForLanguage(languageId);
		const message = expected ?
			`Unexpected last used console session for language '${languageId}'` :
			`Expected no last used console session for language '${languageId}'`;
		expect(actual?.sessionId).toBe(expected?.sessionId);
	}

	function assertConsoleSessionForRuntime(
		runtimeId: string,
		expected: ILanguageRuntimeSession | undefined,
	) {
		const actual = runtimeSessionService.getConsoleSessionForRuntime(runtimeId);
		const message = expected ?
			`Unexpected last used console session for runtime '${runtimeId}'` :
			`Expected no last used console session for runtime '${runtimeId}'`;
		expect(actual?.sessionId).toBe(expected?.sessionId);
	}

	function assertHasStartingOrRunningConsole(expected: boolean) {
		const actual = runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId);
		const message = expected ?
			'Expected a starting or running console session but there was none' :
			'Expected no starting or running console session but there was one';
		expect(actual).toBe(expected);
	}

	function assertNotebookSessionForNotebookUri(
		notebookUri: URI,
		expected: ILanguageRuntimeSession | undefined,
	) {
		const actual = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
		const message = expected ?
			`Unexpected notebook session for notebook URI '${notebookUri.toString()}'` :
			`Expected no notebook session for notebook URI '${notebookUri.toString()}'`;
		expect(actual?.sessionId).toBe(expected?.sessionId);
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
		expect(session instanceof TestLanguageRuntimeSession).toBeTruthy();
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
		expect(sessionId).toBeTruthy();
		const session = runtimeSessionService.getSession(sessionId);
		expect(session instanceof TestLanguageRuntimeSession).toBeTruthy();
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
		expect(session instanceof TestLanguageRuntimeSession, 'No session found after selecting runtime').toBeTruthy();
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

			it(`${action} ${mode} returns the expected session`, async () => {
				const session = await start(runtime);

				expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
				expect(session.dynState.sessionName).toBe(sessionName);
				expect(session.metadata.sessionMode).toBe(mode);
				expect(session.metadata.startReason).toBe(startReason);
				expect(session.runtimeMetadata).toBe(runtime);

				if (mode === LanguageRuntimeSessionMode.Console) {
					expect(session.metadata.notebookUri).toBe(undefined);
				} else {
					expect(session.metadata.notebookUri).toBe(notebookUri);
				}
			});

			it(`${action} ${mode} sets the expected service state`, async () => {
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
				expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
			});

			it(`${action} ${mode} fires onWillStartSession`, async function () {
				let error: Error | undefined;
				const onWillStartSessionSpy = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
					try {
						expect(session.getRuntimeState()).toBe(RuntimeState.Uninitialized);

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
					expect(event.startMode).toBe(RuntimeStartMode.Reconnecting);
				} else {
					expect(event.startMode).toBe(RuntimeStartMode.Starting);
				}
				expect(event.session.sessionId).toBe(session.sessionId);
				expect(event.activate).toBe(true);

				expect(error).toBeFalsy();
			});

			it(`${action} ${mode} fires onDidStartRuntime`, async function () {
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
						expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
					} catch (e) {
						error = e;
					}
				});
				disposables.add(runtimeSessionService.onDidStartRuntime(onDidStartRuntimeSpy));

				const session = await start(runtime);

				sinon.assert.calledOnce(onDidStartRuntimeSpy);

				const actualSession = onDidStartRuntimeSpy.getCall(0).args[0];
				expect(actualSession.sessionId).toBe(session.sessionId);

				expect(error).toBeFalsy();
			});

			it(`${action} ${mode} fires events in order`, async () => {
				const willStartSession = sinon.spy();
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				const didStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

				await start(runtime);

				sinon.assert.callOrder(willStartSession, didStartRuntime);
			});

			if (mode === LanguageRuntimeSessionMode.Console) {
				it(`${action} ${mode} sets foregroundSession`, async () => {
					const onDidChangeForegroundSessionSpy = sinon.spy();
					disposables.add(runtimeSessionService.onDidChangeForegroundSession(onDidChangeForegroundSessionSpy));

					const session = await start(runtime);

					expect(runtimeSessionService.foregroundSession?.sessionId).toBe(session.sessionId);

					await waitForRuntimeState(session, RuntimeState.Ready);

					sinon.assert.called(onDidChangeForegroundSessionSpy);
				});
			}

			if (action === 'start' || action === 'select') {
				it(`${action} ${mode} throws for unknown runtime`, async () => {
					const runtimeId = 'unknown-runtime-id';
					await expect(
						start({ runtimeId } as ILanguageRuntimeMetadata),
					).rejects.toThrow(`No language runtime with id '${runtimeId}' was found.`);
				});
			}

			const createOrRestoreMethod = action === 'restore' ? 'restoreSession' : 'createSession';
			it(`${action} ${mode} encounters ${createOrRestoreMethod}() error`, async () => {
				const error = new Error('Failed to create session');
				const stub = sinon.stub(manager, createOrRestoreMethod).rejects(error);

				await expect(start(runtime)).rejects.toThrow(error.message);

				// If we start now, without createOrRestoreMethod rejecting, it should work.
				stub.restore();
				const session = await start(runtime);

				expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
			});

			it(`${action} ${mode} encounters session.start() error`, async () => {
				// TODO: This test currently fails because selecting the runtime exits early
				//       if a session already exists for the runtime, even if the session is exited
				//       or uninitialized. Is that the expected behavior?
				if (action === 'select' && mode === LanguageRuntimeSessionMode.Console) {
					return; // skip - not applicable for this action/mode combination
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
				await expect(start(runtime)).rejects.toThrow(new Error('Session failed to start').message);

				// The session should still be created.
				expect(runtimeSessionService.activeSessions.length).toBe(1);
				const session1 = runtimeSessionService.activeSessions[0];
				disposables.add(session1);

				expect(session1.getRuntimeState()).toBe(RuntimeState.Uninitialized);

				// The session should not be returned by any service methods
				// but is still considered an active session.
				assertActiveSessions([session1]);
				assertConsoleSessionForLanguage(runtime.languageId, undefined);
				if (mode === LanguageRuntimeSessionMode.Console) {
					// TODO: getConsoleSessionForRuntime currently includes uninitialized sessions. Should it?
					assertConsoleSessionForRuntime(runtime.runtimeId, session1);
					assertNotebookSessionForNotebookUri(notebookUri, undefined);
				} else if (mode === LanguageRuntimeSessionMode.Notebook) {
					assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
					assertNotebookSessionForNotebookUri(notebookUri, session1);
				}
				assertHasStartingOrRunningConsole(false);

				sinon.assert.calledOnceWithExactly(didFailStartRuntime, session1);
				sinon.assert.callOrder(willStartSession, didFailStartRuntime);
				sinon.assert.notCalled(didStartRuntime);

				// If we start now, without session.start() rejecting, it should work.
				willStartSessionDisposable.dispose();
				const session2 = await start(runtime);

				const isNotebookWithFailedSessionInMap =
					mode === LanguageRuntimeSessionMode.Notebook &&
					(action === 'start' || action === 'restore');

				if (action === 'select' || action === 'restore' || isNotebookWithFailedSessionInMap) {
					// Selecting/restoring the same session multiple times overwrites the session in activeSessions.
					// TODO: Should this be the case for selecting?
					assertActiveSessions([session1]);

					if (isNotebookWithFailedSessionInMap) {
						expect(session1.sessionId).toBe(session2.sessionId);
						expect(session2.getRuntimeState()).toBe(RuntimeState.Uninitialized);
						assertNotebookSessionForNotebookUri(notebookUri, session1);
					} else {
						assertCurrentSession(runtime, notebookUri, session2);
						expect(session2.getRuntimeState()).toBe(RuntimeState.Starting);
					}
				} else {
					assertActiveSessions([session1, session2]);
					assertCurrentSession(runtime, notebookUri, session2);
					expect(session2.getRuntimeState()).toBe(RuntimeState.Starting);
				}
			});

			it(`${action} ${mode} concurrently encounters session.start() error`, async () => {
				// TODO: Post multisession, concurrently restoring console sessions has undefined behavior.
				if ((action === 'restore' && mode === LanguageRuntimeSessionMode.Console)) {
					return; // skip - not applicable for this action/mode combination
				}
				// Listen to the onWillStartSession event and stub session.start() to throw an error.
				const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
					sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
				});
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				// Start twice concurrently. Both should error.
				await Promise.all([
					expect(start(runtime)).rejects.toThrow(),
					expect(start(runtime)).rejects.toThrow(),
				]);
			});

			if (mode === LanguageRuntimeSessionMode.Notebook) {
				it(`${action} ${mode} throws if another runtime is starting for the language`, async () => {
					const error = new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
						`be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already starting for the notebook ${notebookUri.toString()}.`
						+ (action !== 'restore' ? ` Request source: ${startReason}` : ''));

					await expect(Promise.all([
						start(runtime),
						start(anotherRuntime),
					])).rejects.toThrow(error.message);
				});

				it(`${action} ${mode} throws if another runtime is running for the language`, async () => {
					const error = new Error(`A notebook for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
						`be started because a notebook for ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already running for the URI ${notebookUri.toString()}.` +
						(action !== 'restore' ? ` Request source: ${startReason}` : ''));

					await start(runtime);
					await expect(start(anotherRuntime)).rejects.toThrow(error.message);
				});
			}

			it(`${action} ${mode} successively`, async () => {
				const session1 = await start(runtime);
				const session2 = await start(runtime);
				const session3 = await start(runtime);

				if (mode === LanguageRuntimeSessionMode.Notebook
					// Restoring/selecting a console any number of times should return the same session.
					|| (mode === LanguageRuntimeSessionMode.Console
						&& (action === 'restore' || action === 'select'))) {
					expect(session1.sessionId).toBe(session2.sessionId);
					expect(session2.sessionId).toBe(session3.sessionId);

					assertActiveSessions([session1]);
					assertCurrentSession(runtime, notebookUri, session1);
					expect(session1.getRuntimeState()).toBe(RuntimeState.Starting);
				} else if (mode === LanguageRuntimeSessionMode.Console) {
					expect(session1.sessionId).not.toBe(session2.sessionId);
					expect(session2.sessionId).not.toBe(session3.sessionId);

					assertActiveSessions([session1, session2, session3]);
					assertCurrentSession(runtime, notebookUri, session3);
					expect(session1.getRuntimeState()).toBe(RuntimeState.Starting);
					expect(session2.getRuntimeState()).toBe(RuntimeState.Starting);
					expect(session3.getRuntimeState()).toBe(RuntimeState.Starting);
				}
			});

			it(`${action} ${mode} concurrently`, async () => {
				// TODO: Post multisession, concurrently restoring console sessions has undefined behavior.
				if ((action === 'restore' && mode === LanguageRuntimeSessionMode.Console)) {
					return; // skip - not applicable for this action/mode combination
				}
				const [session1, session2, session3] = await Promise.all([start(runtime), start(runtime), start(runtime)]);

				expect(session1.sessionId).toBe(session2.sessionId);
				expect(session2.sessionId).toBe(session3.sessionId);

				assertActiveSessions([session1]);
				assertCurrentSession(runtime, notebookUri, session1);
				expect(session1.getRuntimeState()).toBe(RuntimeState.Starting);
			});

			if (mode === LanguageRuntimeSessionMode.Console) {
				it(`${action} console concurrently with no session manager for runtime (#5615)`, async () => {
					sinon.stub(manager, 'managesRuntime').resolves(false);

					// Start twice concurrently.
					const promise1 = start(runtime);
					const promise2 = start(runtime);

					// Both promises should reject.
					// This was not previously the case since the second call returns a deferred
					// promise that does not necessarily resolve/reject with the first call.
					await expect(promise1).rejects.toThrow();
					await expect(promise2).rejects.toThrow();
				});
			}
		}

		if (startNotebook) {
			it(`${action} console and notebook from the same runtime concurrently`, async () => {
				// Consoles and notebooks shouldn't interfere with each other, even for the same runtime.
				const [consoleSession, notebookSession] = await Promise.all([
					startConsole(runtime),
					startNotebook(runtime),
				]);

				expect(consoleSession.getRuntimeState()).toBe(RuntimeState.Starting);
				expect(notebookSession.getRuntimeState()).toBe(RuntimeState.Starting);

				assertActiveSessions([consoleSession, notebookSession]);
				assertConsoleSessionForLanguage(runtime.languageId, consoleSession);
				assertConsoleSessionForRuntime(runtime.runtimeId, consoleSession);
				assertHasStartingOrRunningConsole(true);
				assertNotebookSessionForNotebookUri(notebookUri, notebookSession);
			});
		}
	}

	it(`start notebook without notebook uri`, async () => {
		await expect(
			startSession(runtime, LanguageRuntimeSessionMode.Notebook, undefined),
		).rejects.toThrow('A notebook URI must be provided when starting a notebook session.');
	});

	it('restore console registers runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toBe(undefined);

		await restoreConsole(unregisteredRuntime);

		// The runtime should now be registered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toBe(unregisteredRuntime);
	});

	it('auto start validates runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toBe(undefined);

		// Update the validator to add extra runtime data.
		const validatedMetadata: Partial<ILanguageRuntimeMetadata> = {
			extraRuntimeData: { someNewKey: 'someNewValue' }
		};
		manager.setValidateMetadata(async (metadata: ILanguageRuntimeMetadata) => {
			return { ...metadata, ...validatedMetadata };
		});

		await autoStartSession(unregisteredRuntime);

		// The validated metadata should now be registered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toEqual({ ...unregisteredRuntime, ...validatedMetadata });
	});

	it('auto start throws if runtime validation errors', async () => {
		// The runtime should not yet be registered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toBe(undefined);

		// Update the validator to throw.
		const error = new Error('Failed to validate runtime metadata');
		manager.setValidateMetadata(async (_metadata: ILanguageRuntimeMetadata) => {
			throw error;
		});

		await expect(autoStartSession(unregisteredRuntime)).rejects.toThrow(error.message);

		// The runtime should remain unregistered.
		expect(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId)).toBe(undefined);
	});

	it('auto start console does nothing if automatic startup is disabled', async () => {
		configService.setUserConfiguration('interpreters.startupBehavior', LanguageStartupBehavior.Disabled);

		const sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason, true);

		expect(sessionId).toBe('');

		assertActiveSessions([]);
		assertHasStartingOrRunningConsole(false);
		assertConsoleSessionForLanguage(runtime.languageId, undefined);
		assertConsoleSessionForRuntime(runtime.runtimeId, undefined);
		assertNotebookSessionForNotebookUri(notebookUri, undefined);
	});

	for (const action of ['auto start', 'start']) {
		it(`${action} console in an untrusted workspace defers until trust is granted`, async () => {
			workspaceTrustManagementService.setWorkspaceTrust(false);

			let sessionId: string;
			if (action === 'auto start') {
				sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason, true);
			} else {
				sessionId = await runtimeSessionService.startNewRuntimeSession(
					runtime.runtimeId, sessionName, LanguageRuntimeSessionMode.Console, undefined, startReason, RuntimeStartMode.Starting, true);
			}

			expect(sessionId).toBe('');

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
			expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
		});
	}

	it('start notebook in an untrusted workspace throws', async () => {
		workspaceTrustManagementService.setWorkspaceTrust(false);

		await expect(startNotebook(runtime)).rejects.toThrow(new Error('Cannot start a notebook session in an untrusted workspace.').message);
	});

	for (const state of [RuntimeState.Exited, RuntimeState.Uninitialized]) {
		// TODO: This test fails because the console session for the runtime is undefined.
		//       This is because selecting the runtime exits early if a session already
		//       exists for the runtime, even if the session is exited or uninitialized.
		//       Is that the expected behavior?
		it.skip(`select console in '${state}' state`, async () => {
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
			expect(session.getRuntimeState()).toBe(RuntimeState.Starting);
		});
	}

	it('select console while another runtime is running for the language', async () => {
		const session1 = await startConsole(anotherRuntime);
		await waitForRuntimeState(session1, RuntimeState.Ready);
		const session2 = await selectRuntime(runtime);

		expect(session1.sessionId).not.toBe(session2.sessionId);

		assertActiveSessions([session1, session2]);
		assertConsoleSessionForLanguage(runtime.languageId, session2);
		assertConsoleSessionForRuntime(runtime.runtimeId, session2);
		assertConsoleSessionForRuntime(anotherRuntime.runtimeId, session1);
		assertHasStartingOrRunningConsole(true);
		expect(session1.getRuntimeState()).toBe(RuntimeState.Ready);
		expect(session2.getRuntimeState()).toBe(RuntimeState.Starting);
	});

	it('select console while another runtime is starting for the language', async () => {
		const [session1, session2] = await Promise.all([
			startConsole(anotherRuntime),
			selectRuntime(runtime),
		]);
		expect(session1.sessionId).not.toBe(session2.sessionId);

		assertActiveSessions([session1, session2]);
		assertConsoleSessionForLanguage(runtime.languageId, session2);
		assertConsoleSessionForRuntime(runtime.runtimeId, session2);
		assertConsoleSessionForRuntime(anotherRuntime.runtimeId, session1);
		assertHasStartingOrRunningConsole(true);
		expect(session1.getRuntimeState()).toBe(RuntimeState.Starting);
		expect(session2.getRuntimeState()).toBe(RuntimeState.Starting);
	});

	it('select console to the same runtime sets the foreground session', async () => {
		const session1 = await startConsole(runtime);

		runtimeSessionService.foregroundSession = undefined;

		const session2 = await selectRuntime(runtime);

		expect(session1).toBe(session2);
		expect(runtimeSessionService.foregroundSession).toBe(session1);
	});

	function restartSession(sessionId: string) {
		return runtimeSessionService.restartSession(sessionId, startReason, false);
	}

	for (const { mode, start } of [
		{ mode: LanguageRuntimeSessionMode.Console, start: startConsole },
		{ mode: LanguageRuntimeSessionMode.Notebook, start: startNotebook },
	]) {
		it(`restart ${mode} throws if session not found`, async () => {
			const sessionId = 'unknown-session-id';
			await expect(
				restartSession(sessionId),
			).rejects.toThrow(`No session with ID '${sessionId}' was found.`);
		});

		for (const state of [RuntimeState.Busy, RuntimeState.Idle, RuntimeState.Ready, RuntimeState.Exited]) {
			it(`restart ${mode} in '${state}' state`, async () => {
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
				expect(session.getRuntimeState()).toBe(RuntimeState.Ready);

				sinon.assert.calledOnceWithMatch(willStartSession, {
					session,
					startMode: RuntimeStartMode.Restarting,
					hasConsole: mode === LanguageRuntimeSessionMode.Console,
					activate: false
				});
			});

			it(`restart ${mode} in '${state}' state encounters session.restart() error`, async () => {
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
				await expect(restartSession(session.sessionId)).rejects.toThrow();

				// The session's state should not have changed.
				expect(session.getRuntimeState()).toBe(state);

				// If we restart now, without session.restart() rejecting, it should work.
				restartStub.restore();
				await restartSession(session.sessionId);

				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				expect(session.getRuntimeState()).toBe(RuntimeState.Ready);
			});

			it(`restart ${mode} in '${state}' state and session never reaches ready state`, async () => {
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
				const promise = expect(restartSession(session.sessionId)).rejects.toThrow(
					`Timed out waiting for runtime ${formatLanguageRuntimeSession(session)} to be 'ready'.`
				);
				await clock.tickAsync(10_000);
				await promise;
			});
		}

		it(`restart ${mode} in 'uninitialized' state`, async () => {
			// Get a session to the uninitialized state.
			const state = RuntimeState.Uninitialized;

			// Set up console configuration for consistent test behavior
			configService.setUserConfiguration('console.showNotebookConsoles', false);

			const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
				sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
			});
			const willStartSessionDisposable = runtimeSessionService.onWillStartSession(willStartSession);

			await expect(start(runtime)).rejects.toThrow(new Error('Session failed to start').message);

			expect(runtimeSessionService.activeSessions.length).toBe(1);
			const session = runtimeSessionService.activeSessions[0];
			disposables.add(session);

			expect(session.getRuntimeState()).toBe(state);

			// Set the state to the desired state.
			willStartSessionDisposable.dispose();

			const willStartSession2 = sinon.spy();
			disposables.add(
				runtimeSessionService.onWillStartSession(willStartSession2)
			);

			await restartSession(session.sessionId);

			if (mode === LanguageRuntimeSessionMode.Notebook) {
				expect(session.getRuntimeState()).toBe(state);
				sinon.assert.notCalled(willStartSession2);
				assertActiveSessions([session]);
				assertNotebookSessionForNotebookUri(notebookUri, session);
			} else {
				// The existing session should remain in uninitialized state.
				expect(session.getRuntimeState()).toBe(state);

				// A new session should be starting.
				const newSession = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId);
				expect(newSession).toBeTruthy();
				disposables.add(newSession);

				sinon.assert.calledOnce(willStartSession2);
				const event = willStartSession2.getCall(0).args[0];
				expect(event.session).toBe(newSession);
				// Since we restarted from an uninitialized state, the start mode is 'starting'.
				expect(event.startMode).toBe(RuntimeStartMode.Starting);
				expect(event.hasConsole).toBe(true);
				expect(event.activate).toBe(true);

				expect(newSession.dynState.sessionName).toBe(session.dynState.sessionName);
				expect(newSession.metadata.sessionMode).toBe(session.metadata.sessionMode);
				expect(newSession.metadata.notebookUri).toBe(session.metadata.notebookUri);
				expect(newSession.runtimeMetadata).toBe(session.runtimeMetadata);

				assertActiveSessions([session, newSession]);
				assertCurrentSession(runtime, notebookUri, newSession);
				expect(newSession.getRuntimeState()).toBe(RuntimeState.Starting);
			}
		});

		it(`restart ${mode} in 'starting' state`, async () => {
			const session = await start(runtime);
			expect(session.getRuntimeState()).toBe(RuntimeState.Starting);

			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			expect(session.getRuntimeState()).toBe(RuntimeState.Ready);
		});

		it(`restart ${mode} in 'restarting' state`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			session.restart();
			expect(session.getRuntimeState()).toBe(RuntimeState.Restarting);

			const target = sinon.spy(session, 'restart');

			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			expect(session.getRuntimeState()).toBe(RuntimeState.Ready);

			sinon.assert.notCalled(target);
		});

		it(`restart ${mode} concurrently`, async () => {
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
			expect(session.getRuntimeState()).toBe(RuntimeState.Ready);

			sinon.assert.calledOnce(target);
		});

		it(`restart ${mode} successively`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const target = sinon.spy(session, 'restart');

			await restartSession(session.sessionId);
			await restartSession(session.sessionId);
			await restartSession(session.sessionId);

			assertActiveSessions([session]);
			assertCurrentSession(runtime, notebookUri, session);
			expect(session.getRuntimeState()).toBe(RuntimeState.Ready);

			sinon.assert.calledThrice(target);
		});

		it(`restart ${mode} while 'ready', then start successively`, async function () {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			await restartSession(session.sessionId);
			const newSession = await start(runtime);

			if (mode === LanguageRuntimeSessionMode.Notebook) {
				// The existing session for the notebook should be reused.
				expect(session.sessionId).toBe(newSession.sessionId);
				assertActiveSessions([session]);
				assertCurrentSession(runtime, notebookUri, session);
				expect(session.getRuntimeState()).toBe(RuntimeState.Ready);
			} else if (mode === LanguageRuntimeSessionMode.Console) {
				// A new console session should be created.
				expect(session.sessionId).not.toBe(newSession.sessionId);
				assertActiveSessions([session, newSession]);
				assertCurrentSession(runtime, notebookUri, newSession);
				expect(session.getRuntimeState()).toBe(RuntimeState.Ready);
				expect(newSession.getRuntimeState()).toBe(RuntimeState.Starting);
			}
		});

		it(`restart ${mode} while 'ready', then start concurrently`, async () => {
			const session = await start(runtime);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const [, newSession] = await Promise.all([restartSession(session.sessionId), start(runtime)]);

			// TODO: Perhaps a new console should be started in this case?
			// The existing session is reused.
			expect(session.sessionId).toBe(newSession.sessionId);
			assertActiveSessions([newSession]);
			assertCurrentSession(runtime, notebookUri, newSession);
			expect(newSession.getRuntimeState()).toBe(RuntimeState.Ready);
		});
	}

	async function shutdownNotebook() {
		await runtimeSessionService.shutdownNotebookSession(
			notebookUri, RuntimeExitReason.Shutdown, 'Test requested to shutdown a notebook',
		);
	}

	it('shutdown notebook', async () => {
		const session = await startNotebook(runtime);
		await waitForRuntimeState(session, RuntimeState.Ready);

		await shutdownNotebook();

		assertActiveSessions([session]);
		assertNotebookSessionForNotebookUri(notebookUri, session);
		expect(session.getRuntimeState()).toBe(RuntimeState.Exited);
	});

	it('select notebook while shutting down notebook', async () => {
		const session = await startNotebook(runtime);
		await waitForRuntimeState(session, RuntimeState.Ready);

		const [, selectedSession] = await Promise.all([
			shutdownNotebook(),
			selectRuntime(runtime, notebookUri),
		]);

		assertActiveSessions([session]);
		assertNotebookSessionForNotebookUri(notebookUri, session);
		expect(session.sessionId).toBe(selectedSession.sessionId);
		expect(session.getRuntimeState()).toBe(RuntimeState.Exited);
	});

	it('shutdown notebook while selecting notebook', async () => {
		const [session,] = await Promise.all([
			selectRuntime(runtime, notebookUri),
			shutdownNotebook(),
		]);

		assertActiveSessions([session]);
		assertNotebookSessionForNotebookUri(notebookUri, session);
		expect(session.getRuntimeState()).toBe(RuntimeState.Exited);
	});

	it(`only one UI comm is created`, async () => {
		// Create the session
		const session = await startConsole(runtime);

		// Wait for a tick to yield the thread (since comm creation is async)
		await timeout(0);

		// At this point, it should have exactly one UI comm
		const uiCommsBefore = await session.listClients(RuntimeClientType.Ui);
		expect(uiCommsBefore.length).toBe(1);

		// Put the session back into the Ready state. This typically triggers
		// the creation of the UI comm as a side effect, but since the UI comm
		// is already open, we shouldn't create another one.
		session.setRuntimeState(RuntimeState.Ready);

		// Wait for a tick to yield the thread (since comm creation is async)
		await timeout(0);

		// We should still have exactly one UI comm
		const uiCommsAfter = await session.listClients(RuntimeClientType.Ui);
		expect(uiCommsAfter.length).toBe(1);
	});

	it(`can set the working directory`, async () => {
		// Create the session
		const session = await startConsole(runtime);
		await timeout(0);

		const dir = '/foo/bar/baz';
		session.setWorkingDirectory(dir);

		expect(session.getWorkingDirectory()).toBe(dir);
	});

	it(`working directory sticks after a restart`, async () => {
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

		expect(session.getWorkingDirectory()).toBe(dir);
	});

	it('updateNotebookSessionUri updates URI mapping correctly', async () => {
		// Create an untitled notebook URI (simulating new untitled notebook)
		const untitledUri = URI.parse('untitled:notebook.ipynb');

		// Create a new URI (simulating saving the notebook to a file)
		const savedUri = URI.file('/path/to/saved/notebook.ipynb');

		// Start a notebook session with the untitled URI
		const session = await startSession(runtime, LanguageRuntimeSessionMode.Notebook, untitledUri);
		await timeout(0);

		// Ensure the session is retrievable with the untitled URI
		const sessionBeforeUpdate = runtimeSessionService.getNotebookSessionForNotebookUri(untitledUri);
		expect(sessionBeforeUpdate).toBe(session);

		// Update the session's URI
		const returnedSessionId = await runtimeSessionService.updateNotebookSessionUri(untitledUri, savedUri);

		// Verify returned sessionId matches the session's ID
		expect(returnedSessionId).toBe(session.sessionId);

		// Verify the session is no longer accessible via the old URI
		const oldUriSession = runtimeSessionService.getNotebookSessionForNotebookUri(untitledUri);
		expect(oldUriSession).toBe(undefined);

		// Verify the session is accessible via the new URI
		const newUriSession = runtimeSessionService.getNotebookSessionForNotebookUri(savedUri);
		expect(newUriSession).toBe(session);

		// Verify the working directory has not changed
		// This is the expected behavior because not all users want the working directory for the notebook session
		// to change automatically. There is a different process for updating the working directory
		expect(session.getWorkingDirectory()).toBe('');
	});

	it('updateNotebookSessionUri returns undefined when session not found', async () => {
		// Create URIs that don't have associated sessions
		const nonExistentUri = URI.file('/path/to/nonexistent/notebook.ipynb');
		const newUri = URI.file('/path/to/new/notebook.ipynb');

		// Attempt to update a non-existent session
		const returnedSessionId = await runtimeSessionService.updateNotebookSessionUri(nonExistentUri, newUri);

		// Verify no session ID is returned
		expect(returnedSessionId).toBe(undefined);
	});

	it('updateSessionName updates session name correctly', async () => {
		// Create a new session
		const session = await startConsole(runtime);
		const otherSession = await startConsole(runtime);

		await waitForRuntimeState(session, RuntimeState.Ready);
		await waitForRuntimeState(otherSession, RuntimeState.Ready);

		expect(session.dynState.sessionName).toBe(runtime.runtimeName);
		expect(otherSession.dynState.sessionName).toBe(runtime.runtimeName);

		// Set a new name for the session
		const newName = 'updated-session-name';
		runtimeSessionService.updateSessionName(session.sessionId, newName);

		// Verify the session's name has been updated
		expect(session.dynState.sessionName).toBe(newName);
		expect(otherSession.dynState.sessionName).toBe(runtime.runtimeName);
	});

	describe('Working Directory Configuration', () => {
		it('working directory is applied to notebook sessions when configured', async () => {
			const workingDir = '/custom/working/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(workingDir);
		});

		it('working directory is default for console sessions even when notebook working directory is configured', async () => {
			const workingDir = '/custom/working/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startConsole(runtime);

			expect(session.metadata.workingDirectory).toBe(undefined);
		});

		it('working directory is default when configuration is empty string', async () => {
			configService.setUserConfiguration(NotebookSetting.workingDirectory, '');

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(notebookParent);
		});

		it('working directory is default when configuration is whitespace only', async () => {
			configService.setUserConfiguration(NotebookSetting.workingDirectory, '   ');

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(notebookParent);
		});

		it('working directory supports variable resolution for notebook sessions', async () => {
			const workingDir = '/workspace/folder';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			// Create a mock that actually resolves variables
			const mockConfigResolver = configurationResolverService as any;
			mockConfigResolver.resolveAsync = sinon.stub().resolves('/resolved/workspace/folder');

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe('/resolved/workspace/folder');
			sinon.assert.calledOnce(mockConfigResolver.resolveAsync);
		});

		it('working directory falls back to default when resolution fails for notebook sessions', async () => {
			const workingDir = '/workspace/folder';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			// Create a mock that throws an error during resolution
			const mockConfigResolver = configurationResolverService as any;
			mockConfigResolver.resolveAsync = sinon.stub().rejects(new Error('Resolution failed'));

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(notebookParent);
			sinon.assert.calledOnce(mockConfigResolver.resolveAsync);
		});

		it('working directory falls back to default when it doesnt exist', async () => {
			const workingDir = '/non/existent/directory';
			configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir);

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(notebookParent);
		});

		it('working directory is resource-scoped for notebook sessions', async () => {
			const workingDir = '/notebook/specific/directory';
			await configService.setUserConfiguration(NotebookSetting.workingDirectory, workingDir, notebookUri);

			const session = await startNotebook(runtime);

			expect(session.metadata.workingDirectory).toBe(workingDir);
		});

		it('working directory differs between console and notebook sessions', async () => {
			const consoleWorkingDir = '/console/directory';
			const notebookWorkingDir = '/notebook/directory';

			await configService.setUserConfiguration(NotebookSetting.workingDirectory, consoleWorkingDir);
			await configService.setUserConfiguration(NotebookSetting.workingDirectory, notebookWorkingDir, notebookUri);

			const consoleSession = await startConsole(runtime);
			const notebookSession = await startNotebook(runtime);

			expect(consoleSession.metadata.workingDirectory).toBe(undefined);
			expect(notebookSession.metadata.workingDirectory).toBe(notebookWorkingDir);
		});
	});
});
