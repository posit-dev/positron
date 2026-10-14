/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	AWS_AUTH_PROVIDER_ID,
	DATABRICKS_AUTH_PROVIDER_ID,
	SNOWFLAKE_AUTH_PROVIDER_ID,
} from './constants';

export interface ProviderMetadata {
	/** Auth provider id, which is also the provider's id in the catalog (providers.json). */
	readonly id: string;
	readonly displayName: string;
}

/**
 * The providers whose credentials this extension owns: each authenticates
 * against a general-purpose cloud credential system, or against Posit
 * Workbench managed credentials, rather than holding a language-model API key.
 *
 * Keyed by a short internal name; `id` is both the `vscode.authentication`
 * provider id and the entry in the resolved provider catalog (providers.json)
 * that supplies its connection settings.
 */
export const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
	amazonBedrock: {
		id: AWS_AUTH_PROVIDER_ID,
		displayName: 'Amazon Bedrock',
	},
	snowflake: {
		id: SNOWFLAKE_AUTH_PROVIDER_ID,
		displayName: 'Snowflake Cortex',
	},
	databricks: {
		id: DATABRICKS_AUTH_PROVIDER_ID,
		displayName: 'Databricks',
	},
};
