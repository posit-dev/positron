/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { executeCommand } from '../common/vscodeApis/commandApis';
import { traceInfo } from '../logging';

function getSupportedLibraries(): string[] {
    const libraries: string[] = ['marimo', 'streamlit', 'dash', 'gradio', 'flask', 'fastapi'];
    return libraries;
}

/**
 * Context key holding the URIs of open documents detected as web apps.
 * `pythonAppResources.<framework>` holds the URIs for a single framework.
 *
 * Menus check the `resource` context key against these lists rather than
 * reading a single value for the active editor, so that each editor's run app
 * actions reflect its own document, even when another editor is focused.
 */
const APP_RESOURCES_CONTEXT_KEY = 'pythonAppResources';

/** Detected web app framework by document URI, for open documents that are web apps. */
const frameworkByUri = new Map<string, string>();

/** Detect whether a document is a web app, and update the app resource context keys. */
export function detectWebApp(document: vscode.TextDocument): void {
    const uri = document.uri.toString();
    const framework =
        document.languageId === 'python' && document.uri.scheme !== 'vscode-notebook-cell'
            ? getFramework(document.getText())
            : undefined;

    if (framework === frameworkByUri.get(uri)) {
        return;
    }
    if (framework) {
        frameworkByUri.set(uri, framework);
    } else {
        frameworkByUri.delete(uri);
    }
    updateAppResourceContexts();
}

/** Stop tracking a closed document, and update the app resource context keys. */
export function forgetWebApp(document: vscode.TextDocument): void {
    if (frameworkByUri.delete(document.uri.toString())) {
        updateAppResourceContexts();
    }
}

function updateAppResourceContexts(): void {
    executeCommand('setContext', APP_RESOURCES_CONTEXT_KEY, Array.from(frameworkByUri.keys()));
    for (const library of getSupportedLibraries()) {
        const uris = Array.from(frameworkByUri)
            .filter(([, framework]) => framework === library)
            .map(([uri]) => uri);
        executeCommand('setContext', `${APP_RESOURCES_CONTEXT_KEY}.${library}`, uris);
    }
}

export function getFramework(text: string): string | undefined {
    const libraries = getSupportedLibraries();

    // Define patterns for app creation for each framework
    const appCreationPatterns: Record<string, RegExp> = {
        marimo: /\w+\s*=\s*(?:marimo|mo)\.App\(/i,
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
    const timeoutByUri = new Map<string, NodeJS.Timeout>();

    // Detect apps in documents that are already open.
    vscode.workspace.textDocuments.forEach(detectWebApp);

    disposables.push(
        vscode.workspace.onDidOpenTextDocument(detectWebApp),

        // Throttle updates while the user is typing.
        vscode.workspace.onDidChangeTextDocument((event) => {
            const uri = event.document.uri.toString();
            clearTimeout(timeoutByUri.get(uri));
            timeoutByUri.set(
                uri,
                setTimeout(() => {
                    timeoutByUri.delete(uri);
                    detectWebApp(event.document);
                }, 500),
            );
        }),

        vscode.workspace.onDidCloseTextDocument((document) => {
            const uri = document.uri.toString();
            clearTimeout(timeoutByUri.get(uri));
            timeoutByUri.delete(uri);
            forgetWebApp(document);
        }),

        { dispose: () => timeoutByUri.forEach((timeout) => clearTimeout(timeout)) },
    );
}
