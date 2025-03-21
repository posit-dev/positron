/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { getActivePythonSessions } from './session';
import { IServiceContainer } from '../ioc/types';
import { IPythonPathUpdaterServiceManager } from '../interpreter/configuration/types';
import { IWorkspaceService } from '../common/application/types';


export function registerLanguageServerManager(serviceContainer: IServiceContainer, disposables: vscode.Disposable[]): void {
    disposables.push(
        // When the foreground session changes:
        // 1. Deactivate non-foreground session language servers.
        // 2. Activate the foreground session language server.
        positron.runtime.onDidChangeForegroundSession(async (sessionId) => {
            if (!sessionId) {
                // There is no foreground session, nothing to do.
                return;
            }

            const pythonPathUpdaterService: IPythonPathUpdaterServiceManager = serviceContainer.get<IPythonPathUpdaterServiceManager>(
                IPythonPathUpdaterServiceManager);
            const workspaceService = serviceContainer.get<IWorkspaceService>(IWorkspaceService);

            const sessions = await getActivePythonSessions();
            const foregroundSession = sessions.find((session) => session.metadata.sessionId === sessionId);
            if (!foregroundSession) {
                // The foreground session is for another language.
                return;
            }

            // Deactivate non-foreground console session language servers.
            await Promise.all(
                sessions
                    .filter(
                        (session) =>
                            session.metadata.sessionId !== sessionId &&
                            session.metadata.sessionMode === positron.LanguageRuntimeSessionMode.Console,
                    )
                    .map((session) => session.deactivateLsp(true)),
            );

            // Activate the foreground session language server.
            await foregroundSession.activateLsp();

            let folderUri: vscode.Uri | undefined;
            let configTarget: vscode.ConfigurationTarget;

            const { workspaceFolders } = workspaceService;

            if (workspaceFolders === undefined || workspaceFolders.length === 0) {
                folderUri = undefined;
                configTarget = vscode.ConfigurationTarget.Global;
            } else if (workspaceService.workspaceFile) {
                folderUri = workspaceService.workspaceFile;
                configTarget = vscode.ConfigurationTarget.Workspace;
            } else {
                folderUri = workspaceFolders[0].uri;
                configTarget = vscode.ConfigurationTarget.WorkspaceFolder;
            }

            await pythonPathUpdaterService.updatePythonPath(foregroundSession.runtimeMetadata.runtimePath, configTarget, 'ui', folderUri);
        })
    );
}
