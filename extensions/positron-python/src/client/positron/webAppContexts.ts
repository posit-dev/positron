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
        streamlit: /\bst\.\w+\(|streamlit\.\w+\(/i, // More specific pattern for actual streamlit usage
        dash: /\w+\s*=\s*(?:Dash|dash\.Dash)\(/i,
        gradio: /\w+\s*=\s*(?:gr\.|gradio\.)/i,
        flask: /\w+\s*=\s*(?:Flask|flask\.Flask)\(/i,
        fastapi: /\w+\s*=\s*(?:FastAPI|fastapi\.FastAPI)\(/i,
    };

    // Check for app creation with matching import for each library
    let firstImportMatch: string | undefined;
    for (const lib of libraries) {
        const importPattern = new RegExp(`import\\s+${lib}\\b|from\\s+${lib}(?:\\S*)?\\s+import`, 'i');
        const hasImport = importPattern.test(text);

        if (hasImport) {
            // Track the first import found for fallback
            if (!firstImportMatch) {
                firstImportMatch = lib;
            }

            const hasAppCreation = appCreationPatterns[lib].test(text);
            // If we have both app creation and import for the same library, return immediately (highest priority)
            if (hasAppCreation) {
                traceInfo(`Detected web app framework: ${lib} (with app creation)`);
                return lib;
            }
        }
    }

    // Not a Python web app if no imports found
    if (!firstImportMatch) {
        traceInfo('No web app imports detected in the document.');
        return undefined;
    }

    // Fall back to first import detected
    traceInfo(`Detected web app framework: ${firstImportMatch} (import only)`);
    return firstImportMatch;
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
