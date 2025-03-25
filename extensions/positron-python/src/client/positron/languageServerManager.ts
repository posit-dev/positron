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
import { IPersistentState, IPersistentStateFactory } from '../common/types';

const lastForegroundSessionIdKey = 'positron.lastForegroundSessionId';

class LanguageServerManager implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];

    constructor(
        private readonly _persistentStateFactory: IPersistentStateFactory,
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

                const lastForegroundSessionIdState = this.getLastForegroundSessionIdState();
                if (lastForegroundSessionIdState.value === sessionId) {
                    // The foreground session has not changed.
                    return;
                }

                // Get the foreground session.
                const sessions = await getActivePythonSessions();
                const foregroundSession = sessions.find((session) => session.metadata.sessionId === sessionId);
                if (!foregroundSession) {
                    // The foreground session is for another language.
                    return;
                }

                await Promise.all([
                    // Update the last foreground session.
                    lastForegroundSessionIdState.updateValue(sessionId),

                    // Update the Python path as expected by Pyright.
                    this.updatePythonPath(foregroundSession.runtimeMetadata.runtimePath),

                    // Activate the LSP for the foreground session.
                    activateConsoleLsp(foregroundSession, sessions),
                ]);
            }),
        );
    }

    /**
     * Get the persistent state for the most recent foreground Python session
     * (foreground implies it is a console session).
     *
     * This is stored in persistent state in order to activate the LSP for a
     * session that was the most recent foreground *Python* session before the
     * window is reloaded, but another language session is the current foreground,
     * e.g. in multilanguage workspaces.
     */
    private getLastForegroundSessionIdState(): IPersistentState<string | undefined> {
        return this._persistentStateFactory.createWorkspacePersistentState<string | undefined>(
            lastForegroundSessionIdKey,
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
                    // The session is ready, check if we should activate its LSP.
                    if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console) {
                        const lastForegroundSessionIdState = this.getLastForegroundSessionIdState();
                        // If this was the last foreground session, activate its LSP.
                        if (lastForegroundSessionIdState.value === session.metadata.sessionId) {
                            await activateConsoleLsp(session);
                        }
                    } else if (session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Notebook) {
                        // Always activate notebook LSPs.
                        await session.activateLsp();
                    }
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
async function activateConsoleLsp(session: PythonRuntimeSession, allSessions?: PythonRuntimeSession[]): Promise<void> {
    // Deactivate non-foreground console session LSPs.
    const { sessionId: foregroundSessionId } = session.metadata;
    const sessions = allSessions ?? (await getActivePythonSessions());
    await Promise.all(
        sessions
            .filter(
                (session) =>
                    session.metadata.sessionId !== foregroundSessionId &&
                    session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console,
            )
            .map((session) => session.deactivateLsp()),
    );

    // Activate the foreground session LSP.
    await session.activateLsp();
}

export function registerLanguageServerManager(
    serviceContainer: IServiceContainer,
    disposables: vscode.Disposable[],
): void {
    const persistentStateFactory = serviceContainer.get<IPersistentStateFactory>(IPersistentStateFactory);
    const pythonRuntimeManager = serviceContainer.get<IPythonRuntimeManager>(IPythonRuntimeManager);
    const pythonPathUpdaterService: IPythonPathUpdaterServiceManager = serviceContainer.get<
        IPythonPathUpdaterServiceManager
    >(IPythonPathUpdaterServiceManager);
    const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);
    disposables.push(
        new LanguageServerManager(
            persistentStateFactory,
            pythonPathUpdaterService,
            pythonRuntimeManager,
            workspaceService,
        ),
    );
}
