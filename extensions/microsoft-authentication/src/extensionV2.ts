/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Environment, EnvironmentParameters } from '@azure/ms-rest-azure-env';
import Logger from './logger';
import { MsalAuthProvider } from './node/authProvider';
import { UriEventHandler } from './UriEventHandler';
import { authentication, commands, ExtensionContext, l10n, window, workspace, Disposable } from 'vscode';
import { MicrosoftAuthenticationTelemetryReporter, MicrosoftSovereignCloudAuthenticationTelemetryReporter } from './common/telemetryReporter';

async function initMicrosoftSovereignCloudAuthProvider(
	context: ExtensionContext,
	uriHandler: UriEventHandler
): Promise<Disposable | undefined> {
	const environment = workspace.getConfiguration('microsoft-sovereign-cloud').get<string | undefined>('environment');
	let authProviderName: string | undefined;
	if (!environment) {
		return undefined;
	}

	if (environment === 'custom') {
		const customEnv = workspace.getConfiguration('microsoft-sovereign-cloud').get<EnvironmentParameters>('customEnvironment');
		if (!customEnv) {
			const res = await window.showErrorMessage(l10n.t('You must also specify a custom environment in order to use the custom environment auth provider.'), l10n.t('Open settings'));
			if (res) {
				await commands.executeCommand('workbench.action.openSettingsJson', 'microsoft-sovereign-cloud.customEnvironment');
			}
			return undefined;
		}
		try {
			Environment.add(customEnv);
		} catch (e) {
			const res = await window.showErrorMessage(l10n.t('Error validating custom environment setting: {0}', e.message), l10n.t('Open settings'));
			if (res) {
				await commands.executeCommand('workbench.action.openSettings', 'microsoft-sovereign-cloud.customEnvironment');
			}
			return undefined;
		}
		authProviderName = customEnv.name;
	} else {
		authProviderName = environment;
	}

	const env = Environment.get(authProviderName);
	if (!env) {
		await window.showErrorMessage(l10n.t('The environment `{0}` is not a valid environment.', authProviderName), l10n.t('Open settings'));
		return undefined;
	}

	const authProvider = new MsalAuthProvider(
		context,
		new MicrosoftSovereignCloudAuthenticationTelemetryReporter(context.extension.packageJSON.aiKey),
		window.createOutputChannel(l10n.t('Microsoft Sovereign Cloud Authentication'), { log: true }),
		uriHandler,
		env
	);
	await authProvider.initialize();
	const disposable = authentication.registerAuthenticationProvider(
		'microsoft-sovereign-cloud',
		authProviderName,
		authProvider,
		{ supportsMultipleAccounts: true }
	);
	context.subscriptions.push(disposable);
	return disposable;
}

export async function activate(context: ExtensionContext, mainTelemetryReporter: MicrosoftAuthenticationTelemetryReporter) {
	const uriHandler = new UriEventHandler();
	context.subscriptions.push(uriHandler);
	const authProvider = new MsalAuthProvider(
		context,
		mainTelemetryReporter,
		Logger,
		uriHandler
	);
	await authProvider.initialize();
	context.subscriptions.push(authentication.registerAuthenticationProvider(
		'microsoft',
		'Microsoft',
		authProvider,
		{ supportsMultipleAccounts: true }
	));

	let microsoftSovereignCloudAuthProviderDisposable = await initMicrosoftSovereignCloudAuthProvider(context, uriHandler);

	context.subscriptions.push(workspace.onDidChangeConfiguration(async e => {
		if (e.affectsConfiguration('microsoft-sovereign-cloud')) {
			microsoftSovereignCloudAuthProviderDisposable?.dispose();
			microsoftSovereignCloudAuthProviderDisposable = await initMicrosoftSovereignCloudAuthProvider(context, uriHandler);
		}
	}));
}

export function deactivate() { }
