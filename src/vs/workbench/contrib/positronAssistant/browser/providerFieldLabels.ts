/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';

/**
 * Label for a provider's `baseUrl` field. Most providers take an API base URL,
 * but for some the field carries something else entirely -- Databricks stores
 * the workspace host, from which the serving-endpoints URL is derived, and
 * Snowflake stores the bare account identifier, from which the Cortex URL is
 * derived (#13750) -- so a generic "Base URL" would mislabel the input.
 */
export function getBaseUrlLabel(providerId: string): string {
	if (providerId === 'databricks') {
		return localize('positron.providerFieldLabels.workspaceUrl', "Workspace URL");
	}
	if (providerId === 'snowflake-cortex') {
		return localize('positron.providerFieldLabels.accountIdentifier', "Account Identifier");
	}
	return localize('positron.providerFieldLabels.baseUrl', "Base URL");
}
