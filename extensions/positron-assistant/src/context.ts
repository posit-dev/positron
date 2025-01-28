/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

let extensionContext: vscode.ExtensionContext;

export function setContext(context: vscode.ExtensionContext) {
	extensionContext = context;
}

export function getContext(): vscode.ExtensionContext {
	if (!extensionContext) {
		throw new Error('Extension context not initialized');
	}
	return extensionContext;
}
