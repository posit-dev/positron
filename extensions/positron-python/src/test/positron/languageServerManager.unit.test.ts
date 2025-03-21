/* eslint-disable @typescript-eslint/no-empty-function */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { interfaces } from 'inversify';
import { registerLanguageServerManager } from '../../client/positron/languageServerManager';
import { mock } from './utils';
import { createUniqueId, PythonRuntimeSession } from '../../client/positron/session';
import * as util from '../../client/positron/util';
import { IServiceContainer } from '../../client/ioc/types';

function mockSession(sessionMode = positron.LanguageRuntimeSessionMode.Console): PythonRuntimeSession {
    return new PythonRuntimeSession(
        mock<positron.LanguageRuntimeMetadata>({
            extraRuntimeData: {
                pythonPath: 'python',
            },
        }),
        mock<positron.RuntimeSessionMetadata>({
            sessionId: createUniqueId(),
            sessionMode,
        }),
        mock<IServiceContainer>({
            get: <T>(_: interfaces.ServiceIdentifier<T>) => undefined as T,
        }),
    );
}

suite('Language server manager', () => {
    let disposables: vscode.Disposable[];
    let onDidChangeForegroundSession: vscode.EventEmitter<string | undefined>;
    let foregroundSession: PythonRuntimeSession;
    let nonForegroundSession: PythonRuntimeSession;
    let foregroundSessionSpy: sinon.SinonSpiedInstance<PythonRuntimeSession>;
    let nonForegroundSessionSpy: sinon.SinonSpiedInstance<PythonRuntimeSession>;

    setup(() => {
        disposables = [];
        onDidChangeForegroundSession = new vscode.EventEmitter();

        foregroundSession = mockSession();
        nonForegroundSession = mockSession();
        foregroundSessionSpy = sinon.spy(foregroundSession);
        nonForegroundSessionSpy = sinon.spy(nonForegroundSession);

        // Stub the runtime API. Use Object.assign since positron.runtime doesn't exist
        // in the unit test environment, but TypeScript doesn't know that.
        Object.assign(positron.runtime, {
            onDidChangeForegroundSession: onDidChangeForegroundSession.event,
            getActiveSessions: async () => [foregroundSession, nonForegroundSession],
        });

        registerLanguageServerManager(disposables);
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
        onDidChangeForegroundSession.dispose();
    });

    test('should deactivate non-foreground session before activating foreground session', async () => {
        // Change the foreground session.
        onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
        sinon.assert.calledOnce(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.callOrder(nonForegroundSessionSpy.deactivateLsp, foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
    });

    test('should do nothing if there is no foreground session', async () => {
        // Change the foreground session.
        onDidChangeForegroundSession.fire(undefined);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.notCalled(foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
    });

    test('should do nothing for unknown foreground session', async () => {
        // Create a session unknown to positron.runtime.getActiveSessions.
        const unknownSession = mockSession();
        const unknownSessionSpy = sinon.spy(unknownSession);

        // Change the foreground session.
        onDidChangeForegroundSession.fire(unknownSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.notCalled(foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(unknownSessionSpy.activateLsp);
        sinon.assert.notCalled(unknownSessionSpy.deactivateLsp);
    });

    test('should not deactivate non-console sessions', async () => {
        sinon.stub(nonForegroundSession.metadata, 'sessionMode').value(positron.LanguageRuntimeSessionMode.Notebook);

        onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);

        // The foreground session should still be activated.
        sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);

        // The non-foreground session should not be deactivated.
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
    });
});
