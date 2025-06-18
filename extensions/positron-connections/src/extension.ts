/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { registerConnectionDrivers } from './drivers';

export function activate(context: vscode.ExtensionContext) {
	// We always register the drivers.
	registerConnectionDrivers(context);
}

export function deactivate(context: vscode.ExtensionContext) {
	context.subscriptions.forEach((e) => {
		e.dispose();
	});
}
