/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILanguageRuntimeMetadata, LanguageRuntimeSessionMode, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { ILanguageRuntimeSession, IRuntimeSessionService, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { createRuntimeServices, createTestLanguageRuntimeMetadata } from 'vs/workbench/services/runtimeSession/test/common/testRuntimeSessionService';

suite('Positron - RuntimeSessionService', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	let runtimeSessionService: IRuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;

	setup(() => {
		const instantiationService = disposables.add(new TestInstantiationService());
		createRuntimeServices(instantiationService, disposables);
		runtimeSessionService = instantiationService.get(IRuntimeSessionService);
		runtime = createTestLanguageRuntimeMetadata(instantiationService, disposables);
	});

	// TODO: start while starting
	// TODO: no runtime registered
	// TODO: start after started (different runtime but same language)
	// TODO: start after trusted

	function assertRuntimeSessionServiceState(
		runtime: ILanguageRuntimeMetadata,
		hasStartingOrRunningConsole: boolean,
		session: ILanguageRuntimeSession | undefined,
	): void {
		assert.equal(runtimeSessionService.hasStartingOrRunningConsole(runtime.languageId), hasStartingOrRunningConsole);
		if (session) {
			assert.equal(runtimeSessionService.getSession(session.sessionId), session);
		}
		assert.equal(runtimeSessionService.getConsoleSessionForLanguage(runtime.languageId), session);
		assert.equal(runtimeSessionService.getConsoleSessionForRuntime(runtime.runtimeId), session);
		assert.equal(runtimeSessionService.foregroundSession, session);
		assert.deepEqual(runtimeSessionService.activeSessions, session ? [session] : []);
	}

	test('start a console session', async () => {
		// Check the initial runtime session service state.
		assertRuntimeSessionServiceState(runtime, false, undefined);

		// Start a new session.
		const sessionMode = LanguageRuntimeSessionMode.Console;
		const startReason = 'Test requested a runtime session';
		const sessionIdPromise = runtimeSessionService.startNewRuntimeSession(
			runtime.runtimeId,
			runtime.runtimeName,
			sessionMode,
			undefined,
			startReason,
		);

		// Listen to the onWillStartSession event.
		let willStartSessionError: Error | undefined;
		const willStartSessionStub = sinon.stub<[e: IRuntimeSessionWillStartEvent]>().callsFake(({ session }) => {
			try {
				// Check the session state.
				assert.equal(session.getRuntimeState(), RuntimeState.Uninitialized);

				// Check the runtime session service state.
				assertRuntimeSessionServiceState(runtime, true, undefined);
			} catch (error) {
				willStartSessionError = error;
			}
		});
		disposables.add(runtimeSessionService.onWillStartSession(willStartSessionStub));

		// Listen to the onDidStartRuntime event.
		let didStartRuntimeError: Error | undefined;
		const didStartRuntimeStub = sinon.stub<[e: ILanguageRuntimeSession]>().callsFake(session => {
			try {
				// Check the session state.
				assert.equal(session.getRuntimeState(), RuntimeState.Ready);

				// Check the runtime session service state.
				assertRuntimeSessionServiceState(runtime, true, session);
			} catch (error) {
				didStartRuntimeError = error;
			}
		});
		disposables.add(runtimeSessionService.onDidStartRuntime(didStartRuntimeStub));

		// Listen to the onDidChangeForegroundSession event.
		const didChangeForegroundSessionStub = sinon.stub<[e: ILanguageRuntimeSession | undefined]>();
		disposables.add(runtimeSessionService.onDidChangeForegroundSession(didChangeForegroundSessionStub));

		// Check the returned session ID.
		const sessionId = await sessionIdPromise;
		const session = runtimeSessionService.getSession(sessionId);
		assert.ok(session);

		// Check the session details.
		assert.equal(session.metadata.sessionMode, sessionMode);
		assert.equal(session.metadata.sessionName, runtime.runtimeName);
		assert.equal(session.metadata.startReason, startReason);

		// Check the event handlers.
		sinon.assert.calledOnceWithExactly(willStartSessionStub, { isNew: true, session });
		sinon.assert.calledOnceWithExactly(didStartRuntimeStub, session);
		sinon.assert.calledOnceWithExactly(didChangeForegroundSessionStub, session);
		sinon.assert.callOrder(willStartSessionStub, didStartRuntimeStub);

		// Throw any errors that occurred during the event handlers.
		assert.ifError(willStartSessionError);
		assert.ifError(didStartRuntimeError);

		// Cleanup.
		session.dispose();
	});

	test.skip('restart a console session', async () => {
		// Start a new session.
		const sessionMode = LanguageRuntimeSessionMode.Console;
		const startReason = 'Test requested a runtime session';
		const sessionId = await runtimeSessionService.startNewRuntimeSession(
			runtime.runtimeId,
			runtime.runtimeName,
			sessionMode,
			undefined,
			startReason,
		);
		const session = runtimeSessionService.getSession(sessionId);
		assert.ok(session);

		// Check the initial runtime session service state.
		assertRuntimeSessionServiceState(runtime, true, session);

		// Listen to the onDidChangeForegroundSession event.
		const didChangeForegroundSessionStub = sinon.stub<[e: ILanguageRuntimeSession | undefined]>();
		disposables.add(runtimeSessionService.onDidChangeForegroundSession(didChangeForegroundSessionStub));

		// Restart the session.
		const restartReason = 'Test requested a runtime session restart';
		await runtimeSessionService.restartSession(sessionId, restartReason);
		const newSessionId = await runtimeSessionService.startNewRuntimeSession(
			runtime.runtimeId,
			runtime.runtimeName,
			sessionMode,
			undefined,
			startReason,
		);
		const newSession = runtimeSessionService.getSession(newSessionId);
		assert.ok(newSession);

		// Check the runtime session service state after restart.
		assertRuntimeSessionServiceState(runtime, true, newSession);

		// Check the event handlers.
		sinon.assert.calledTwice(didChangeForegroundSessionStub);
		sinon.assert.calledWithExactly(didChangeForegroundSessionStub.firstCall, undefined);
		sinon.assert.calledWithExactly(didChangeForegroundSessionStub.secondCall, newSession);

		// Cleanup.
		newSession.dispose();
	});

	// test('shutdown a console session', async () => {
	// 	// Start a new session.
	// 	const sessionMode = LanguageRuntimeSessionMode.Console;
	// 	const startReason = 'Test requested a runtime session';
	// 	const sessionId = await runtimeSessionService.startNewRuntimeSession(
	// 		runtime.runtimeId,
	// 		runtime.runtimeName,
	// 		sessionMode,
	// 		undefined,
	// 		startReason,
	// 	);
	// 	const session = runtimeSessionService.getSession(sessionId);
	// 	assert.ok(session);

	// 	// Check the initial runtime session service state.
	// 	assertRuntimeSessionServiceState(runtime, true, session);

	// 	// Listen to the onDidChangeForegroundSession event.
	// 	const didChangeForegroundSessionStub = sinon.stub<[e: ILanguageRuntimeSession | undefined]>();
	// 	disposables.add(runtimeSessionService.onDidChangeForegroundSession(didChangeForegroundSessionStub));

	// 	// Shutdown the session.
	// 	const exitReason = RuntimeExitReason.Shutdown;
	// 	await runtimeSessionService.shutdownRuntimeSession(session, exitReason);

	// 	// Check the runtime session service state after shutdown.
	// 	assertRuntimeSessionServiceState(runtime, false, undefined);

	// 	// Check the event handlers.
	// 	sinon.assert.calledOnceWithExactly(didChangeForegroundSessionStub, undefined);
	// });
});
