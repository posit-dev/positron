/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export enum Config {
	ShellIntegrationEnabled = 'terminal.integrated.shellIntegration.enabled',
	ShowEnableShellIntegrationMessage = 'positron.appLauncher.showEnableShellIntegrationMessage',
	ShowShellIntegrationNotSupportedMessage = 'positron.appLauncher.showShellIntegrationNotSupportedMessage',
}

export type PositronProxyInfo = {
	proxyPath: string;
	externalUri: vscode.Uri;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

export type AppPreviewOptions = {
	terminalPid: number | undefined;
	proxyInfo?: PositronProxyInfo;
	urlPath?: string;
	appReadyMessage?: string;
	appUrlStrings?: string[];
};

export type AppLauncherTerminalLink = vscode.TerminalLink & {
	url: string;
	proxyUri: vscode.Uri;
	terminal: vscode.Terminal;
};
