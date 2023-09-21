/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PositronProxy } from './positronProxy';

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

	// Register the positronProxy.stopHelpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.stopHelpProxyServer',
			(targetOrigin: string) => positronProxy.stopHelpProxyServer(targetOrigin)
		)
	);

	// Register the positronProxy.stopHelpProxyServer command and add its disposable.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronProxy.setHelpProxyServerStyles',
			(styles: ProxyServerStyles) => positronProxy.setHelpProxyServerStyles(styles)
		)
	);

	// Add the PositronProxy object disposable.
	context.subscriptions.push(positronProxy);
}
