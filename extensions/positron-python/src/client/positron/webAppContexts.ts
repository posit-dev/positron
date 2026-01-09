/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { executeCommand } from '../common/vscodeApis/commandApis';
import { traceInfo } from '../logging';

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

    // Define patterns for app creation for each framework
    const appCreationPatterns: Record<string, RegExp> = {
        streamlit: /st\.\w+\(|streamlit\.\w+\(/i, // More specific pattern for actual streamlit usage
        dash: /\w+\s*=\s*(?:Dash|dash\.Dash)\(/i,
        gradio: /\w+\s*=\s*(?:gr\.|gradio\.)/i,
        flask: /\w+\s*=\s*(?:Flask|flask\.Flask)\(/i,
        fastapi: /\w+\s*=\s*(?:FastAPI|fastapi\.FastAPI)\(/i,
    };

    const importPattern = new RegExp(`import\\s+(${libraries.join('|')})`, 'i');
    const fromImportPattern = new RegExp(`from\\s+(${libraries.join('|')})(?:\\S*)?\\s+import`, 'i');

    // Check for imports
    const importMatch = (importPattern.exec(text)?.[1] || fromImportPattern.exec(text)?.[1])?.toLowerCase();

    // Not a Python web app if no imports found
    if (!importMatch) {
        traceInfo('No web app imports detected in the document.');
        return undefined;
    }

    // Check for app creation
    for (const lib of libraries) {
        // Check for app creation
        const hasAppCreation = appCreationPatterns[lib].test(text);

        // If we have both app creation and import, return immediately (highest priority)
        if (hasAppCreation && importMatch) {
            traceInfo(`Detected web app framework: ${lib} (with app creation)`);
            return lib;
        }
    }

    // Fall back to import detection
    traceInfo(`Detected web app framework: ${importMatch} (import only)`);
    return importMatch;
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
