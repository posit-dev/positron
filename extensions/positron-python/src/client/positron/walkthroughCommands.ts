/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

export async function registerWalkthroughCommands(context: vscode.ExtensionContext, runtimeManager: RRuntimeManager) {
    context.subscriptions.push(
        // Commands used in walkthrough
        vscode.commands.registerCommand('python.walkthrough.autoreload', async () => {
            vscode.commands.executeCommand('workbench.action.openSettings', 'python.enableAutoReload');
        }),
    );
}
