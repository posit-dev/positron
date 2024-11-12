/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** Initialize Positron for Python extension integration tests. */
export function initializePositron(): void {
    // Use a late import since this module may be imported without Positron being installed
    // e.g. in unit tests.
    // eslint-disable-next-line global-require
    const vscode = require('vscode') as typeof import('vscode');

    // Don't start Positron interpreters automatically during tests.
    vscode.workspace
        .getConfiguration('positron.interpreters')
        .update('automaticStartup', false, vscode.ConfigurationTarget.Global);
}
