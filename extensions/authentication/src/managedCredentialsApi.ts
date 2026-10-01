/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DATABRICKS_AUTH_PROVIDER_ID, SNOWFLAKE_AUTH_PROVIDER_ID } from './constants';
import { detectDatabricksConfigCredentials } from './credentials/databricks';
import { readSnowflakeManagedCredentials } from './credentials/snowflake';
import { hasManagedCredentials } from './managedCredentials';

/** A Workbench-managed credential, read as one unit from the file Workbench provisions. */
export interface ManagedCredential {
	/** The current access token. */
	readonly accessToken: string;
	/**
	 * What the token is for: the Snowflake account identifier, or the Databricks workspace host
	 * (possibly with a scheme).
	 */
	readonly locator: string;
}

/**
 * The managed-credentials surface this extension exports for other extensions (the Snowflake and
 * Databricks data connection drivers).
 *
 * Consumers declare a structural copy of this interface rather than importing it, since extensions
 * cannot import each other's sources.
 */
export interface ManagedCredentialsApi {
	/**
	 * Reads the credential Posit Workbench provisions for the given authentication provider id
	 * (`snowflake-cortex` or `databricks`). The token and locator come from the same read of the
	 * Workbench-provisioned file, so a rotated token is never paired with a stale locator, and the
	 * user's own stored keys or configured locators are never substituted. Undefined outside
	 * Workbench, for other provider ids, or when the file is missing or incomplete.
	 */
	getManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined>;
}

/** Reads the managed credential for a provider id from its Workbench-provisioned file. */
async function readManagedCredential(authProviderId: string): Promise<ManagedCredential | undefined> {
	if (!hasManagedCredentials(authProviderId)) {
		return undefined;
	}
	switch (authProviderId) {
		case SNOWFLAKE_AUTH_PROVIDER_ID: {
			// hasManagedCredentials has confirmed SNOWFLAKE_HOME points at the managed directory.
			// Read without deriving the Cortex base URL, whose account validation rejects regional
			// identifiers (e.g. `xy12345.us-east-2.aws`) that the data drivers accept.
			const credential = readSnowflakeManagedCredentials({ home: process.env.SNOWFLAKE_HOME });
			return credential?.account ? { accessToken: credential.token, locator: credential.account } : undefined;
		}
		case DATABRICKS_AUTH_PROVIDER_ID: {
			// hasManagedCredentials has confirmed DATABRICKS_CONFIG_FILE points at the managed file.
			const credential = await detectDatabricksConfigCredentials();
			return credential?.host ? { accessToken: credential.token, locator: credential.host } : undefined;
		}
		default:
			return undefined;
	}
}

/** Builds the exported managed-credentials API. */
export function createManagedCredentialsApi(): ManagedCredentialsApi {
	return {
		getManagedCredential: readManagedCredential,
	};
}
