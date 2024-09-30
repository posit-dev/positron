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

	// Register the positronProxy.startHttpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startHttpProxyServer',
			async (targetOrigin: string) => await positronProxy.startHttpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.startHtmlProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.startHtmlProxyServer',
			async (targetPath: string) => await positronProxy.startHtmlProxyServer(targetPath)
		)
	);

	// Register the positronProxy.stopHttpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.stopHttpProxyServer',
			(targetOrigin: string) => positronProxy.stopHttpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.setHttpProxyServerStyles command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.setHttpProxyServerStyles',
			(styles: ProxyServerStyles) => positronProxy.setHttpProxyServerStyles(styles)
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

	// Add the PositronProxy object disposable.
	context.subscriptions.push(positronProxy);
}
