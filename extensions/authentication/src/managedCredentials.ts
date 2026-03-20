/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IS_RUNNING_ON_PWB } from './constants';

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export interface ManagedCredentialConfig {
	readonly displayName: string;
	readonly authProvider: {
		readonly id: string;
		readonly scopes: string[];
	};
	readonly validator: () => boolean;
}

/**
 * Foundry managed credentials configuration for Posit Workbench.
 */
export const FOUNDRY_MANAGED_CREDENTIALS: ManagedCredentialConfig = {
	displayName: 'Foundry managed credentials',
	authProvider: {
		id: 'posit-workbench',
		scopes: ['msfoundry'],
	},
	validator: () => {
		const config = vscode.workspace.getConfiguration('positWorkbench.foundry');
		return !!config.get<string>('endpoint', '');
	},
};

/**
 * Checks whether managed credentials are available for the given
 * credential configuration on Posit Workbench.
 */
export function hasManagedCredentials(
	credentialConfig: ManagedCredentialConfig
): boolean {
	if (!IS_RUNNING_ON_PWB) {
		return false;
	}

	const ext = vscode.extensions.getExtension('rstudio.rstudio-workbench');
	if (!ext?.isActive) {
		return false;
	}
	return credentialConfig.validator();
}
