/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { IDataConnectionSchemaNode, summarizeDataConnectionSchema } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';

// The id of the getSchema command. Always registered, regardless of the dataConnections.enabled
// feature flag -- see getDataConnectionSchema for why.
export const GET_SCHEMA_COMMAND_ID = 'positronDataConnections.getSchema';

/**
 * Arguments for the getSchema command.
 */
export interface IDataConnectionsGetSchemaArgs {
	// The id of the saved data connection profile to summarize the schema for.
	profileId: string;

	// The number of real schema levels to include. See summarizeDataConnectionSchema for how
	// depth is counted. Omit to use the helper's default.
	maxDepth?: number;
}

/**
 * Result of the getSchema command. A discriminated union on `connected` (and `enabled`) rather
 * than throwing, so a cold-start caller (e.g. Assistant checking whether a profile is worth
 * querying) can branch on the payload without a try/catch:
 * - `{ enabled: false }` -- the dataConnections.enabled feature flag is off.
 * - `{ connected: false }` -- the feature is on, but no live instance exists for the profile
 *   (unsaved profile id, or a saved profile that isn't currently connected).
 * - `{ connected: true, ... }` -- the summarized schema for the profile's live connection.
 */
export type IDataConnectionsGetSchemaResult =
	| { enabled: false }
	| { connected: false }
	| {
		connected: true;
		profileId: string;
		schema: IDataConnectionSchemaNode[];
		truncated: boolean;
	};

/**
 * Summarizes the live schema (tables, columns, and their types) for a saved data connection
 * profile, for Assistant awareness of a connection's structure. Unlike getConnections, this
 * requires a live instance -- schema browsing needs an open connection to query against, so there
 * is no cold-start (disconnected) form of this payload. Returns `{ connected: false }` rather than
 * throwing when no live instance exists, mirroring how getConnections reports disconnected
 * profiles, so a caller can prompt the user to connect instead of hitting an error.
 *
 * Always registered, so Assistant-side feature detection is a simple getCommands() check; returns
 * `{ enabled: false }` when the dataConnections.enabled feature flag is off. Unlike getConnections,
 * this does not additionally check ai.enabled: the command only exposes schema for a connection
 * the user already opened themselves, not connection credentials or generated code.
 * @param accessor The services accessor.
 * @param args The command arguments.
 */
export async function getDataConnectionSchema(
	accessor: ServicesAccessor,
	args: IDataConnectionsGetSchemaArgs,
): Promise<IDataConnectionsGetSchemaResult> {
	const configurationService = accessor.get(IConfigurationService);
	if (configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) !== true) {
		return { enabled: false };
	}

	const dataConnectionsService = accessor.get(IPositronDataConnectionsService);
	const instance = dataConnectionsService.getInstanceForProfile(args.profileId);
	if (instance === undefined) {
		return { connected: false };
	}

	const { schema, truncated } = await summarizeDataConnectionSchema(instance.connectionHandle, args.maxDepth);

	return { connected: true, profileId: args.profileId, schema, truncated };
}

CommandsRegistry.registerCommand(GET_SCHEMA_COMMAND_ID, getDataConnectionSchema);
