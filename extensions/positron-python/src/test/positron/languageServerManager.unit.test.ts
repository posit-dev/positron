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
import { IPythonPathUpdaterServiceManager } from '../../client/interpreter/configuration/types';
import { IWorkspaceService } from '../../client/common/application/types';
import { IPythonRuntimeManager } from '../../client/positron/manager';

class TestPythonRuntimeSession extends PythonRuntimeSession {
    onDidChangeRuntimeStateEmitter = new vscode.EventEmitter<positron.RuntimeState>();

    onDidChangeRuntimeState = this.onDidChangeRuntimeStateEmitter.event;

    async dispose(): Promise<void> {
        this.onDidChangeRuntimeStateEmitter.dispose();
        await super.dispose();
    }
}

suite('Language server manager', () => {
    let disposables: vscode.Disposable[];
    let serviceContainer: IServiceContainer;
    let onDidChangeForegroundSession: vscode.EventEmitter<string | undefined>;
    let onDidCreateSession: vscode.EventEmitter<PythonRuntimeSession>;
    let foregroundSession: TestPythonRuntimeSession;
    let nonForegroundSession: TestPythonRuntimeSession;
    let notebookSession: TestPythonRuntimeSession;
    let foregroundSessionSpy: sinon.SinonSpiedInstance<TestPythonRuntimeSession>;
    let nonForegroundSessionSpy: sinon.SinonSpiedInstance<TestPythonRuntimeSession>;
    let notebookSessionSpy: sinon.SinonSpiedInstance<TestPythonRuntimeSession>;

    setup(() => {
        disposables = [];
        onDidChangeForegroundSession = new vscode.EventEmitter();
        onDidCreateSession = new vscode.EventEmitter();
        disposables.push(onDidChangeForegroundSession, onDidCreateSession);

        const pythonPathUpdaterService = mock<IPythonPathUpdaterServiceManager>({
            updatePythonPath: sinon.stub(),
        });

        const workspaceService = mock<IWorkspaceService>({});

        const pythonRuntimeManager = mock<IPythonRuntimeManager>({
            onDidCreateSession: onDidCreateSession.event,
        });
        serviceContainer = mock<IServiceContainer>({
            get: <T>(serviceIdentifier: interfaces.ServiceIdentifier<T>) => {
                switch (serviceIdentifier) {
                    case IPythonRuntimeManager:
                        return pythonRuntimeManager as T;
                    case IPythonPathUpdaterServiceManager:
                        return pythonPathUpdaterService as T;
                    case IWorkspaceService:
                        return workspaceService as T;
                    default:
                        return undefined as T;
                }
            },
        });

        foregroundSession = mockSession();
        nonForegroundSession = mockSession();
        notebookSession = mockSession(positron.LanguageRuntimeSessionMode.Notebook);
        foregroundSessionSpy = sinon.spy(foregroundSession);
        nonForegroundSessionSpy = sinon.spy(nonForegroundSession);
        notebookSessionSpy = sinon.spy(notebookSession);

        // Stub the runtime API. Use Object.assign since positron.runtime doesn't exist
        // in the unit test environment, but TypeScript doesn't know that.
        Object.assign(positron.runtime, {
            onDidChangeForegroundSession: onDidChangeForegroundSession.event,
            getActiveSessions: async () => [foregroundSession, nonForegroundSession],
        });

        registerLanguageServerManager(serviceContainer, disposables);
    });

    teardown(() => {
        sinon.restore();
        disposables.forEach((d) => d.dispose());
    });

    function mockSession(sessionMode = positron.LanguageRuntimeSessionMode.Console): TestPythonRuntimeSession {
        return new TestPythonRuntimeSession(
            mock<positron.LanguageRuntimeMetadata>({
                extraRuntimeData: {
                    pythonPath: 'python',
                },
            }),
            mock<positron.RuntimeSessionMetadata>({
                sessionId: createUniqueId(),
                sessionMode,
            }),
            serviceContainer,
        );
    }

    test('should change foreground lsp when foreground console changes', async () => {
        // Change the foreground session.
        onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
        sinon.assert.calledOnce(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.callOrder(nonForegroundSessionSpy.deactivateLsp, foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
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

    test('should do nothing when foreground console changes to unknown session', async () => {
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
        sinon.assert.notCalled(notebookSessionSpy.activateLsp);
        sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
    });

    test('should change foreground lsp when foreground console is ready', async () => {
        // Register the session with the manager.
        onDidCreateSession.fire(foregroundSession);

        // Change the foreground session.
        onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);
        foregroundSessionSpy.activateLsp.resetHistory();
        nonForegroundSessionSpy.deactivateLsp.resetHistory();

        // Set the session to ready.
        foregroundSession.onDidChangeRuntimeStateEmitter.fire(positron.RuntimeState.Ready);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
        sinon.assert.calledOnce(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.callOrder(nonForegroundSessionSpy.deactivateLsp, foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(notebookSessionSpy.activateLsp);
        sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
    });

    test('should change foreground lsp when console is ready and there is no foreground console yet', async () => {
        // Register the session with the manager.
        onDidCreateSession.fire(foregroundSession);

        // Set the session to ready.
        foregroundSession.onDidChangeRuntimeStateEmitter.fire(positron.RuntimeState.Ready);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.calledOnce(foregroundSessionSpy.activateLsp);
        sinon.assert.calledOnce(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.callOrder(nonForegroundSessionSpy.deactivateLsp, foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(notebookSessionSpy.activateLsp);
        sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
    });

    test('should do nothing when non-foreground session is ready', async () => {
        // Register the session with the manager.
        onDidCreateSession.fire(nonForegroundSession);

        // Change the foreground session.
        onDidChangeForegroundSession.fire(foregroundSession.metadata.sessionId);

        // Wait for the event loop to run.
        await util.delay(0);
        foregroundSessionSpy.activateLsp.resetHistory();
        nonForegroundSessionSpy.deactivateLsp.resetHistory();

        // Set the session to ready.
        nonForegroundSession.onDidChangeRuntimeStateEmitter.fire(positron.RuntimeState.Ready);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(notebookSessionSpy.activateLsp);
        sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
    });

    test('should activate when notebook is ready', async () => {
        // Register the session with the manager.
        onDidCreateSession.fire(notebookSession);

        // Set the session to ready.
        notebookSession.onDidChangeRuntimeStateEmitter.fire(positron.RuntimeState.Ready);

        // Wait for the event loop to run.
        await util.delay(0);

        sinon.assert.calledOnce(notebookSessionSpy.activateLsp);
        sinon.assert.notCalled(notebookSessionSpy.deactivateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.activateLsp);
        sinon.assert.notCalled(nonForegroundSessionSpy.deactivateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.activateLsp);
        sinon.assert.notCalled(foregroundSessionSpy.deactivateLsp);
    });
});
