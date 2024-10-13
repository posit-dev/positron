/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { strict as assert } from 'assert';
import * as sinon from 'sinon';
import { DeferredPromise } from 'vs/base/common/async';
import { IDisposable } from 'vs/base/common/lifecycle';
import { generateUuid } from 'vs/base/common/uuid';
import { ensureNoDisposablesAreLeakedInTestSuite } from 'vs/base/test/common/utils';
import { ILanguageService } from 'vs/editor/common/languages/language';
import { LanguageService } from 'vs/editor/common/services/languageService';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IOpener, IOpenerService } from 'vs/platform/opener/common/opener';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { LanguageRuntimeService } from 'vs/workbench/services/languageRuntime/common/languageRuntime';
import { ILanguageRuntimeMetadata, ILanguageRuntimeService, LanguageRuntimeSessionLocation, LanguageRuntimeSessionMode, LanguageRuntimeStartupBehavior, RuntimeState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { RuntimeSessionService } from 'vs/workbench/services/runtimeSession/common/runtimeSession';
import { ILanguageRuntimeSession, ILanguageRuntimeSessionManager, IRuntimeSessionMetadata, IRuntimeSessionWillStartEvent } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { TestLanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/test/common/testLanguageRuntimeSession';
import { TestExtensionService, TestStorageService, TestWorkspaceTrustManagementService } from 'vs/workbench/test/common/workbenchTestServices';

const TestRuntimeLanguageVersion = '0.0.1';
const TestRuntimeShortName = TestRuntimeLanguageVersion;
const TestRuntimeName = `Test ${TestRuntimeShortName}`;

class TestOpenerService implements Partial<IOpenerService> {
	registerOpener(opener: IOpener): IDisposable {
		return { dispose() { } };
	}
}

class TestRuntimeSessionManager implements ILanguageRuntimeSessionManager {
	async managesRuntime(runtime: ILanguageRuntimeMetadata): Promise<boolean> {
		return true;
	}

	async createSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		return new TestLanguageRuntimeSession(sessionMetadata, runtimeMetadata);
	}

	restoreSession(runtimeMetadata: ILanguageRuntimeMetadata, sessionMetadata: IRuntimeSessionMetadata): Promise<ILanguageRuntimeSession> {
		throw new Error('Not implemented');
	}

	validateMetadata(metadata: ILanguageRuntimeMetadata): Promise<ILanguageRuntimeMetadata> {
		throw new Error('Not implemented');
	}
}

function testLanguageRuntimeMetadata(): ILanguageRuntimeMetadata {
	const runtimeId = generateUuid();
	return {
		extensionId: new ExtensionIdentifier('test-extension'),
		base64EncodedIconSvg: '',
		extraRuntimeData: {},
		languageId: 'test',
		languageName: 'Test',
		languageVersion: TestRuntimeLanguageVersion,
		runtimeId,
		runtimeName: TestRuntimeName,
		runtimePath: '/test',
		runtimeShortName: TestRuntimeShortName,
		runtimeSource: 'Test',
		runtimeVersion: '0.0.1',
		sessionLocation: LanguageRuntimeSessionLocation.Browser,
		startupBehavior: LanguageRuntimeStartupBehavior.Implicit,
	};
}

suite('Positron - RuntimeSessionService', () => {
	let runtimeSessionService: RuntimeSessionService;
	let runtime: ILanguageRuntimeMetadata;

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	setup(() => {
		const instantiationService = disposables.add(new TestInstantiationService());
		instantiationService.stub(IOpenerService, new TestOpenerService());
		instantiationService.stub(ILanguageService, disposables.add(instantiationService.createInstance(LanguageService)));
		instantiationService.stub(IExtensionService, new TestExtensionService());
		instantiationService.stub(IStorageService, disposables.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(IWorkspaceTrustManagementService, disposables.add(new TestWorkspaceTrustManagementService()));
		const languageRuntimeService = instantiationService.stub(ILanguageRuntimeService, disposables.add(instantiationService.createInstance(LanguageRuntimeService)));
		runtimeSessionService = disposables.add(instantiationService.createInstance(RuntimeSessionService));

		// Register the test runtime.
		runtime = testLanguageRuntimeMetadata();
		disposables.add(languageRuntimeService.registerRuntime(runtime));

		// Register the test runtime manager.
		const manager = new TestRuntimeSessionManager();
		disposables.add(runtimeSessionService.registerSessionManager(manager));
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
});
