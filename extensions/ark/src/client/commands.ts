/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function registerCommands(context: vscode.ExtensionContext) {

    context.subscriptions.push(

        vscode.commands.registerCommand('ark.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from ark!');
        }),

    );

}
