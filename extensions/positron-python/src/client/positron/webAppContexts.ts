/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { executeCommand } from '../common/vscodeApis/commandApis';

function getSupportedLibraries(): string[] {
    const libraries: string[] = ['streamlit', 'dash', 'gradio', 'flask', 'fastapi'];
    return libraries;
}

export function detectWebApp(document: vscode.TextDocument): void {
    if (document.languageId !== 'python') {
        executeCommand('setContext', 'pythonAppFramework', undefined);
        return;
    }
    const text = document.getText();
    const framework = getFramework(text);
    executeCommand('setContext', 'pythonAppFramework', framework);
}

export function getFramework(text: string): string | undefined {
    const libraries = getSupportedLibraries();
    const importPattern = new RegExp(`import\\s+(${libraries.join('|')})`, 'g');
    const fromImportPattern = new RegExp(`from\\s+(${libraries.join('|')})\\S*\\simport`, 'g');
    const importMatch = importPattern.exec(text);

    if (importMatch) {
        return importMatch[1];
    }

    const fromImportMatch = fromImportPattern.exec(text);
    if (fromImportMatch) {
        return fromImportMatch[1];
    }

    return undefined;
}

export function activateAppDetection(disposables: vscode.Disposable[]): void {
    let timeout: NodeJS.Timeout | undefined;
    let activeEditor = vscode.window.activeTextEditor;

    function updateWebApp() {
        if (!activeEditor) {
            return;
        }
        detectWebApp(activeEditor.document);
    }

    // Throttle updates if needed
    function triggerUpdateApp(throttle = false) {
        if (!activeEditor) {
            return;
        }
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        if (throttle) {
            timeout = setTimeout(updateWebApp, 500);
        } else {
            detectWebApp(activeEditor.document);
        }
    }

    // Trigger for the current active editor.
    if (activeEditor) {
        triggerUpdateApp();
    }

    disposables.push(
        // Trigger when the active editor changes
        vscode.window.onDidChangeActiveTextEditor((editor) => {
            if (editor) {
                activeEditor = editor;
                triggerUpdateApp();
            }
        }),

        // Trigger when the active editor's content changes
        vscode.workspace.onDidChangeTextDocument((event) => {
            if (activeEditor && event.document === activeEditor.document) {
                triggerUpdateApp(true);
            }
        }),

        // Trigger when new text document is opened
        vscode.workspace.onDidOpenTextDocument((document) => {
            if (document.languageId === 'python') {
                // update to opened text document
                activeEditor = vscode.window.activeTextEditor;
                triggerUpdateApp();
            }
        }),
    );
}
