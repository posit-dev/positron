/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function resourceUri(...pathSegments: string[]): vscode.Uri {
	if (!extensionUri) {
		throw new Error('The extension URI is unset');
	}
	return vscode.Uri.joinPath(extensionUri, 'resources', ...pathSegments);
}

export function setExtensionUri(context: vscode.ExtensionContext) {
	extensionUri = context.extensionUri;
}

let extensionUri: vscode.Uri | undefined;
