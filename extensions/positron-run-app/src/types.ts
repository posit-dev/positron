/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PreviewMode } from './positron-run-app';

export enum Config {
	ShellIntegrationEnabled = 'terminal.integrated.shellIntegration.enabled',
	ShowEnableShellIntegrationMessage = 'positron.appLauncher.showEnableShellIntegrationMessage',
	ShowShellIntegrationNotSupportedMessage = 'positron.appLauncher.showShellIntegrationNotSupportedMessage',
	PreviewMode = 'positron.runApp.previewMode',
	UrlDetectionTimeout = 'positron.runApp.urlDetectionTimeout',
}

/** How detecting an app's URL in its output ended. */
export enum UrlDetectionStatus {
	/** The URL appeared in the output. */
	Found,
	/** The app stopped before its URL appeared, so it most likely failed to start. */
	ExecutionEnded,
	/** The URL did not appear before the timeout. The app may still be running. */
	TimedOut,
	/** The app's output could not be read. */
	DetectionFailed,
}

export type UrlDetectionResult =
	| { status: UrlDetectionStatus.Found; url: URL }
	| { status: UrlDetectionStatus.ExecutionEnded }
	| { status: UrlDetectionStatus.TimedOut }
	| { status: UrlDetectionStatus.DetectionFailed; error: Error };

export type PositronProxyInfo = {
	proxyPath: string;
	externalUri: vscode.Uri;
	finishProxySetup: (targetOrigin: string) => Promise<void>;
};

export type AppPreviewOptions = {
	appName: string;
	preview?: Exclude<PreviewMode, 'none'>;
	terminal: vscode.Terminal;
	terminalPid: number | undefined;
	proxyInfo?: PositronProxyInfo;
	urlPath?: string;
	appReadyMessage?: string;
	appUrlStrings?: string[];
	urlDetectionTimeout?: number;
};

export type AppLauncherTerminalLink = vscode.TerminalLink & {
	url: string;
	proxyUri: vscode.Uri;
	terminal: vscode.Terminal;
};
