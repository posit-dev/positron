/* eslint-disable max-classes-per-file */
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { getActivePythonSessions, PythonRuntimeSession } from './session';
import { IPythonRuntimeManager } from './manager';
import { IServiceContainer } from '../ioc/types';
import { IWorkspaceService } from '../common/application/types';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';

class LanguageServerManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    /// The most recent foreground Python session (foreground implies it is a console session).
    private _lastForegroundSessionId?: string;

    constructor(
        private readonly _pythonPathUpdaterService: IPythonPathUpdaterServiceManager,
        private readonly _pythonRuntimeManager: IPythonRuntimeManager,
        private readonly _workspaceService: IWorkspaceService,
    ) {
        this._disposables.push(
            // Register created sessions.
            this._pythonRuntimeManager.onDidCreateSession((session) => {
                this.registerSession(session);
            }),

            // When the foreground session changes, activate its LSP.
            positron.runtime.onDidChangeForegroundSession(async (sessionId) => {
                if (!sessionId) {
                    // There is no foreground session.
                    return;
                }

                if (this._lastForegroundSessionId === sessionId) {
                    // The foreground session has not changed.
                    return;
                }

                // Update the last foreground session.
                this._lastForegroundSessionId = sessionId;

                this.updatePythonPath(sessionId);

                // Activate the LSP for the foreground session.
                const sessions = await getActivePythonSessions();
                const foregroundSession = sessions.find((session) => session.metadata.sessionId === sessionId);
                if (!foregroundSession) {
                    // The foreground session is for another language.
                    return;
                }
                await activateConsoleLsp(foregroundSession);
            }),
        );
    }

    private async updatePythonPath(pythonPath: string): Promise<void> {
        // Pyright expects the Python path to be updated.
        // This behavior only applies to workspaces; non-workspace editors do not update properly yet.
        let folderUri: vscode.Uri | undefined;
        let configTarget: vscode.ConfigurationTarget;

        const { workspaceFolders } = this._workspaceService;

        if (workspaceFolders === undefined || workspaceFolders.length === 0) {
            folderUri = undefined;
            configTarget = vscode.ConfigurationTarget.Global;
        } else if (this._workspaceService.workspaceFile) {
            folderUri = this._workspaceService.workspaceFile;
            configTarget = vscode.ConfigurationTarget.Workspace;
        } else {
            folderUri = workspaceFolders[0].uri;
            configTarget = vscode.ConfigurationTarget.WorkspaceFolder;
        }

        await this._pythonPathUpdaterService.updatePythonPath(pythonPath, configTarget, 'ui', folderUri);
    }

    private registerSession(session: PythonRuntimeSession): void {
        this._disposables.push(
            session.onDidChangeRuntimeState(async (state) => {
                if (state === positron.RuntimeState.Ready) {
                    // The session is ready, activate the LSP.
                    if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
                        // If no foreground session was set yet, set this as the foreground session.
                        // This may happen e.g. after reloading the window with a non-foreground
                        // Python console in a multilanguage workspace.
                        if (!this._lastForegroundSessionId) {
                            this._lastForegroundSessionId = session.metadata.sessionId;
                        }

                        // If this is the foreground session, activate the LSP.
                        if (this._lastForegroundSessionId === session.metadata.sessionId) {
                            await activateConsoleLsp(session);
                        }
                    } else if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Notebook) {
                        await session.activateLsp();
                    }
                } else if (state === positron.RuntimeState.Exited) {
                    // The session has exited, deactivate the LSP.
                    await session.deactivateLsp();
                }
            }),
        );
    }

    public dispose(): void {
        this._disposables.forEach((disposable) => disposable.dispose());
    }
}

/**
 *
 * Activates the console LSP for the given session. Deactivates all other console LSPs first.
 *
 * @param session The Python runtime session to activate the language server for.
 */
async function activateConsoleLsp(session: PythonRuntimeSession): Promise<void> {
    // Deactivate non-foreground console session language servers.
    const { sessionId: foregroundSessionId } = session.metadata;
    const sessions = await getActivePythonSessions();
    await Promise.all(
        sessions
            .filter(
                (session) =>
                    session.metadata.sessionId !== foregroundSessionId &&
                    session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console,
            )
            .map((session) => session.deactivateLsp()),
    );

    // Activate the foreground session language server.
    await session.activateLsp();
}

export function registerLanguageServerManager(
    serviceContainer: IServiceContainer,
    disposables: vscode.Disposable[],
): void {
    const pythonRuntimeManager = serviceContainer.get<IPythonRuntimeManager>(IPythonRuntimeManager);
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    const pythonPathUpdaterService: IPythonPathUpdaterServiceManager = serviceContainer.get<
        IPythonPathUpdaterServiceManager
    >(IPythonPathUpdaterServiceManager);
    disposables.push(new LanguageServerManager(pythonPathUpdaterService, pythonRuntimeManager, workspaceService));
}
