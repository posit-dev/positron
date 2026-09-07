/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AWS_AUTH_PROVIDER_ID,
	DATABRICKS_AUTH_PROVIDER_ID,
	FOUNDRY_AUTH_PROVIDER_ID,
	GOOGLE_CLOUD_AUTH_PROVIDER_ID,
	SNOWFLAKE_AUTH_PROVIDER_ID,
} from './constants';

export interface ProviderMetadata {
	id: string;
	displayName: string;
	/** Provider id in the resolved catalog (providers.json). */
	readonly catalogId: string;
}

/**
 * The providers whose credentials this extension owns: each authenticates
 * against a general-purpose cloud credential system, or against Posit
 * Workbench managed credentials, rather than holding a language-model API key.
 *
 * Keyed by a short internal name; `id` is the `vscode.authentication` provider
 * id declared in `contributes.authentication`, and `catalogId` is the entry in
 * the resolved provider catalog (providers.json) that supplies its connection
 * settings.
 */
export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
	amazonBedrock: {
		id: AWS_AUTH_PROVIDER_ID,
		displayName: 'Amazon Bedrock',
		catalogId: 'bedrock',
	},
	foundry: {
		id: FOUNDRY_AUTH_PROVIDER_ID,
		displayName: 'Microsoft Foundry',
		catalogId: 'ms-foundry',
	},
	snowflake: {
		id: SNOWFLAKE_AUTH_PROVIDER_ID,
		displayName: 'Snowflake Cortex',
		catalogId: 'snowflake-cortex',
	},
	geap: {
		id: GOOGLE_CLOUD_AUTH_PROVIDER_ID,
		displayName: 'Gemini Enterprise Agent Platform',
		catalogId: 'google-vertex',
	},
	databricks: {
		id: DATABRICKS_AUTH_PROVIDER_ID,
		displayName: 'Databricks',
		catalogId: 'databricks',
	},
};
