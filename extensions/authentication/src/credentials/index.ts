/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export { resolveAwsChainInit } from './aws';
export { resolveGoogleVertexCredential } from './googleVertex';
export type { GoogleVertexCredentialPayload } from './googleVertex';
export {
	checkForUpdatedSnowflakeCredentials,
	constructSnowflakeBaseUrl,
	detectSnowflakeCredentials,
	getConfiguredSnowflakeAccount,
	getSnowflakeConnectionsTomlPath,
	isValidSnowflakeAccount,
} from './snowflake';
export type {
	CredentialUpdateResult,
	SnowflakeCredentialConfig,
	SnowflakeProviderVariables,
} from './snowflake';
