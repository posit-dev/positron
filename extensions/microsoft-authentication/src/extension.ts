/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, env, ExtensionContext, l10n, window, workspace } from 'vscode';
import * as extensionV1 from './extensionV1';
import * as extensionV2 from './extensionV2';
import { createExperimentationService } from './common/experimentation';
import { MicrosoftAuthenticationTelemetryReporter } from './common/telemetryReporter';
import { IExperimentationService } from 'vscode-tas-client';
import Logger from './logger';

function shouldUseMsal(expService: IExperimentationService): boolean {
	// First check if there is a setting value to allow user to override the default
	const inspect = workspace.getConfiguration('microsoft').inspect<boolean>('useMsal');
	if (inspect?.workspaceFolderValue !== undefined) {
		Logger.debug(`Acquired MSAL enablement value from 'workspaceFolderValue'. Value: ${inspect.workspaceFolderValue}`);
		return inspect.workspaceFolderValue;
	}
	if (inspect?.workspaceValue !== undefined) {
		Logger.debug(`Acquired MSAL enablement value from 'workspaceValue'. Value: ${inspect.workspaceValue}`);
		return inspect.workspaceValue;
	}
	if (inspect?.globalValue !== undefined) {
		Logger.debug(`Acquired MSAL enablement value from 'globalValue'. Value: ${inspect.globalValue}`);
		return inspect.globalValue;
	}

	// Then check if the experiment value
	const expValue = expService.getTreatmentVariable<boolean>('vscode', 'microsoft.useMsal');
	if (expValue !== undefined) {
		Logger.debug(`Acquired MSAL enablement value from 'exp'. Value: ${expValue}`);
		return expValue;
	}

	Logger.debug('Acquired MSAL enablement value from default. Value: false');
	// If no setting or experiment value is found, default to false
	return false;
}
let useMsal: boolean | undefined;

export async function activate(context: ExtensionContext) {
	const mainTelemetryReporter = new MicrosoftAuthenticationTelemetryReporter(context.extension.packageJSON.aiKey);
	const expService = await createExperimentationService(
		context,
		mainTelemetryReporter,
		env.uriScheme !== 'vscode', // isPreRelease
	);
	useMsal = shouldUseMsal(expService);

	context.subscriptions.push(workspace.onDidChangeConfiguration(async e => {
		if (!e.affectsConfiguration('microsoft.useMsal') || useMsal === shouldUseMsal(expService)) {
			return;
		}

		const reload = l10n.t('Reload');
		const result = await window.showInformationMessage(
			'Reload required',
			{
				modal: true,
				detail: l10n.t('Microsoft Account configuration has been changed.'),
			},
			reload
		);

		if (result === reload) {
			commands.executeCommand('workbench.action.reloadWindow');
		}
	}));
	// Only activate the new extension if we are not running in a browser environment
	if (useMsal && typeof navigator === 'undefined') {
		await extensionV2.activate(context, mainTelemetryReporter);
	} else {
		await extensionV1.activate(context, mainTelemetryReporter.telemetryReporter);
	}
}

export function deactivate() {
	if (useMsal) {
		extensionV2.deactivate();
	} else {
		extensionV1.deactivate();
	}
}
