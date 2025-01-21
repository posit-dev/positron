/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronProxy } from './positronProxy';

/**
 * ProxyServerStyles type.
 */
export type ProxyServerStyles = { readonly [key: string]: string | number };

/**
 * Positron Proxy log output channel.
 */
export const log = vscode.window.createOutputChannel('HTML Proxy Server', { log: true });

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Create the PositronProxy object.
	const positronProxy = new PositronProxy(context);

	// Create the log output channel.
	context.subscriptions.push(log);

	// Register the positronProxy.startHelpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startHelpProxyServer',
			async (targetOrigin: string) => await positronProxy.startHelpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.startHtmlProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startHtmlProxyServer',
			async (targetPath: string) => await positronProxy.startHtmlProxyServer(targetPath)
		)
	);

	// Register the positronProxy.startHttpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startHttpProxyServer',
			async (targetOrigin: string) => await positronProxy.startHttpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.startPendingProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startPendingProxyServer',
			async () => await positronProxy.startPendingHttpProxyServer()
		)
	);

	// Register the positronProxy.stopProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.stopProxyServer',
			(targetOrigin: string) => positronProxy.stopProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.setHelpProxyServerStyles command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.setHelpProxyServerStyles',
			(styles: ProxyServerStyles) => positronProxy.setHelpProxyServerStyles(styles)
		)
	);

	// Register the positronProxy.showHtmlPreview command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.showHtmlPreview',
			(path: vscode.Uri) => {
				positron.window.previewHtml(path.toString());
			})
	);

	// Register the positronProxy.showHtmlPreview command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.openBrowserPreview',
			async (path: vscode.Uri) => {
				let targetPath = path;

				// On a native desktop build, we can open the file directly in
				// the browser, without starting a proxy server. But in all
				// other cases (web, remote SSH, etc), the file is not likely
				// to be accessible to the browser, so we need to start a proxy
				// server.
				if (vscode.env.uiKind === vscode.UIKind.Web || vscode.env.remoteName) {
					// Create a proxy server and get the URI to open in the browser.
					const proxyUri = await positronProxy.startHtmlProxyServer(path.toString());

					// Translate the proxy URI to an external URI.
					targetPath = await vscode.env.asExternalUri(vscode.Uri.parse(proxyUri));
				}


				// Open the external URI in the default browser.
				vscode.env.openExternal(targetPath);
			})
	);

	// Add the PositronProxy object disposable.
	context.subscriptions.push(positronProxy);
}
