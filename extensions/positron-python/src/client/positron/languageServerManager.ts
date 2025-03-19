/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';
import { getActivePythonSessions } from './util';

export function registerLanguageServerManager(disposables: vscode.Disposable[]): void {
    disposables.push(
        // When the foreground session changes:
        // 1. Deactivate non-foreground session language servers.
        // 2. Activate the foreground session language server.
        positron.runtime.onDidChangeForegroundSession(async (sessionId) => {
            if (!sessionId) {
                // There is no foreground session, nothing to do.
                return;
            }

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
                    .map((session) => session.deactivateLsp()),
            );

            // Activate the foreground session language server.
            await foregroundSession.activateLsp();
        }),
    );
}
