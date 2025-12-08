// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { ExtensionContext, Uri } from 'vscode';
import * as path from 'path';
// --- Start Positron ---
// import { copy, createDirectory, getConfiguration, onDidChangeConfiguration } from '../common/vscodeApis/workspaceApis';
import { copy, createDirectory, onDidChangeConfiguration } from '../common/vscodeApis/workspaceApis';
// --- End Positron ---
import { EXTENSION_ROOT_DIR } from '../constants';

async function applyPythonStartupSetting(context: ExtensionContext): Promise<void> {
    // --- Start Positron ---
    // const config = getConfiguration('python');
    // const pythonrcSetting = config.get<boolean>('terminal.shellIntegration.enabled');

    // We don't use VSCode's Python-specific terminal shell integration in Positron.
    // Setting PYTHONSTARTUP causes pythonrc.py to run in our Jupyter-based console.
    // Always treat this as disabled in Positron to ensure cleanup of any existing settings.
    const pythonrcSetting = false;
    // --- End Positron ---

    if (pythonrcSetting) {
        const storageUri = context.storageUri || context.globalStorageUri;
        try {
            await createDirectory(storageUri);
        } catch {
            // already exists, most likely
        }
        const destPath = Uri.joinPath(storageUri, 'pythonrc.py');
        const sourcePath = path.join(EXTENSION_ROOT_DIR, 'python_files', 'pythonrc.py');
        await copy(Uri.file(sourcePath), destPath, { overwrite: true });
        context.environmentVariableCollection.replace('PYTHONSTARTUP', destPath.fsPath);
        // When shell integration is  enabled, we disable PyREPL from cpython.
        context.environmentVariableCollection.replace('PYTHON_BASIC_REPL', '1');
    } else {
        context.environmentVariableCollection.delete('PYTHONSTARTUP');
        context.environmentVariableCollection.delete('PYTHON_BASIC_REPL');
    }
}

export async function registerPythonStartup(context: ExtensionContext): Promise<void> {
    await applyPythonStartupSetting(context);
    context.subscriptions.push(
        onDidChangeConfiguration(async (e) => {
            if (e.affectsConfiguration('python.terminal.shellIntegration.enabled')) {
                await applyPythonStartupSetting(context);
            }
        }),
    );
}
