/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';

// Conservative Python identifier pattern; rejects anything that could escape
// the `import {name}` statement we send to the runtime.
const PYTHON_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Run `import {packageName}` in the foreground Python session in Interactive
 * mode so the call appears in the console and command history. The console
 * is focused first so the user sees the echoed line.
 *
 * @param packageName Import name (e.g. "PIL" for Pillow). Must be a valid
 *   Python identifier; otherwise an Error is thrown.
 */
export async function loadPythonPackage(
    packageName: string,
    _token?: vscode.CancellationToken,
): Promise<void> {
    if (!PYTHON_IDENTIFIER.test(packageName)) {
        throw new Error(`Invalid Python import name: "${packageName}".`);
    }
    vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
    // Fire-and-forget: executeCode resolves once the code is queued, not when
    // it completes. The packages-pane refresh that follows uses an RPC, which
    // the kernel processes after the queued import on the same shell channel,
    // so the next refresh sees the new loaded state.
    await positron.runtime.executeCode(
        'python',
        `import ${packageName}`,
        true, // focus
        false, // allowIncomplete
        positron.RuntimeCodeExecutionMode.Interactive,
        positron.RuntimeErrorBehavior.Continue,
    );
}
