/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { CancellationError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
// import { formatLanguageRuntimeMetadata, ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeExitReason, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { formatLanguageRuntimeMetadata, ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionMode, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { createRuntimeServices, createTestLanguageRuntimeMetadata, startTestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';
import { TestRuntimeSessionManager } from 'vs/workbench/test/common/positronWorkbenchTestServices';
import { TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';

type IStartSessionTask = (runtimeMetadata?: ILanguageRuntimeMetadata) => Promise<TestLanguageRuntimeSession>;
type IValidator<T> = (obj: T) => void;

suite('Positron - RuntimeSessionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const sessionName = 'Test session';
	const startReason = 'Test requested to start a runtime session';
	const notebookUri = URI.file('/path/to/notebook');
	let instantiationService: TestInstantiationService;
	let languageRuntimeService: ILanguageRuntimeService;
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;
	let anotherRuntime: ILanguageRuntimeMetadata;
	let unregisteredRuntime: ILanguageRuntimeMetadata;

	setup(() => {
		instantiationService = disposables.add(new TestInstantiationService());
		createRuntimeServices(instantiationService, disposables);
		languageRuntimeService = instantiationService.get(ILanguageRuntimeService);
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		anotherRuntime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
		unregisteredRuntime = { runtimeId: 'unregistered-runtime-id' } as ILanguageRuntimeMetadata;
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
		notebookSession?: ILanguageRuntimeSession;
		notebookSessionForNotebookUri?: ILanguageRuntimeSession;
		activeSessions?: ILanguageRuntimeSession[];
	}

	function assertServiceState(expectedState?: IServiceState): void {
		// Check the console session state.
		assert.equal(
			runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId),
			expectedState?.hasStartingOrRunningConsole ?? false,
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId)?.sessionId,
			expectedState?.consoleSession?.sessionId,
		);
		assert.equal(
			runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId)?.sessionId,
			expectedState?.consoleSession?.sessionId,
		);
		assert.equal(
			runtimeSessionService.getSession(expectedState?.consoleSession?.sessionId ?? '')?.sessionId,
			expectedState?.consoleSession?.sessionId,
		);

		// Check the notebook session state.
		assert.equal(
			runtimeSessionService.getSession(expectedState?.notebookSession?.sessionId ?? '')?.sessionId,
			expectedState?.notebookSession?.sessionId,
		);
		assert.equal(
			runtimeSessionService.getNotebookSessionForNotebookUri(notebookUri)?.sessionId,
			expectedState?.notebookSessionForNotebookUri?.sessionId,
		);

		// Check the global state.
		assert.deepEqual(
			runtimeSessionService.activeSessions?.map(session => session.sessionId),
			expectedState?.activeSessions?.map(session => session?.sessionId) ??
			[expectedState?.consoleSession?.sessionId, expectedState?.notebookSession?.sessionId].filter(session => Boolean(session)),
		);
	}

	async function testCallSuccessively<T>(task: () => Promise<T>, validate: IValidator<T>) {
		const result1 = await task();
		const result2 = await task();
		const result3 = await task();

		assert.equal(result1, result2);
		assert.equal(result2, result3);

		validate(result1);
	}

	async function testCallConcurrently<T>(task: () => Promise<T>, validate: (obj: T) => void) {
		const [result1, result2, result3] = await Promise.all([task(), task(), task()]);

		assert.equal(result1, result2);
		assert.equal(result2, result3);

		validate(result1);
	}

	async function testStartSuccessively(start: IStartSessionTask) {
		await testCallSuccessively(start, (session) => assertSessionIsStarting(session));
	}

	async function testStartConcurrently(start: IStartSessionTask) {
		await testCallConcurrently(start, (session) => assertSessionIsStarting(session));
	}

	async function testStartConsoleWhileAnotherIsStarting(start: IStartSessionTask, source?: string) {
		await assert.rejects(
			Promise.all([
				start(),
				start(anotherRuntime),
			]),
			new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} ` +
				`cannot be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
				`is already starting for the language.`
				+ (source ? ` Request source: ${startReason}` : '')),
		);
	}

	async function testStartConsoleWhileAnotherIsRunning(start: IStartSessionTask, source?: string) {
		await start();
		await assert.rejects(
			start(anotherRuntime),
			new Error(`A console for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
				`be started because a console for ${formatLanguageRuntimeMetadata(runtime)} ` +
				`is already running for the ${runtime.languageName} language.` +
				(source ? ` Request source: ${startReason}` : '')),
		);
	}

	async function testStartNotebookWhileAnotherIsStarting(start: IStartSessionTask, source?: string) {
		await assert.rejects(
			Promise.all([
				start(),
				start(anotherRuntime),
			]),
			new Error(`Session for language runtime ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
				`be started because language runtime ${formatLanguageRuntimeMetadata(runtime)} ` +
				`is already starting for the notebook ${notebookUri.toString()}.`
				+ (source ? ` Request source: ${startReason}` : ''))
		);
	}

	async function testStartNotebookWhileAnotherIsRunning(start: IStartSessionTask, source?: string) {
		await start();
		await assert.rejects(
			start(anotherRuntime),
			new Error(`A notebook for ${formatLanguageRuntimeMetadata(anotherRuntime)} cannot ` +
				`be started because a notebook for ${formatLanguageRuntimeMetadata(runtime)} ` +
				`is already running for the URI ${notebookUri.toString()}.` +
				(source ? ` Request source: ${startReason}` : '')),
		);
	}

	async function testStartReturnsExpectedSession(start: IStartSessionTask) {
		const session = await start();

		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
		assert.equal(session.metadata.sessionName, sessionName);
		assert.equal(session.metadata.startReason, startReason);
		assert.equal(session.runtimeMetadata, runtime);

		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			assert.equal(session.metadata.notebookUri, undefined);
		} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			assert.equal(session.metadata.notebookUri, notebookUri);
		} else {
			throw new Error(`Unexpected session mode: ${session.metadata.sessionMode}`);
		}
	}

	async function testStartSetsExpectedServiceState(
		start: IStartSessionTask,
		verifyWhileStarting: () => void,
		verifyAfterStarted: (session: ILanguageRuntimeSession) => void,
	) {
		// Check the initial state.
		assertServiceState();

		const promise = start();

		// Check the state while starting.
		verifyWhileStarting();

		const session = await promise;

		// Check the state after starting.
		verifyAfterStarted(session);
	}

	function testStartConsoleSetsExpectedServiceState(start: IStartSessionTask) {
		return testStartSetsExpectedServiceState(
			start,
			() => assertServiceState({ hasStartingOrRunningConsole: true }),
			session => assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session }),
		);
	}

	function testStartNotebookSetsExpectedServiceState(start: IStartSessionTask) {
		return testStartSetsExpectedServiceState(
			start,
			() => assertServiceState(),
			session => assertServiceState({ notebookSession: session, notebookSessionForNotebookUri: session }),
		);
	}

	async function testStartFiresOnWillStartSession(start: IStartSessionTask, verify: () => void) {
		let error: Error | undefined;
		const target = sinon.spy(({ session }: IRuntimeSessionWillStartEvent) => {
			try {
				// TODO: Should onWillStartSession only fire once?
				if (target.callCount > 1) {
					return;
				}
				assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);
				verify();
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onWillStartSession(target));
		const session = await start();

		// TODO: Should onWillStartSession only fire once?
		sinon.assert.calledTwice(target);
		// TODO: isNew is false for restored sessions...
		sinon.assert.alwaysCalledWithExactly(target, { isNew: true, session });
		assert.ifError(error);
	}

	async function testStartFiresOnDidStartRuntime(
		start: IStartSessionTask,
		verify: (session: ILanguageRuntimeSession) => void,
	) {
		let error: Error | undefined;
		const target = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
			try {
				assert.equal(session.getRuntimeState(), RuntimeState.Starting);
				verify(session);
			} catch (e) {
				error = e;
			}
		});
		disposables.add(runtimeSessionService.onDidStartRuntime(target));

		const session = await start();

		sinon.assert.calledOnceWithExactly(target, session);
		assert.ifError(error);
	}

	async function testEncountersSessionStartError(
		start: IStartSessionTask,
		verify: (session: ILanguageRuntimeSession) => void,
	) {
		// Listen to the onWillStartSession event and stub session.start() to throw an error.
		const willStartSession = sinon.spy((e: IRuntimeSessionWillStartEvent) => {
			sinon.stub(e.session, 'start').rejects(new Error('Session failed to start'));
		});
		disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

		const didFailStartRuntime = sinon.spy();
		disposables.add(runtimeSessionService.onDidFailStartRuntime(didFailStartRuntime));

		const didStartRuntime = sinon.spy();
		disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

		const session = await start();

		assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);

		verify(session);

		sinon.assert.calledOnceWithExactly(didFailStartRuntime, session);
		sinon.assert.callOrder(willStartSession, didFailStartRuntime);
		sinon.assert.notCalled(didStartRuntime);
	}

	async function testStartFiresEventsInOrder(start: IStartSessionTask) {
		const willStartSession = sinon.spy();
		disposables.add(runtimeSessionService.onWillStartSession(willStartSession));

		const didStartRuntime = sinon.spy();
		disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntime));

		await start();

		sinon.assert.callOrder(willStartSession, didStartRuntime);
	}

	async function testStartUnknownRuntime(start: IStartSessionTask = startNotebook) {
		const runtimeId = 'unknown-runtime-id';
		await assert.rejects(
			start({ runtimeId } as ILanguageRuntimeMetadata,),
			new Error(`No language runtime with id '${runtimeId}' was found.`),
		);
	}

	function assertSessionIsStarting(session: ILanguageRuntimeSession) {
		if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Console) {
			assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session });
		} else if (session.metadata.sessionMode === LanguageRuntimeSessionMode.Notebook) {
			assertServiceState({ notebookSession: session, notebookSessionForNotebookUri: session });
		}
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

	function restoreConsole(runtimeMetadata?: ILanguageRuntimeMetadata) {
		return restoreSession(consoleSessionMetadata, runtimeMetadata);
	}

	function restoreNotebook(runtimeMetadata?: ILanguageRuntimeMetadata) {
		return restoreSession(notebookSessionMetadata, runtimeMetadata);
	}

	const consoleSessionMetadata: IRuntimeSessionMetadata = {
		sessionId: 'test-console-session-id',
		sessionName: 'Test console session',
		sessionMode: LanguageRuntimeSessionMode.Console,
		createdTimestamp: Date.now(),
		notebookUri: undefined,
		startReason,
	};

	const notebookSessionMetadata: IRuntimeSessionMetadata = {
		sessionId: 'test-notebook-session-id',
		sessionName: 'Test notebook session',
		sessionMode: LanguageRuntimeSessionMode.Notebook,
		createdTimestamp: Date.now(),
		notebookUri,
		startReason,
	};

	function createStartTests(
		startConsole: IStartSessionTask,
		startNotebook: IStartSessionTask | undefined,
		name: string,
		startReason?: string,
	) {
		test(`${name} console returns the expected session`, async () => {
			await testStartReturnsExpectedSession(startConsole);
		});

		test(`${name} console sets the expected service state`, async () => {
			await testStartConsoleSetsExpectedServiceState(startConsole);
		});

		test(`${name} console fires onWillStartSession`, async () => {
			await testStartFiresOnWillStartSession(
				startConsole,
				() => assertServiceState({ hasStartingOrRunningConsole: true }),
			);
		});

		test(`${name} console fires onDidStartRuntime`, async () => {
			await testStartFiresOnDidStartRuntime(
				startConsole,
				session => assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session }),
			);
		});

		test(`${name} console fires events in order`, async () => {
			await testStartFiresEventsInOrder(startConsole);
		});

		test(`${name} console sets foregroundSession`, async () => {
			const target = sinon.spy();
			disposables.add(runtimeSessionService.onDidChangeForegroundSession(target));

			const session = await startConsole();

			assert.equal(runtimeSessionService.foregroundSession, session);

			await waitForRuntimeState(session, RuntimeState.Ready);

			// TODO: Feels a bit surprising that this isn't fired. It's because we set the private
			//       _foregroundSession property instead of the setter. When the 'ready' state is
			//       entered, we skip setting foregroundSession because it already matches the session.
			sinon.assert.notCalled(target);
		});

		test(`${name} console encounters session.start() error`, async () => {
			await testEncountersSessionStartError(
				startConsole,
				session => {
					// TODO: Seems unexpected that some of these are defined and others not.
					assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), false);
					assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), undefined);
					assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), session);
					assert.equal(runtimeSessionService.getSession(session.sessionId), session);
					assert.deepEqual(runtimeSessionService.activeSessions, [session]);
				}
			);
		});

		test(`${name} console while another runtime is starting for the language`, async () => {
			await testStartConsoleWhileAnotherIsStarting(startConsole, startReason);
		});

		test(`${name} console while another runtime is running for the language`, async () => {
			await testStartConsoleWhileAnotherIsRunning(startConsole, startReason);
		});

		test(`${name} console successively`, async () => {
			await testStartSuccessively(startConsole);
		});

		test(`${name} console concurrently`, async () => {
			await testStartConcurrently(startConsole);
		});

		if (!startNotebook) {
			return;
		}

		test(`${name} notebook returns the expected session`, async () => {
			await testStartReturnsExpectedSession(startNotebook);
		});

		test(`${name} notebook sets the expected service state`, async () => {
			await testStartNotebookSetsExpectedServiceState(startNotebook);
		});

		test.skip(`${name} notebook fires onWillStartSession`, async () => {
			await testStartFiresOnWillStartSession(
				startNotebook,
				() => assertServiceState(),
			);
		});

		test(`${name} notebook fires onDidStartRuntime`, async () => {
			await testStartFiresOnDidStartRuntime(
				startNotebook,
				session => assertSessionIsStarting(session),
			);
		});

		test(`${name} notebook fires events in order`, async () => {
			await testStartFiresEventsInOrder(startNotebook);
		});

		test(`${name} notebook without notebook uri`, async () => {
			await assert.rejects(
				startSession(undefined, LanguageRuntimeSessionMode.Notebook, undefined),
				new Error('A notebook URI must be provided when starting a notebook session.'),
			);
		});

		test(`${name} notebook encounters session.start() error`, async () => {
			await testEncountersSessionStartError(
				startNotebook,
				session => {
					// TODO: Should failed notebook sessions be included in activeSessions?
					assertServiceState({ activeSessions: [session] });
				},
			);
		});

		test(`${name} console and notebook from the same runtime concurrently`, async () => {
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
				notebookSession,
				notebookSessionForNotebookUri: notebookSession,
				activeSessions: [consoleSession, notebookSession],
			});
		});

		test(`${name} notebook while another runtime is starting for the notebook`, async () => {
			await testStartNotebookWhileAnotherIsStarting(startNotebook, startReason);
		});

		test(`${name} notebook while another runtime is running for the notebook`, async () => {
			await testStartNotebookWhileAnotherIsRunning(startNotebook, startReason);
		});

		test(`${name} notebook successively`, async () => {
			await testStartSuccessively(startNotebook);
		});

		test(`${name} notebook concurrently`, async () => {
			await testStartConcurrently(startNotebook);
		});
	}

	suite('startNewRuntimeSession', () => {
		createStartTests(startConsole, startNotebook, 'start', startReason);

		test('start console for unknown runtime', async () => {
			await testStartUnknownRuntime(startConsole);
		});

		test('start notebook for unknown runtime', async () => {
			await testStartUnknownRuntime(startNotebook);
		});

	});

	suite('restoreRuntimeSession', () => {
		createStartTests(restoreConsole, restoreNotebook, 'restore', undefined);

		test('restore console registers runtime if unregistered', async () => {
			// The runtime should not yet be registered.
			assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

			await restoreConsole(unregisteredRuntime);

			// The runtime should now be registered.
			assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), unregisteredRuntime);
		});
	});

	suite('autoStartRuntime', () => {
		async function autoStartSession(runtimeMetadata = runtime) {
			const sessionId = await runtimeSessionService.autoStartRuntime(runtimeMetadata, 'Test requested to auto-start a runtime');
			if (!sessionId) {
				return undefined;
			}
			const session = runtimeSessionService.getSession(sessionId);
			assert.ok(session);
			disposables.add(session);
			return session;
		}

		let configService: TestConfigurationService;
		let workspaceTrustManagementService: TestWorkspaceTrustManagementService;
		let manager: TestRuntimeSessionManager;

		setup(() => {
			configService = instantiationService.get(IConfigurationService) as TestConfigurationService;
			workspaceTrustManagementService = instantiationService.get(IWorkspaceTrustManagementService) as TestWorkspaceTrustManagementService;
			manager = TestRuntimeSessionManager.instance;

			// Enable automatic startup.
			configService.setUserConfiguration('positron.interpreters.automaticStartup', true);

			// Trust the workspace.
			workspaceTrustManagementService.setWorkspaceTrust(true);
		});

		test('auto start console in a trusted workspace', async () => {
			const promise = autoStartSession();

			assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), false);

			const session = await promise;

			// TODO: Do we need this? It's the same as starting a session.
			assert.ok(session);
			assert.equal(session.getRuntimeState(), RuntimeState.Starting);
			assert.equal(session.metadata.sessionName, runtime.runtimeName);
			assert.equal(session.metadata.sessionMode, LanguageRuntimeSessionMode.Console);
			assert.equal(session.metadata.startReason, 'Test requested to auto-start a runtime');
			assert.equal(session.runtimeMetadata, runtime);
		});

		// TODO: Should auto starting a notebook error?

		test('auto start validates runtime if unregistered', async () => {
			// The runtime should not yet be registered.
			assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

			manager.setValidateMetadata(async (metadata: ILanguageRuntimeMetadata) => {
				return { ...metadata, extraRuntimeData: { someNewKey: 'someNewValue' } };
			});

			await autoStartSession(unregisteredRuntime);

			// The *validated* runtime should now be registered.
			assert.deepEqual(
				languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId),
				{ ...unregisteredRuntime, extraRuntimeData: { someNewKey: 'someNewValue' } }
			);
		});

		test('auto start encounters runtime validation error', async () => {
			// The runtime should not yet be registered.
			assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);

			const error = new Error('Failed to validate runtime metadata');
			manager.setValidateMetadata(async (metadata: ILanguageRuntimeMetadata) => {
				throw error;
			});

			await assert.rejects(autoStartSession(unregisteredRuntime), error);

			// The runtime should still not be registered.
			assert.equal(languageRuntimeService.getRegisteredRuntime(unregisteredRuntime.runtimeId), undefined);
		});

		test('auto start console does nothing if automatic startup is disabled', async () => {
			configService.setUserConfiguration('positron.interpreters.automaticStartup', false);

			const session = await autoStartSession();
			assert.equal(session, undefined);

			// TODO: Do we also need to check the session state?
		});

		test('auto start console in an untrusted workspace starts when trust is granted', async () => {
			workspaceTrustManagementService.setWorkspaceTrust(false);

			const sessionId = await runtimeSessionService.autoStartRuntime(runtime, 'Test requested to auto-start a runtime');
			assert.equal(sessionId, '');

			workspaceTrustManagementService.setWorkspaceTrust(true);

			await new Promise<void>(resolve => {
				disposables.add(runtimeSessionService.onDidStartRuntime(session => {
					if (session.runtimeMetadata === runtime) {
						disposables.add(session);
						resolve();
					}
				}));
			});

			// TODO: We should probably check more things here?
		});
	});

	suite('selectRuntime', () => {
		const startReason = 'Test requested to select a runtime';

		async function selectRuntime(runtimeMetadata = runtime) {
			await runtimeSessionService.selectRuntime(runtimeMetadata.runtimeId, startReason);
			const session = runtimeSessionService.getConsoleSessionForRuntime(runtimeMetadata.runtimeId);
			assert.ok(session instanceof TestLanguageRuntimeSession);
			disposables.add(session);
			return session;
		}

		createStartTests(selectRuntime, undefined, 'select runtime', startReason);

		// test('select runtime', async () => {
		// 	await testStartConsoleSetsExpectedServiceState(selectRuntime);
		// });
	});

	// TODO: Check sessionManager validation...

	// TODO: If workspace is trusted,

	// suite('shutdownNotebookSession', () => {
	// 	test('shutdown notebook', async () => {
	// 		const session = await startNotebook();

	// 		await runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Exited);
	// 		// TODO: The session is in activeSessions and returned by getSession but not by
	// 		//       getNotebookSessionForNotebookUri. Is that correct? This is also the only reason
	// 		//       we need a notebookForNotebookUri parameter in assertServiceState.
	// 		assertServiceState({ notebookSession: session });
	// 	});

	// 	test('shutdown notebook without running runtime', async () => {
	// 		// It should not error, since it's already in the desired state.
	// 		await runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown);
	// 		assertServiceState();
	// 	});

	// 	test('shutdown notebook concurrently', async () => {
	// 		const session = await startNotebook();

	// 		await Promise.all([
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 		]);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Exited);
	// 	});

	// 	test('shutdown notebook while starting', async () => {
	// 		const [session,] = await Promise.all([
	// 			startNotebook(),
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 		]);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Exited);
	// 		assertServiceState({ notebookSession: session });
	// 	});
	// });


	// function restartSession(sessionId: string) {
	// 	return runtimeSessionService.restartSession(
	// 		sessionId, 'Test requested to restart a runtime session'
	// 	);
	// }

	// suite('restartSession', () => {
	// 	test('restart console in "ready" state', async () => {
	// 		const session = await startConsole();
	// 		await waitForRuntimeState(session, RuntimeState.Ready);

	// 		await restartSession(session.sessionId);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 	});

	// 	test('restart console in "starting" state', async () => {
	// 		const session = await startConsole();

	// 		await restartSession(session.sessionId);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 	});

	// 	test('restart console in "exited" state', async () => {
	// 		const session = await startConsole();
	// 		await session.shutdown(RuntimeExitReason.Shutdown);
	// 		await waitForRuntimeState(session, RuntimeState.Exited);

	// 		await restartSession(session.sessionId);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 	});

	// 	test('restart session with unknown session id', async () => {
	// 		const sessionId = 'unknown-session-id';
	// 		assert.rejects(
	// 			restartSession(sessionId),
	// 			new Error(`No session with ID '${sessionId}' was found.`),
	// 		);
	// 	});

	// 	test('restart console concurrently', async () => {
	// 		const session = await startConsole();
	// 		await waitForRuntimeState(session, RuntimeState.Ready);

	// 		const target = sinon.spy(session, 'restart');

	// 		await Promise.all([
	// 			restartSession(session.sessionId),
	// 			restartSession(session.sessionId),
	// 			restartSession(session.sessionId),
	// 		]);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 		assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session });

	// 		sinon.assert.calledOnce(target);
	// 	});

	// 	test('restart console successively', async () => {
	// 		const session = await startConsole();

	// 		const target = sinon.spy(session, 'restart');

	// 		await waitForRuntimeState(session, RuntimeState.Ready);
	// 		await restartSession(session.sessionId);
	// 		await waitForRuntimeState(session, RuntimeState.Ready);
	// 		await restartSession(session.sessionId);
	// 		await waitForRuntimeState(session, RuntimeState.Ready);
	// 		await restartSession(session.sessionId);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 		assertServiceState({ hasStartingOrRunningConsole: true, consoleSession: session });

	// 		sinon.assert.calledThrice(target);
	// 	});

	// });

	// suite('queuing', () => {
	// 	test(`${name} notebook while shutting down`, async () => {
	// 		const session1 = await startNotebook();

	// 		const [, session2,] = await Promise.all([
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 			startNotebook(),
	// 		]);

	// 		assert.equal(session1.getRuntimeState(), RuntimeState.Exited);
	// 		assert.equal(session2.getRuntimeState(), RuntimeState.Starting);
	// 		assertServiceState({
	// 			notebookSession: session2,
	// 			notebookSessionForNotebookUri: session2,
	// 			activeSessions: [session1, session2],
	// 		});
	// 	});

	// 	test(`${name} notebook while restarting and in "exited" state`, async () => {
	// 		const session = await startNotebook();
	// 		await waitForRuntimeState(session, RuntimeState.Ready);

	// 		const target = sinon.spy(session, 'restart');

	// 		const startPromise = new Promise<TestLanguageRuntimeSession>(resolve => {
	// 			const disposable = session.onDidChangeRuntimeState(state => {
	// 				if (state === RuntimeState.Exited) {
	// 					disposable.dispose();
	// 					resolve(startNotebook());
	// 				}
	// 			});
	// 		});

	// 		const [, session2,] = await Promise.all([
	// 			restartSession(session.sessionId),
	// 			startPromise,
	// 			// startNotebook(),
	// 		]);

	// 		assert.equal(session, session2);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 		assertServiceState({
	// 			notebookSession: session,
	// 			notebookSessionForNotebookUri: session,
	// 		});

	// 		sinon.assert.calledOnce(target);
	// 	});

	// 	test('restart notebook while shutting down', async () => {
	// 		const session = await startNotebook();

	// 		await Promise.all([
	// 			runtimeSessionService.shutdownNotebookSession(notebookUri, RuntimeExitReason.Shutdown),
	// 			restartSession(session.sessionId),
	// 		]);

	// 		assert.equal(session.getRuntimeState(), RuntimeState.Starting);
	// 		assertNotebookSessionIsStarted(session);
	// 	});

	// });
});

async function waitForRuntimeState(
	session: ILanguageRuntimeSession,
	state: RuntimeState,
	timeout = 10_000,
) {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			disposable.dispose();
			reject(new CancellationError());
		}, timeout);

		const disposable = session.onDidChangeRuntimeState(newState => {
			if (newState === state) {
				clearTimeout(timer);
				disposable.dispose();
				resolve();
			}
		});
	});
}
