/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';

let webAppButton: vscode.StatusBarItem | undefined;

const libraries: string[] = ['streamlit', 'shiny', 'panel'];

export function checkIfWebApp(document: vscode.TextDocument) {
    const text = document.getText();
    const foundImports = findImportsInText(text, libraries);

    if (foundImports) {
        showRunAppButton();
        console.log('webapp: found import');
    } else {
        hideRunAppButton();
        console.log('webapp: did not find import');
    }
}

// Function to find import statements for specified libraries using regex
function findImportsInText(text: string, libraries: string[]): boolean {
    const importPattern = new RegExp(`import\\s+(${libraries.join('|')})`, 'g');
    const fromImportPattern = new RegExp(`from\\s+(${libraries.join('|')})\\s+import`, 'g');
    return importPattern.test(text) || fromImportPattern.test(text);
}

// adapted from shiny extension, not currently used
export function isNamedApp(filename: string): boolean {
    filename = path.basename(filename);

    // Only .py files (is this needed?)
    if (!new RegExp(`\\.py$`, 'i').test(filename)) {
        return false;
    }

    // Accepted patterns:
    // app.py, app-*.py, app_*.py, *-app.py, *_app.py
    const rxApp = new RegExp(`^app\\.py$`, 'i');
    const rxAppDash = new RegExp(`^app[-_].+\\.py$`, 'i');
    const rxDashApp = new RegExp(`[-_]app\\.py$`, 'i');

    if (rxApp.test(filename)) {
        return true;
    } else if (rxAppDash.test(filename)) {
        return true;
    } else if (rxDashApp.test(filename)) {
        return true;
    }

    return false;
}

function showRunAppButton() {
    if (!webAppButton) {
        webAppButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        webAppButton.text = '$(play) Run App';
        webAppButton.command = 'extension.runWebApp';
        webAppButton.tooltip = 'Run Python Web App';
    }
    webAppButton.show();
}

function hideRunAppButton() {
    if (webAppButton) {
        webAppButton.hide();
    }
}

// Command to run Streamlit
export function runStreamlitCommand() {
    const terminal = vscode.window.createTerminal('Python Web App');
    terminal.sendText('streamlit run app.py');
    terminal.show();
}
