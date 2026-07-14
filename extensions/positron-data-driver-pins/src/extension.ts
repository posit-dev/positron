/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { createPinsDriver } from './pinsDriver.js';

/**
 * Activates the extension by registering the Posit Connect pins data connection driver.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// A dedicated log channel so connect/browse activity and errors are discoverable in the Output
	// panel (Output -> "Posit Connect Pins"). Set its level to Trace to see individual requests.
	const logger = vscode.window.createOutputChannel('Posit Connect Pins', { log: true });
	context.subscriptions.push(logger);

	const driver = createPinsDriver(context, logger);
	context.subscriptions.push(positron.dataConnections.registerDriver(driver));
}

/** Deactivation is handled by disposing context subscriptions. */
export function deactivate() {
	// Nothing to do.
}
