/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from '../log';

/**
 * Migrate AWS settings from positron-assistant to the auth extension.
 * Reads old settings and writes them to the new location if not already set.
 */
export async function migrateAwsSettings(): Promise<void> {
	type AwsVars = { AWS_PROFILE?: string; AWS_REGION?: string };

	const oldVars = vscode.workspace
		.getConfiguration('positron.assistant.providerVariables')
		.inspect<AwsVars>('bedrock');
	const oldInference = vscode.workspace
		.getConfiguration('positron.assistant.bedrock')
		.inspect<string>('inferenceProfileRegion');

	const newVars = vscode.workspace
		.getConfiguration('authentication.aws')
		.inspect<AwsVars>('credentials');
	const newInference = vscode.workspace
		.getConfiguration('authentication.aws')
		.inspect<string>('inferenceProfileRegion');

	const newConfig = vscode.workspace
		.getConfiguration('authentication.aws');

	if (oldVars?.globalValue && !newVars?.globalValue) {
		await newConfig.update(
			'credentials', oldVars.globalValue,
			vscode.ConfigurationTarget.Global
		);
	}
	if (oldVars?.workspaceValue && !newVars?.workspaceValue) {
		await newConfig.update(
			'credentials', oldVars.workspaceValue,
			vscode.ConfigurationTarget.Workspace
		);
	}

	if (oldInference?.globalValue && !newInference?.globalValue) {
		await newConfig.update(
			'inferenceProfileRegion', oldInference.globalValue,
			vscode.ConfigurationTarget.Global
		);
	}
	if (oldInference?.workspaceValue && !newInference?.workspaceValue) {
		await newConfig.update(
			'inferenceProfileRegion', oldInference.workspaceValue,
			vscode.ConfigurationTarget.Workspace
		);
	}

	log.info('AWS settings migration complete');
}
