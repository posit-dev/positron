/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';

declare class URL {
	constructor(input: string, base?: string | URL);
	hostname: string;
}

/**
 * The set of hosts for which we can open URLs; borrowed from the
 * `simple-browser` extension, which also only serves local URLs.
 */
const localHosts = new Set<string>([
	'localhost',
	// localhost IPv4
	'127.0.0.1',
	// localhost IPv6
	'[0:0:0:0:0:0:0:1]',
	'[::1]',
	// all interfaces IPv4
	'0.0.0.0',
	// all interfaces IPv6
	'[0:0:0:0:0:0:0:0]',
	'[::]'
]);

export function activate(context: vscode.ExtensionContext) {

	context.subscriptions.push(vscode.window.registerExternalUriOpener('positron.viewer', {
		canOpenExternalUri(uri: vscode.Uri) {
			// Check our configuration to see if the user prefers to
			// open localhost URLs in the browser.
			const config = vscode.workspace.getConfiguration('positron.viewer');
			if (!config.get<boolean>('openLocalhostUrls')) {
				return vscode.ExternalUriOpenerPriority.Option;
			}

			// Check to see if the host is in the set of local hosts. If so,
			// make ourselves the default opener.
			const originalUri = new URL(uri.toString(true));
			if (localHosts.has(originalUri.hostname)) {
				return vscode.ExternalUriOpenerPriority.Default;
			}

			return vscode.ExternalUriOpenerPriority.None;
		},
		openExternalUri(resolvedUri: vscode.Uri) {
			positron.window.previewUrl(resolvedUri);
		}
	}, {
		schemes: ['http', 'https'],
		label: vscode.l10n.t("Open in Viewer pane"),
	}));
}

