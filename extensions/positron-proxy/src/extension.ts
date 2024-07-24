/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { PositronProxy } from './positronProxy';
import path from 'path';

/**
 * ProxyServerStyles type.
 */
export type ProxyServerStyles = { readonly [key: string]: string | number };

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Create the PositronProxy object.
	const positronProxy = new PositronProxy(context);

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

	// Register the positronProxy.stopHelpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.stopHelpProxyServer',
			(targetOrigin: string) => positronProxy.stopHelpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.setHelpProxyServerStyles command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.setHelpProxyServerStyles',
			(styles: ProxyServerStyles) => positronProxy.setHelpProxyServerStyles(styles)
		)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.showHtmlPreview',
			(path: vscode.Uri) => {
				positron.window.previewHtml(path.toString());
			})
	);

	// Add the PositronProxy object disposable.
	context.subscriptions.push(positronProxy);
}
