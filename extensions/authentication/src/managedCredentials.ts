/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IS_RUNNING_ON_PWB } from './constants';

/**
 * Managed credentials backed by an environment variable.
 */
export interface EnvVarCredentialConfig {
	readonly kind: 'env-var';
	readonly displayName: string;
	/** Environment variable name that indicates managed credentials are available */
	readonly envVar: string;
	/** Validator function to confirm the env var value for managed credentials */
	readonly validator: (value: string) => boolean;
}

/**
 * Managed credentials provided by PWB extension.
 */
export interface AuthTokenCredentialConfig {
	readonly kind: 'auth-token';
	readonly displayName: string;
	readonly authProvider: {
		readonly id: string;
		readonly scopes: string[];
	};
	readonly validator: () => boolean;
}

/**
 * Configuration for managed credentials on Posit Workbench.
 */
export type ManagedCredentialConfig =
	| EnvVarCredentialConfig
	| AuthTokenCredentialConfig;

/**
 * AWS managed credentials configuration for Posit Workbench.
 */
export const AWS_MANAGED_CREDENTIALS: EnvVarCredentialConfig = {
	kind: 'env-var',
	displayName: 'AWS managed credentials',
	envVar: 'AWS_WEB_IDENTITY_TOKEN_FILE',
	validator: (value: string) => value.includes('posit-workbench'),
};

/**
 * Foundry managed credentials configuration for Posit Workbench.
 */
export const FOUNDRY_MANAGED_CREDENTIALS: AuthTokenCredentialConfig = {
	kind: 'auth-token',
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
 *
 * @param credentialConfig - The credential configuration to check
 * @returns Whether managed credentials are available and valid
 */
export function hasManagedCredentials(credentialConfig: ManagedCredentialConfig): boolean {
	if (!IS_RUNNING_ON_PWB) {
		return false;
	}

	switch (credentialConfig.kind) {
		case 'auth-token': {
			const ext = vscode.extensions.getExtension('rstudio.rstudio-workbench');
			if (!ext?.isActive) {
				return false;
			}
			return credentialConfig.validator();
		}
		case 'env-var': {
			const tokenEnv = process.env[credentialConfig.envVar];
			return !!tokenEnv && credentialConfig.validator(tokenEnv);
		}
	}
}
