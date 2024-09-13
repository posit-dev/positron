/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { executeCommand } from '../common/vscodeApis/commandApis';

const libraries: string[] = ['streamlit', 'shiny', 'dash', 'gradio', 'flask', 'fastapi'];

export function detectWebApp(document: vscode.TextDocument): void {
    const text = document.getText();
    const foundImports = importsInApp(text);
    const framework = getAppFramework(text);
    executeCommand('setContext', 'pythonFileContainsApp', foundImports);
    executeCommand('setContext', 'pythonAppFramework', framework);
}

// find import statements for specified libraries via import XXXX or from XXX import
function importsInApp(text: string): boolean {
    const importPattern = new RegExp(`import\\s+(${libraries.join('|')})`, 'g');
    const fromImportPattern = new RegExp(`from\\s+(${libraries.join('|')})\\S*\\simport`, 'g');

    return importPattern.test(text) || fromImportPattern.test(text);
}

export function getAppFramework(text: string): string | undefined {
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
