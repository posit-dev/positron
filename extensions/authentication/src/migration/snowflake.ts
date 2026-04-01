/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { log } from '../log';

/**
 * Migrate Snowflake settings from positron-assistant to the auth extension.
 * Reads old settings and writes them to the new location if not already set.
 */
export async function migrateSnowflakeSettings(): Promise<void> {
	type SnowflakeVars = { SNOWFLAKE_ACCOUNT?: string; SNOWFLAKE_HOME?: string };

	const oldVars = vscode.workspace
		.getConfiguration('positron.assistant.providerVariables')
		.inspect<SnowflakeVars>('snowflake');

	const newVars = vscode.workspace
		.getConfiguration('authentication.snowflake')
		.inspect<SnowflakeVars>('credentials');

	const newConfig = vscode.workspace
		.getConfiguration('authentication.snowflake');

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

	log.info('Snowflake settings migration complete');
}
