/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from './extension.js';
import { IS_POSITRON_WEB, IS_RUNNING_ON_PWB, APP_URL_PLACEHOLDER, URL_LIKE_REGEX, HTTP_URL_REGEX } from './constants.js';
import { Config } from './types.js';

export async function showEnableShellIntegrationMessage(rerunApplicationCallback: () => any): Promise<void> {
	// Don't show if the user disabled this message.
	if (!vscode.workspace.getConfiguration().get<boolean>(Config.ShowEnableShellIntegrationMessage)) {
		return;
	}

	// Prompt the user to enable shell integration.
	const enableShellIntegration = vscode.l10n.t('Enable Shell Integration');
	const notNow = vscode.l10n.t('Not Now');
	const dontAskAgain = vscode.l10n.t('Don\'t Ask Again');
	const selection = await vscode.window.showInformationMessage(
		vscode.l10n.t(
			'Shell integration is disabled. Would you like to enable shell integration for this ' +
			'workspace to automatically preview your application in the Viewer pane?',
		),
		enableShellIntegration,
		notNow,
		dontAskAgain,
	);

	if (selection === enableShellIntegration) {
		// Enable shell integration.
		const shellIntegrationConfig = vscode.workspace.getConfiguration('terminal.integrated.shellIntegration');
		await shellIntegrationConfig.update('enabled', true, vscode.ConfigurationTarget.Workspace);

		// Prompt the user to rerun the application.
		const rerunApplication = vscode.l10n.t('Rerun Application');
		const notNow = vscode.l10n.t('Not Now');
		const selection = await vscode.window.showInformationMessage(
			vscode.l10n.t('Shell integration is now enabled. Would you like to rerun the application?'),
			rerunApplication,
			notNow,
		);

		if (selection === rerunApplication) {
			// Rerun the application.
			rerunApplicationCallback();
		}
	} else if (selection === dontAskAgain) {
		// Disable the prompt for future runs.
		const runAppConfig = vscode.workspace.getConfiguration('positron.appLauncher');
		await runAppConfig.update('showShellIntegrationPrompt', false, vscode.ConfigurationTarget.Global);
	}
}

export async function showShellIntegrationNotSupportedMessage(): Promise<void> {
	// Don't show if the user disabled this message.
	if (!vscode.workspace.getConfiguration().get<boolean>(Config.ShowShellIntegrationNotSupportedMessage)) {
		return;
	}

	const learnMore = vscode.l10n.t('Learn More');
	const dismiss = vscode.l10n.t('Dismiss');
	const dontShowAgain = vscode.l10n.t('Don\'t Show Again');
	const selection = await vscode.window.showWarningMessage(
		vscode.l10n.t(
			'Shell integration isn\'t supported in this terminal, ' +
			'so automatic preview in the Viewer pane isn\'t available. ' +
			'To use this feature, please switch to a terminal that supports shell integration.'
		),
		learnMore,
		dismiss,
		dontShowAgain,
	);

	if (selection === learnMore) {
		await vscode.env.openExternal(vscode.Uri.parse('https://code.visualstudio.com/docs/terminal/shell-integration'));
	} else if (selection === dontShowAgain) {
		// Disable the prompt for future runs.
		const runAppConfig = vscode.workspace.getConfiguration('positron.appLauncher');
		await runAppConfig.update('showShellIntegrationNotSupportedMessage', false, vscode.ConfigurationTarget.Global);
	}
}

/**
 * Check if the Positron proxy should be used for the given app.
 * Generally, we should avoid skipping the proxy unless there is a good reason to do so, as the
 * proxy gives us the ability to intercept requests and responses to the app, which is useful for
 * things like debugging, applying styling or fixing up urls.
 * @param appName The name of the app; indicated in extensions/positron-python/src/client/positron/webAppCommands.ts
 * @returns Whether to use the Positron proxy for the app.
 */
export function shouldUsePositronProxy(appName: string) {
	// If we're running on Positron Desktop, don't use the proxy.
	if (!IS_POSITRON_WEB) {
		return false;
	}

	// Otherwise, check if the app is one of the known apps that don't work with the proxy.
	switch (appName.trim().toLowerCase()) {
		// Streamlit apps don't work in Positron on Workbench with SSL enabled when run through the proxy.
		case 'streamlit':
		// FastAPI apps don't work in Positron on Workbench when run through the proxy.
		case 'fastapi':
			if (IS_RUNNING_ON_PWB) {
				return false;
			}
			return true;
		default:
			// By default, proxy the app.
			return true;
	}
}

/**
 * Extracts a URL from a string using the provided appUrlStrings.
 * @param str The string to match the URL in.
 * @param appUrlStrings An array of app url strings to match and extract the URL from.
 * @returns The matched URL, or undefined if no URL is found.
 */
export function extractAppUrlFromString(str: string, appUrlStrings?: string[]) {
	if (appUrlStrings && appUrlStrings.length > 0) {
		// Try to match any of the provided appUrlStrings.
		log.debug('Attempting to match URL with:', appUrlStrings);
		for (const appUrlString of appUrlStrings) {
			if (!appUrlString.includes(APP_URL_PLACEHOLDER)) {
				log.warn(`Skipping '${appUrlString}' since it doesn't contain an ${APP_URL_PLACEHOLDER} placeholder.`);
				continue;
			}

			const pattern = appUrlString.replace(APP_URL_PLACEHOLDER, URL_LIKE_REGEX.source);
			const appUrlRegex = new RegExp(pattern);

			const match = str.match(appUrlRegex);
			if (match) {
				const endsWithAppUrl = appUrlString.endsWith(APP_URL_PLACEHOLDER);
				// Placeholder is at the end of the string. This is the most common case.
				// Example: 'The app is running at {{APP_URL}}'
				// [0] = 'The app is running at ', [1] = '{{APP_URL}}'
				// Also covers the case where the placeholder is the entire string.
				if (endsWithAppUrl) {
					return match[1];
				}

				const startsWithAppUrl = appUrlString.startsWith(APP_URL_PLACEHOLDER);
				// Placeholder is at the start of the string.
				// Example: '{{APP_URL}} is where the app is running'
				// [0] = '{{APP_URL}}', [1] = ' is where the app is running'
				if (startsWithAppUrl) {
					return match[0];
				}

				// Placeholder is in the middle of the string.
				// Example: 'Open {{APP_URL}} to view the app'
				// [0] = 'Open ', [1] = '{{APP_URL}}', [2] = ' to view the app'
				return match[1];
			}
		}
	}

	// Fall back to the default URL regex if no appUrlStrings were provided or matched.
	log.debug('No appUrlStrings matched. Falling back to default URL regex to match URL.');
	return str.match(HTTP_URL_REGEX)?.[0];
}

export function getTerminalAppUrlOpenLocationConfig() {
	return vscode.workspace.getConfiguration('positron.appLauncher').get<string>('terminalAppUrlOpenLocation');
}
