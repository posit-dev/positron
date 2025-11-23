/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { PositronRunAppApiImpl } from './api.js';
import { AppLauncherTerminalLink } from './types.js';
import { HTTP_URL_REGEX } from './constants.js';
import { getTerminalAppUrlOpenLocationConfig } from './api-utils.js';

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
					terminal: context.terminal,
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
		const appLinkOpenLocation = getTerminalAppUrlOpenLocationConfig();
		switch (appLinkOpenLocation) {
			case 'viewer':
				// Open the URL in the Viewer pane with source attribution
				await this.previewUrlWithSource(uri, link.terminal);
				break;
			case 'browser':
				// Open the URL in a new browser window
				await vscode.env.openExternal(uri);
				break;
			case 'ask':
				// For ask or default, show a quick pick menu to let the user choose
				await this.showQuickPick(uri, link.terminal);
			default:
				break;
		}
	}

	/**
	 * Opens a URL in the viewer with source attribution from the terminal.
	 * @param uri The URI to preview
	 * @param terminal The terminal that is the source of the URL
	 */
	private async previewUrlWithSource(uri: vscode.Uri, terminal: vscode.Terminal): Promise<void> {
		// Get the terminal's process ID to attribute as the source
		if (terminal.processId) {
			try {
				const processId = await terminal.processId;
				if (processId !== undefined) {
					positron.window.previewUrl(uri, {
						type: positron.PreviewSourceType.Terminal,
						id: String(processId)
					});
					return;
				}
			} catch (e) {
				// Failed to get process ID, fall through to open without source
			}
		}
		// Fallback: open without source
		positron.window.previewUrl(uri);
	}

	/**
	 * Shows a quick pick menu to allow the user to choose how to open the provided URI.
	 * @param uri The URI to open
	 * @param terminal The terminal that is the source of the URL
	 */
	async showQuickPick(uri: vscode.Uri, terminal: vscode.Terminal): Promise<void> {
		const viewerPane = vscode.l10n.t('Open in Viewer pane');
		const browserWindow = vscode.l10n.t('Open in new browser window');
		const configureDefault = vscode.l10n.t('Configure default app link opening location');

		const quickPick = vscode.window.createQuickPick();
		quickPick.title = vscode.l10n.t('Open App Link');
		quickPick.placeholder = vscode.l10n.t('How would you like to open: {0}', uri.toString(true));
		quickPick.items = [
			{ label: viewerPane, },
			{ label: browserWindow, },
		];
		quickPick.buttons = [
			{
				// Include a button for the user to configure the default app link opening location
				iconPath: new vscode.ThemeIcon('settings-gear'),
				tooltip: configureDefault,
			},
		];

		const disposables: vscode.Disposable[] = [];
		disposables.push(
			quickPick.onDidTriggerButton(async (e) => {
				if (e.tooltip === configureDefault) {
					// Open the settings editor to the appLauncher.terminalAppUrlOpenLocation setting
					await vscode.commands.executeCommand('workbench.action.openSettings', 'positron.appLauncher.terminalAppUrlOpenLocation');
				}
			}),
			quickPick.onDidAccept(async () => {
				const selected = quickPick.selectedItems[0];
				if (selected.label === viewerPane) {
					await this.previewUrlWithSource(uri, terminal);
				} else if (selected.label === browserWindow) {
					await vscode.env.openExternal(uri);
				}
				quickPick.hide();
			}),
			quickPick.onDidHide(() => {
				quickPick.dispose();
				disposables.forEach(d => d.dispose());
			})
		);

		quickPick.show();
	}
}
