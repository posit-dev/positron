/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { formatLanguageRuntimeMetadata, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession, waitForRuntimeState } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { TestRuntimeSessionManager } from 'vs/workbench/test/common/positronWorkbenchTestServices';
import { TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';

type IStartSessionTask = (runtimeMetadata?: ILanguageRuntimeMetadata) => Promise<TestLanguageRuntimeSession>;

suite('Positron - RuntimeSessionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const startReason = 'Test requested to start a runtime session';
	const notebookUri = URI.file('/path/to/notebook');
	let instantiationService: TestInstantiationService;
	let languageRuntimeService: ILanguageRuntimeService;
	let runtimeSessionService: IRuntimeSessionService;
	let configService: TestConfigurationService;
	let workspaceTrustManagementService: TestWorkspaceTrustManagementService;
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
		manager = TestRuntimeSessionManager.instance;

		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		sessionName = runtime.runtimeName;
		unregisteredRuntime = { runtimeId: 'unregistered-runtime-id' } as ILanguageRuntimeMetadata;

		// Enable automatic startup.
		configService.setUserConfiguration('positron.interpreters.automaticStartup', true);

		// Trust the workspace.
		workspaceTrustManagementService.setWorkspaceTrust(true);
	});

	function startSession(
		runtimeMetadata = runtime,
		sessionMode: LanguageRuntimeSessionMode,
		notebookUri?: URI,
	) {
		return startTestLanguageRuntimeSession(
			instantiationService,
			disposables,
			{
				runtime: runtimeMetadata,
				sessionName,
				startReason,
				sessionMode,
				notebookUri,
			},
		);
	}

	function startConsole(runtimeMetadata?: ILanguageRuntimeMetadata) {
		return startSession(runtimeMetadata, LanguageRuntimeSessionMode.Console);
	}

	function startNotebook(runtimeMetadata?: ILanguageRuntimeMetadata, notebookUri_ = notebookUri) {
		return startSession(runtimeMetadata, LanguageRuntimeSessionMode.Notebook, notebookUri_);
	}

	interface IServiceState {
		hasStartingOrRunningConsole?: boolean;
		consoleSession?: ILanguageRuntimeSession;
		consoleSessionForLanguage?: ILanguageRuntimeSession;
		consoleSessionForRuntime?: ILanguageRuntimeSession;
		notebookSession?: ILanguageRuntimeSession;
		notebookSessionForNotebookUri?: ILanguageRuntimeSession;
		activeSessions?: ILanguageRuntimeSession[];
	}

	function assertServiceState(expectedState?: IServiceState, runtimeMetadata = runtime): void {
		// Check the active sessions.
		assert.deepEqual(runtimeSessionService.activeSessions, expectedState?.activeSessions ?? []);

		// Check the console session state.
		assert.equal(
			runtimeSessionService.hasStartingOrRunningConsole(runtimeMetadata.languageId),
			expectedState?.hasStartingOrRunningConsole ?? false,
			expectedState?.hasStartingOrRunningConsole ?
				'Expected a starting or running console session' :
				'Expected no starting or running console session',
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForLanguage(runtimeMetadata.languageId),
			expectedState?.consoleSessionForLanguage,
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForRuntime(runtimeMetadata.runtimeId),
			expectedState?.consoleSessionForRuntime,
		);
		assert.equal(
			runtimeSessionService.getSession(expectedState?.consoleSession?.sessionId ?? ''),
			expectedState?.consoleSession,
		);

		// Check the notebook session state.
		assert.equal(
			runtimeSessionService.getSession(expectedState?.notebookSession?.sessionId ?? ''),
			expectedState?.notebookSession,
		);
		assert.equal(
			runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri),
			expectedState?.notebookSessionForNotebookUri,
		);
	}

	function assertSingleSessionWillStart(sessionMode: LanguageRuntimeSessionMode) {
		if (sessionMode === LanguageRuntimeSessionMode.Console) {
			assertServiceState({ hasStartingOrRunningConsole: true });
		} else if (sessionMode === LanguageRuntimeSessionMode.Notebook) {
			assertServiceState();
		}
	}

	function assertHasSingleSession(session: ILanguageRuntimeSession) {
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			assertServiceState({
				hasStartingOrRunningConsole: true,
				consoleSession: session,
				consoleSessionForLanguage: session,
				consoleSessionForRuntime: session,
				activeSessions: [session],
			}, session.runtimeMetadata);
		} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			assertServiceState({
				notebookSession: session,
				notebookSessionForNotebookUri: session,
				activeSessions: [session],
			}, session.runtimeMetadata);
		}
	}

	function assertSingleSessionIsStarting(session: ILanguageRuntimeSession) {
		assertHasSingleSession(session);
		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	}

	function assertSingleSessionIsRestarting(session: ILanguageRuntimeSession) {
		assertHasSingleSession(session);
		assert.equal(session.getRuntimeState(), RuntimeState.Restarting);
	}

	function assertSingleSessionIsReady(session: ILanguageRuntimeSession) {
		assertHasSingleSession(session);
		assert.equal(session.getRuntimeState(), RuntimeState.Ready);
	}

	async function restoreSession(
		sessionMetadata: IRuntimeSessionMetadata, runtimeMetadata = runtime,
	) {
		await runtimeSessionService.restoreRuntimeSession(runtimeMetadata, sessionMetadata);

		// Ensure that the session gets disposed after the test.
		const session = runtimeSessionService.getSession(sessionMetadata.sessionId);
		assert.ok(session instanceof TestLanguageRuntimeSession);
		disposables.add(session);

		return session;
	}

	function restoreConsole(runtimeMetadata = runtime) {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId: 'test-console-session-id',
			sessionName,
			sessionMode: LanguageRuntimeSessionMode.Console,
			createdTimestamp: Date.now(),
			notebookUri: undefined,
			startReason,
		};
		return restoreSession(sessionMetadata, runtimeMetadata);
	}

	function restoreNotebook(runtimeMetadata = runtime) {
		const sessionMetadata: IRuntimeSessionMetadata = {
			sessionId: 'test-notebook-session-id',
			sessionName,
			sessionMode: LanguageRuntimeSessionMode.Notebook,
			createdTimestamp: Date.now(),
			notebookUri,
			startReason,
		};
		return restoreSession(sessionMetadata, runtimeMetadata);
	}

	async function autoStartSession(runtimeMetadata = runtime) {
		const sessionId = await runtimeSessionService.autoStartRuntime(runtimeMetadata, startReason);
		assert.ok(sessionId);
		const session = runtimeSessionService.getSession(sessionId);
		assert.ok(session instanceof TestLanguageRuntimeSession);
		disposables.add(session);
		return session;
	}

	async function selectRuntime(runtimeMetadata = runtime) {
		await runtimeSessionService.selectRuntime(runtimeMetadata.runtimeId, startReason);
		const session = runtimeSessionService.getConsoleSessionForRuntime(runtimeMetadata.runtimeId);
		assert.ok(session instanceof TestLanguageRuntimeSession);
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
				const session = await start();

				assert.equal(session.getRuntimeState(), RuntimeState.Starting);
				assert.equal(session.metadata.sessionName, sessionName);
				assert.equal(session.metadata.sessionMode, mode);
				assert.equal(session.metadata.startReason, startReason);
				assert.equal(session.runtimeMetadata, runtime);

				if (mode === LanguageRuntimeSessionMode.Console) {
					assert.equal(session.metadata.notebookUri, undefined);
				} else {
					assert.equal(session.metadata.notebookUri, notebookUri);
				}
			});

			test(`${action} ${mode} sets the expected service state`, async () => {
				// Check the initial state.
				assertServiceState();

				const promise = start();

				// Check the state before awaiting the promise.
				assertSingleSessionWillStart(mode);

				const session = await promise;

				// Check the state after awaiting the promise.
				assertSingleSessionIsStarting(session);
			});

			// TODO: Should onWillStartSession only fire once?
			//       It currently fires twice. Before the session is started and when the session
			//       enters the ready state.
			test(`${action} ${mode} fires onWillStartSession`, async () => {
				let error: Error | undefined;
				const target = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
					try {
						if (target.callCount > 1) {
							return;
						}
						assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);

						assertSingleSessionWillStart(mode);
					} catch (e) {
						error = e;
					}
				});
				disposables.add(runtimeSessionService.onWillStartSession(target));
				const session = await start();

				sinon.assert.calledTwice(target);
				// When restoring a session, the first event is fired with isNew: false.
				sinon.assert.calledWith(target.getCall(0), { isNew: action !== 'restore', session });
				sinon.assert.calledWith(target.getCall(1), { isNew: true, session });
				assert.ifError(error);
			});

			test(`${action} ${mode} fires onDidStartRuntime`, async () => {
				let error: Error | undefined;
				const target = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
					try {
						assert.equal(session.getRuntimeState(), RuntimeState.Starting);

						assertSingleSessionIsStarting(session);
					} catch (e) {
						error = e;
					}
				});
				disposables.add(runtimeSessionService.onDidStartRuntime(target));

				const session = await start();

				sinon.assert.calledOnceWithExactly(target, session);
				assert.ifError(error);
			});

			test(`${action} ${mode} fires events in order`, async () => {
				const willStartSession = sinon.spy();
				disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

				const didStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

				await start();

				sinon.assert.callOrder(willStartSession, didStartRuntime);
			});

			if (mode === LanguageRuntimeSessionMode.Console) {
				test(`${action} ${mode} sets foregroundSession`, async () => {
					const target = sinon.spy();
					disposables.add(runtimeSessionService.onDidChangeForegroundSession(target));

					const session = await start();

					assert.equal(runtimeSessionService.foregroundSession, session);

					await waitForRuntimeState(session, RuntimeState.Ready);

					// TODO: Feels a bit surprising that this isn't fired. It's because we set the private
					//       _foregroundSession property instead of the setter. When the 'ready' state is
					//       entered, we skip setting foregroundSession because it already matches the session.
					sinon.assert.notCalled(target);
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

				await assert.rejects(start(), error);

				// If we start now, without createOrRestoreMethod rejecting, it should work.
				stub.restore();
				const session = await start();

				assertSingleSessionIsStarting(session);
			});

			test(`${action} ${mode} encounters session.start() error`, async () => {
				// Listen to the onWillStartSession event and stub session.start() to throw an error.
				const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
					sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
				});
				const willStartSessionDisposable = runtimeSessionService.onWillStartSession(willStartSession);

				const didFailStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidFailStartRuntime(didFailStartRuntime));

				const didStartRuntime = sinon.spy();
				disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

				const session1 = await start();

				assert.equal(session1.getRuntimeState(), RuntimeState.Uninitialized);

				if (mode === LanguageRuntimeSessionMode.Console) {
					assertServiceState({
						hasStartingOrRunningConsole: false,
						// Note that getConsoleSessionForRuntime includes uninitialized sessions
						// but getConsoleSessionForLanguage does not.
						consoleSessionForLanguage: undefined,
						consoleSessionForRuntime: session1,
						activeSessions: [session1],
					});
				} else {
					assertServiceState({ activeSessions: [session1] });
				}

				sinon.assert.calledOnceWithExactly(didFailStartRuntime, session1);
				sinon.assert.callOrder(willStartSession, didFailStartRuntime);
				sinon.assert.notCalled(didStartRuntime);

				// If we start now, without session.start() rejecting, it should work.
				willStartSessionDisposable.dispose();
				const session2 = await start();

				assert.equal(session2.getRuntimeState(), RuntimeState.Starting);

				const expectedActiveSessions = action === 'restore' ?
					// Restoring a session twice overwrites the previous session in activeSessions.
					[session2] :
					// Other actions create a new session in activeSessions.
					[session1, session2];

				if (mode === LanguageRuntimeSessionMode.Console) {
					assertServiceState({
						hasStartingOrRunningConsole: true,
						consoleSession: session2,
						consoleSessionForLanguage: session2,
						consoleSessionForRuntime: session2,
						activeSessions: expectedActiveSessions,
					});
				} else {
					assertServiceState({
						notebookSession: session2,
						notebookSessionForNotebookUri: session2,
						activeSessions: expectedActiveSessions,
					});
				}
			});

			test(`${action} ${mode} throws if another runtime is starting for the language`, async () => {
				let error: Error;
				if (mode === LanguageRuntimeSessionMode.Console) {
					error = new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
						`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already starting for the language.`
						+ (action !== 'restore' ? ` Request source: ${startReason}` : ''));
				} else {
					error = new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
						`be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
						`is already starting for the notebook ${notebookUri.toString()}.`
						+ (action !== 'restore' ? ` Request source: ${startReason}` : ''));
				}

				await assert.rejects(
					Promise.all([
						start(),
						start(anotherRuntime),
					]),
					error);
			});

			// Skip for 'select' since selecting another runtime is expected in that case.
			if (action !== 'select') {
				test(`${action} ${mode} throws if another runtime is running for the language`, async () => {
					let error: Error;
					if (mode === LanguageRuntimeSessionMode.Console) {
						error = new Error(`A console for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
							`be started because a console for ${formatLanguageRuntimeMetadata(runtime)} ` +
							`is already running for the ${runtime.languageName} language.` +
							(action !== 'restore' ? ` Request source: ${startReason}` : ''));
					} else {
						error = new Error(`A notebook for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
							`be started because a notebook for ${formatLanguageRuntimeMetadata(runtime)} ` +
							`is already running for the URI ${notebookUri.toString()}.` +
							(action !== 'restore' ? ` Request source: ${startReason}` : ''));
					}

					await start();
					await assert.rejects(
						start(anotherRuntime),
						error,
					);
				});
			}

			test(`${action} ${mode} successively`, async () => {
				const result1 = await start();
				const result2 = await start();
				const result3 = await start();

				assert.equal(result1, result2);
				assert.equal(result2, result3);

				assertSingleSessionIsStarting(result1);
			});

			test(`${action} ${mode} concurrently`, async () => {
				const [result1, result2, result3] = await Promise.all([start(), start(), start()]);

				assert.equal(result1, result2);
				assert.equal(result2, result3);

				assertSingleSessionIsStarting(result1);
			});
		}

		if (startNotebook) {
			test(`${action} console and notebook from the same runtime concurrently`, async () => {
				// Consoles and notebooks shouldn't interfere with each other, even for the same runtime.
				const [consoleSession, notebookSession] = await Promise.all([
					startConsole(),
					startNotebook(),
				]);

				assert.equal(consoleSession.getRuntimeState(), RuntimeState.Starting);
				assert.equal(notebookSession.getRuntimeState(), RuntimeState.Starting);

				assertServiceState({
					hasStartingOrRunningConsole: true,
					consoleSession,
					consoleSessionForLanguage: consoleSession,
					consoleSessionForRuntime: consoleSession,
					notebookSession,
					notebookSessionForNotebookUri: notebookSession,
					activeSessions: [consoleSession, notebookSession],
				});
			});
		}
	}

	test(`start notebook without notebook uri`, async () => {
		await assert.rejects(
			startSession(undefined, LanguageRuntimeSessionMode.Notebook, undefined),
			new Error('A notebook URI must be provided when starting a notebook session.'),
		);
	});

	test('restore console registers runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		await restoreConsole(unregisteredRuntime);

		// The runtime should now be registered.
		assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), unregisteredRuntime);
	});

	test('auto start validates runtime if unregistered', async () => {
		// The runtime should not yet be registered.
		assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		// Update the validator to add extra runtime data.
		const validatedMetadata: Partial<ILanguageRuntimeMetadata> = {
			extraRuntimeData: { someNewKey: 'someNewValue' }
		};
		manager.setValidateMetadata(async (metadata: ILanguageRuntimeMetadata) => {
			return { ...metadata, ...validatedMetadata };
		});

		await autoStartSession(unregisteredRuntime);

		// The validated metadata should now be registered.
		assert.deepEqual(
			languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId),
			{ ...unregisteredRuntime, ...validatedMetadata }
		);
	});

	test('auto start throws if runtime validation errors', async () => {
		// The runtime should not yet be registered.
		assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

		// Update the validator to throw.
		const error = new Error('Failed to validate runtime metadata');
		manager.setValidateMetadata(async (_metadata: ILanguageRuntimeMetadata) => {
			throw error;
		});

		await assert.rejects(autoStartSession(unregisteredRuntime), error);

		// The runtime should remain unregistered.
		assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);
	});

	test('auto start console does nothing if automatic startup is disabled', async () => {
		configService.setUserConfiguration('positron.interpreters.automaticStartup', false);

		const sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason);

		assert.equal(sessionId, '');
		assertServiceState();
	});

	for (const action of ['auto start', 'start']) {
		test(`${action} console in an untrusted workspace defers until trust is granted`, async () => {
			workspaceTrustManagementService.setWorkspaceTrust(false);

			let sessionId: string;
			if (action === 'auto start') {
				sessionId = await runtimeSessionService.autoStartRuntime(runtime, startReason);
			} else {
				sessionId = await runtimeSessionService.startNewRuntimeSession(
					runtime.runtimeId, sessionName, LanguageRuntimeSessionMode.Console, undefined, startReason);
			}

			assert.equal(sessionId, '');
			assertServiceState();

			workspaceTrustManagementService.setWorkspaceTrust(true);

			// The session should eventually start.
			const session = await Event.toPromise(runtimeSessionService.onDidStartRuntime);
			disposables.add(session);

			assertSingleSessionIsStarting(session);
		});
	}

	test('start notebook in an untrusted workspace throws', async () => {
		workspaceTrustManagementService.setWorkspaceTrust(false);

		await assert.rejects(startNotebook(), new Error('Cannot start a notebook session in an untrusted workspace.'));
	});

	test('select console while another runtime is running for the language', async () => {
		const session1 = await startConsole(anotherRuntime);
		await waitForRuntimeState(session1, RuntimeState.Ready);
		const session2 = await selectRuntime();

		assert.equal(session1.getRuntimeState(), RuntimeState.Exited);
		assert.equal(session2.getRuntimeState(), RuntimeState.Starting);

		assertServiceState({
			hasStartingOrRunningConsole: true,
			consoleSession: session2,
			consoleSessionForLanguage: session2,
			consoleSessionForRuntime: session2,
			activeSessions: [session1, session2],
		});
	});

	test('select console throws if session is still starting', async () => {
		await startConsole(anotherRuntime);
		await assert.rejects(
			selectRuntime(),
			new Error('Cannot shut down kernel; it is not (yet) running. (state = starting)'),
		);
	});

	test('select console to the same runtime sets the foreground session', async () => {
		const session1 = await startConsole();

		runtimeSessionService.foregroundSession = undefined;

		const session2 = await selectRuntime();

		assert.equal(session1, session2);
		assert.equal(runtimeSessionService.foregroundSession, session1);
	});

	function restartSession(sessionId: string) {
		return runtimeSessionService.restartSession(sessionId, startReason);
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

		for (const state of [RuntimeState.Busy, RuntimeState.Idle, RuntimeState.Ready]) {
			test(`restart ${mode} in '${state}' state`, async () => {
				// Start the session and wait for it to be ready.
				const session = await start();
				await waitForRuntimeState(session, RuntimeState.Ready);

				// Set the state to the desired state.
				if (session.getRuntimeState() !== state) {
					session.setRuntimeState(state);
				}

				await restartSession(session.sessionId);

				assert.equal(session.getRuntimeState(), RuntimeState.Restarting);
				assertSingleSessionIsRestarting(session);

				await waitForRuntimeState(session, RuntimeState.Ready);
				assertSingleSessionIsReady(session);
			});
		}

		for (const state of [RuntimeState.Uninitialized, RuntimeState.Exited]) {
			test(`restart ${mode} in '${state}' state`, async () => {
				// Get a session to the exited state.
				const session = await start();
				await waitForRuntimeState(session, RuntimeState.Ready);
				await session.shutdown(RuntimeExitReason.Shutdown);
				await waitForRuntimeState(session, RuntimeState.Exited);

				await restartSession(session.sessionId);

				// The existing sessino should remain exited.
				assert.equal(session.getRuntimeState(), RuntimeState.Exited);

				// A new session should be starting.
				let newSession: ILanguageRuntimeSession | undefined;
				if (mode === LanguageRuntimeSessionMode.Console) {
					newSession = runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId);
				} else {
					newSession = runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri);
				}
				assert.ok(newSession);
				disposables.add(newSession);

				assert.equal(newSession.getRuntimeState(), RuntimeState.Starting);
				assert.equal(newSession.metadata.sessionName, session.metadata.sessionName);
				assert.equal(newSession.metadata.sessionMode, session.metadata.sessionMode);
				assert.equal(newSession.metadata.notebookUri, session.metadata.notebookUri);
				assert.equal(newSession.runtimeMetadata, session.runtimeMetadata);

				if (mode === LanguageRuntimeSessionMode.Console) {
					assertServiceState({
						hasStartingOrRunningConsole: true,
						consoleSession: newSession,
						consoleSessionForLanguage: newSession,
						consoleSessionForRuntime: newSession,
						activeSessions: [session, newSession],
					});
				} else {
					assertServiceState({
						notebookSession: newSession,
						notebookSessionForNotebookUri: newSession,
						activeSessions: [session, newSession],
					});
				}
			});
		}

		test(`restart ${mode} in 'starting' state`, async () => {
			const session = await start();
			assert.equal(session.getRuntimeState(), RuntimeState.Starting);

			await restartSession(session.sessionId);

			assertSingleSessionIsStarting(session);
		});

		test(`restart ${mode} in 'restarting' state`, async () => {
			const session = await start();
			await waitForRuntimeState(session, RuntimeState.Ready);

			session.restart();
			assert.equal(session.getRuntimeState(), RuntimeState.Restarting);

			const target = sinon.spy(session, 'restart');

			await restartSession(session.sessionId);

			assertSingleSessionIsRestarting(session);

			sinon.assert.notCalled(target);
		});

		test(`restart ${mode} concurrently`, async () => {
			const session = await start();
			await waitForRuntimeState(session, RuntimeState.Ready);

			const target = sinon.spy(session, 'restart');

			await Promise.all([
				restartSession(session.sessionId),
				restartSession(session.sessionId),
				restartSession(session.sessionId),
			]);

			assertSingleSessionIsRestarting(session);

			sinon.assert.calledOnce(target);
		});

		test(`restart ${mode} successively`, async () => {
			const session = await start();

			const target = sinon.spy(session, 'restart');

			await waitForRuntimeState(session, RuntimeState.Ready);
			await restartSession(session.sessionId);
			await waitForRuntimeState(session, RuntimeState.Ready);
			await restartSession(session.sessionId);
			await waitForRuntimeState(session, RuntimeState.Ready);
			await restartSession(session.sessionId);

			assertSingleSessionIsRestarting(session);

			sinon.assert.calledThrice(target);
		});

		test(`restart ${mode} while ready -> start`, async () => {
			const session = await start();
			await waitForRuntimeState(session, RuntimeState.Ready);

			await restartSession(session.sessionId);
			await waitForRuntimeState(session, RuntimeState.Ready);

			const newSession = await start();

			assertSingleSessionIsReady(newSession);
		});
	}
});
