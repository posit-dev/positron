/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createUniqueId, mock } from './utils';
import * as util from '../util';
import { RSession } from '../session.js';

function mockSession(sessionMode = positron.LanguageRuntimeSessionMode.Console): RSession {
	return new RSession(
		mock<positron.LanguageRuntimeMetadata>({
		}),
		mock<positron.RuntimeSessionMetadata>({
			sessionId: createUniqueId(),
			sessionMode,
		}),
	);
}

suite('Session manager', () => {
	let suiteDisposables: vscode.Disposable[] = [];

	let onDidChangeForegroundSession: vscode.EventEmitter<string | undefined>;

	let foregroundSession: RSession;
	let foregroundSessionSpy: sinon.SinonSpiedInstance<RSession>;

	let nonForegroundSession: RSession;
	let nonForegroundSessionSpy: sinon.SinonSpiedInstance<RSession>;

	let notebookSession: RSession;
	let notebookSessionSpy: sinon.SinonSpiedInstance<RSession>;

	suiteSetup(() => {
		// Needs to be done once per suite not once per test because of how `RSessionManager` is a singleton.
		// If we did it once per test then instantiating `RSessionManager` would capture the first test's stubbed
		// version of `onDidChangeForegroundSession`.
		onDidChangeForegroundSession = new vscode.EventEmitter();
		suiteDisposables.push(onDidChangeForegroundSession);
		sinon.stub(positron.runtime, 'onDidChangeForegroundSession').get(() => onDidChangeForegroundSession.event);
	});

	suiteTeardown(() => {
		sinon.restore();
		suiteDisposables.forEach((d) => d.dispose());
	});

	setup(() => {
		foregroundSession = mockSession();
		foregroundSessionSpy = sinon.spy(foregroundSession);

		nonForegroundSession = mockSession();
		nonForegroundSessionSpy = sinon.spy(nonForegroundSession);

		notebookSession = mockSession(positron.LanguageRuntimeSessionMode.Notebook);
		notebookSessionSpy = sinon.spy(notebookSession);
	});

	test('should deactivate non-foreground session before activating foreground session', async () => {
		// Change the foreground session.
		onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

		// Wait for the event loop to run.
		await util.delay(0);

		// The foreground session should be activated.
		sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
		sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);

		// The non-foreground session should be deactivated, and it should happen first.
		sinon.assert.calledOnce(nonForegroundSessionSpy.deactivateLsp);
		sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
		sinon.assert.callOrder(nonForegroundSessionSpy.deactivateLsp, foregroundSessionSpy.activateLsp);

		// The notebook session should not be deactivated.
		sinon.assert.notCalled(notebookSessionSpy.activateLsp);
		sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
	});

	test('should do nothing when foreground console is unset', async () => {
		// Change the foreground session.
		onDidChangeForegroundSession.fire(undefined);

		// Wait for the event loop to run.
		await util.delay(0);

		sinon.assert.notCalled(foregroundSessionSpy.activateLsp);
		sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
		sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
		sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
		sinon.assert.notCalled(notebookSessionSpy.activateLsp);
		sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
	});
});
