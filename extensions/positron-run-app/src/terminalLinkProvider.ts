/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { PositronRunAppApiImpl } from './api.js';
import { AppLauncherTerminalLink } from './types.js';
import { HTTP_URL_REGEX } from './constants.js';

/**
 * A provider for terminal links that handles app URLs.
 *
 * This is needed because the default openers are not aware of the proxied server URLs
 * that the App Launcher uses for previewing the application.
 */
export class AppLauncherTerminalLinkProvider implements vscode.TerminalLinkProvider {
	constructor(private readonly positronRunApp: PositronRunAppApiImpl) { }

	/**
	 * Locates the relevant App Launcher terminal links in the provided terminal context.
	 * @param context The context of the terminal link, which includes the line of text in the terminal.
	 * @param _token The cancellation token, which can be used to cancel the operation.
	 * @returns A promise that resolves to an array of matched terminal links.
	 */
	async provideTerminalLinks(context: vscode.TerminalLinkContext, _token: vscode.CancellationToken): Promise<AppLauncherTerminalLink[]> {
		const links: AppLauncherTerminalLink[] = [];
		const matches = context.line.matchAll(HTTP_URL_REGEX);
		for (const match of matches) {
			if (match.index !== undefined) {
				const url = match[0];
				const proxyUri = this.positronRunApp.getProxyServerUri(url);
				if (!proxyUri) {
					// If we don't have a proxy URI for this URL, we'll skip it
					// and let the default link handling take care of it.
					continue;
				}

				// Otherwise, we will handle the app link via this extension.
				links.push({
					startIndex: match.index,
					length: url.length,
					tooltip: vscode.l10n.t('Open App URL'),
					url,
					proxyUri,
				});
			}
		}
		return links;

	}

	/**
	 * Handles the terminal link by opening the URL in either the Viewer pane or a new browser window.
	 * @param link The terminal link to handle, which contains the URL and proxy URI.
	 */
	async handleTerminalLink(link: AppLauncherTerminalLink): Promise<void> {
		const uri = await vscode.env.asExternalUri(link.proxyUri);

		// Ask the user if they want to open the URL in the Viewer or in the a new browser tab.
		const viewerPane = vscode.l10n.t('Open in Viewer pane');
		const browserWindow = vscode.l10n.t('Open in new browser window');
		const choice = await vscode.window.showQuickPick(
			[
				{ label: viewerPane },
				{ label: browserWindow }
			],
			{
				placeHolder: vscode.l10n.t('How would you like to open: {0}', uri.toString())
			}
		);
		if (!choice) {
			return;
		}
		if (choice.label === viewerPane) {
			positron.window.previewUrl(uri);
		} else {
			await vscode.env.openExternal(uri);
		}
	}
}
