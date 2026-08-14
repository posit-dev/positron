/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionProfile, resolveDataConnectionMechanism } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionSchemaSummary, IDataConnectionSchemaSummaryOptions, summarizeDataConnectionSchema } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';

/**
 * Whether the data connections commands should produce a payload at all: they go quiet when the
 * dataConnections.enabled feature flag is off. The commands stay registered either way, so
 * Assistant-side feature detection is a simple getCommands() check.
 *
 * Deliberately not gated on the ai.enabled main switch. These commands report the user's own
 * connection configuration and schema; they don't call a model or surface an AI action, which is
 * what ai.enabled is for. No other agentCompatible command in the workbench gates on it either --
 * agentCompatible drives discovery, and Assistant is itself gated on ai.enabled, so gating here
 * only takes the inspect actions in positronDataConnectionsInspectActions.ts away from a user who
 * turned AI off for unrelated reasons.
 * @param configurationService The configuration service.
 */
export function isDataConnectionsCommandEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === true;
}

/**
 * Flat JSON payload for a single language a data connection profile supports: the profile's
 * preferred (or default) connection code variant, its secret-free generated code, and the name of
 * the variable that code binds the connection to.
 */
export interface IDataConnectionsGetConnectionsLanguageResult {
	// The id of the variant this payload reflects: the profile's stored preference for this
	// language, falling back to the driver's default (variants[0]) when unset or stale.
	preferredVariantId: string;

	// The secret-free generated connection code for the variant above.
	code: string;

	// The name of the variable the generated code binds the connection/board/engine to (e.g.
	// 'conn', 'con', 'engine', 'board'), parsed from the code's first top-level assignment.
	// Undefined if no such assignment could be found.
	variableName?: string;
}

/**
 * Flat JSON payload for a single data connection profile, as returned by the getConnections
 * command. Contains everything Assistant needs to discover a configured connection cold (with no
 * live instance): its identity, redacted parameter values, and per-language connection code.
 */
export interface IDataConnectionsGetConnectionsResult {
	profileId: string;
	connectionName: string;
	driverId: string;
	driverName: string;
	mechanismId: string;

	// Whether a live instance currently exists for this profile.
	connected: boolean;

	// The profile's parameter values. Never contains cleartext secrets: non-secret values pass
	// through as-is; secret values (e.g. a password) appear only in their redacted display form
	// (via the driver's redactParameterValue), or are omitted entirely when the driver does not
	// implement redaction.
	parameterValues: DataConnectionParameterValues;

	// The profile's connection code per supported language, keyed by language id. A language is
	// absent if the driver could not generate code for it from the profile's current parameters.
	languages: Record<string, IDataConnectionsGetConnectionsLanguageResult>;
}

// Matches a top-level (unindented) `name = ...` (Python) or `name <- ...` (R) assignment -- the
// pattern every built-in driver's generateConnectionCode uses to bind the connection, board, or
// engine it creates. Indented lines (e.g. keyword arguments inside a multi-line call) don't
// match, since \w excludes the leading whitespace.
const CONNECTION_VARIABLE_PATTERN = /^(?<variableName>\w+)\s*(?:=|<-)\s*\S/gm;

/**
 * Parses the name of the variable a generated connection code snippet binds. Takes the last
 * top-level assignment rather than the first: built-in drivers only ever emit one, but a driver
 * is free to emit a preparatory statement (e.g. a config variable) before the real bind line, and
 * the bind is always the final top-level assignment in the snippet.
 * @param code The generated connection code.
 */
function extractConnectionVariableName(code: string): string | undefined {
	let variableName: string | undefined;
	for (const match of code.matchAll(CONNECTION_VARIABLE_PATTERN)) {
		variableName = match.groups?.variableName;
	}
	return variableName;
}

/**
 * Builds the profile's parameter values for the getConnections payload: non-secret values as-is,
 * plus a redacted display string for each secret parameter that has one. Never reads a secret
 * parameter's cleartext value directly -- redaction is delegated to
 * {@link IPositronDataConnectionsService.getRedactedParameterValues}, which keeps the cleartext
 * within the service/driver and returns only the redacted result.
 * @param profile The data connection profile.
 * @param dataConnectionsService The data connections service.
 */
async function getRedactedParameterValues(
	profile: IDataConnectionProfile,
	dataConnectionsService: IPositronDataConnectionsService,
): Promise<DataConnectionParameterValues> {
	// profile.parameterValues never contains secret values, so this starts as the full non-secret set.
	const parameterValues: DataConnectionParameterValues = { ...profile.parameterValues };

	const redacted = await dataConnectionsService.getRedactedParameterValues(
		profile.id,
		dataConnectionsService.getProfileSecretIds(profile.id),
	);
	Object.assign(parameterValues, redacted);

	return parameterValues;
}

/**
 * Builds the per-language connection code payload for a profile, using the profile's preferred
 * variant per language (falling back to the driver's default) -- the same generateConnectionCode
 * call dataConnectionEntryRow.tsx uses to populate the Connect With dialog. A driver that throws
 * for one language (e.g. it doesn't support code generation for the given parameters) only omits
 * that language; it doesn't fail the rest of the payload.
 * @param profile The data connection profile.
 * @param mechanismId The id of the mechanism the profile was configured with.
 * @param driver The registered driver for the profile.
 * @param logService The log service.
 */
async function getLanguagePayloads(
	profile: IDataConnectionProfile,
	mechanismId: string,
	driver: IDataConnectionDriver,
	logService: ILogService,
): Promise<Record<string, IDataConnectionsGetConnectionsLanguageResult>> {
	const languages: Record<string, IDataConnectionsGetConnectionsLanguageResult> = {};

	await Promise.all(driver.metadata.supportedLanguageIds.map(async languageId => {
		// The profile's own parameterValues never contains secret values, so this is always the
		// secret-free preview.
		let variants;
		try {
			variants = await driver.generateConnectionCode(mechanismId, languageId, profile.parameterValues);
		} catch (err) {
			logService.error(`[DataConnections] generateConnectionCode failed for ${profile.id}/${languageId}: ${err}`);
			return;
		}
		if (variants.length === 0) {
			return;
		}

		const preferredVariantId = profile.preferredCodeVariants?.[languageId];
		const variant = variants.find(v => v.id === preferredVariantId) ?? variants[0];

		languages[languageId] = {
			preferredVariantId: variant.id,
			code: variant.code,
			variableName: extractConnectionVariableName(variant.code),
		};
	}));

	return languages;
}

/**
 * Builds the getDataConnections payload: a flat JSON summary of every saved data connection
 * profile, for cold-start Assistant awareness (no live connection required). Returns an empty list
 * when the commands are gated off -- see {@link isDataConnectionsCommandEnabled}.
 * @param accessor The services accessor.
 */
export async function getDataConnections(accessor: ServicesAccessor): Promise<IDataConnectionsGetConnectionsResult[]> {
	if (!isDataConnectionsCommandEnabled(accessor.get(IConfigurationService))) {
		return [];
	}

	const dataConnectionsService = accessor.get(IPositronDataConnectionsService);
	const logService = accessor.get(ILogService);

	return Promise.all(dataConnectionsService.getProfiles().map(async profile => {
		// The driver may be unregistered (extension not installed, or not yet activated); fall back
		// to the profile's own mechanismId and report no per-language code in that case.
		const driver = dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);

		let mechanismId = profile.mechanismId;
		let languages: Record<string, IDataConnectionsGetConnectionsLanguageResult> = {};
		if (driver) {
			const mechanism = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId);
			mechanismId = mechanism?.id ?? profile.mechanismId;
			languages = await getLanguagePayloads(profile, mechanismId, driver, logService);
		}

		return {
			profileId: profile.id,
			connectionName: profile.connectionName,
			driverId: profile.driverMetadata.id,
			driverName: profile.driverMetadata.name,
			mechanismId,
			connected: dataConnectionsService.getInstanceForProfile(profile.id) !== undefined,
			parameterValues: await getRedactedParameterValues(profile, dataConnectionsService),
			languages,
		};
	}));
}

/**
 * Arguments for the getSchema command. Extends the summarizer's own bounds so a caller can cap the
 * walk, and the field docs live in one place (see {@link IDataConnectionSchemaSummaryOptions}).
 */
export interface IDataConnectionSchemaCommandArgs extends IDataConnectionSchemaSummaryOptions {
	// The profile whose live connection to summarize. Optional: when omitted and exactly one
	// connection is live, that one is summarized.
	profileId?: string;
}

/**
 * Why getSchema produced no summary. Distinguishing these is the point: each one calls for a
 * different next step from the caller, and Assistant can't read the log line that says which
 * happened.
 *
 * - `disabled`: the dataConnections.enabled feature flag is off.
 * - `not-connected`: the profile the caller named exists but has no live connection.
 * - `no-live-connections`: nothing is connected, so there is nothing to summarize.
 * - `ambiguous`: several connections are live and the caller named none of them.
 */
export type DataConnectionSchemaUnavailableReason =
	| 'disabled'
	| 'not-connected'
	| 'no-live-connections'
	| 'ambiguous';

/**
 * What getSchema returns in place of a summary. `connected: false` is the discriminant against
 * {@link IDataConnectionSchemaSummary} (which has no such field); `reason` says which of the
 * no-summary cases occurred.
 */
export interface IDataConnectionSchemaUnavailableResult {
	connected: false;

	reason: DataConnectionSchemaUnavailableReason;

	// The profiles the caller could name, present when `reason` is `ambiguous`. Turns a dead end
	// into a retry: the caller can pick one of these and call again.
	liveProfileIds?: string[];
}

/**
 * What getSchema resolves to: a summary, or the reason there isn't one.
 */
export type DataConnectionSchemaCommandResult =
	IDataConnectionSchemaSummary | IDataConnectionSchemaUnavailableResult;

// What resolveSchemaTarget found: a connection to summarize, or the reason there isn't one. Tagged
// rather than returning the instance or the result directly, so narrowing reads `kind` off a plain
// object instead of probing a property on the instance.
type SchemaTarget =
	| { readonly kind: 'instance'; readonly instance: IDataConnectionInstance }
	| { readonly kind: 'unavailable'; readonly result: IDataConnectionSchemaUnavailableResult };

/**
 * Resolves which live connection getSchema should summarize. Reports the reason rather than
 * guessing when there's no unambiguous answer, since a summary of the wrong connection is worse
 * for the caller than none at all.
 * @param dataConnectionsService The data connections service.
 * @param profileId The requested profile id, if the caller named one.
 * @param logService The log service.
 */
function resolveSchemaTarget(
	dataConnectionsService: IPositronDataConnectionsService,
	profileId: string | undefined,
	logService: ILogService,
): SchemaTarget {
	if (profileId !== undefined) {
		const instance = dataConnectionsService.getInstanceForProfile(profileId);
		if (!instance) {
			logService.warn(`[DataConnections] getSchema: profile ${profileId} has no live connection.`);
			return { kind: 'unavailable', result: { connected: false, reason: 'not-connected' } };
		}
		return { kind: 'instance', instance };
	}

	const instances = dataConnectionsService.getInstances();
	if (instances.length === 1) {
		return { kind: 'instance', instance: instances[0] };
	}

	if (instances.length === 0) {
		logService.warn('[DataConnections] getSchema: no live data connections to summarize.');
		return { kind: 'unavailable', result: { connected: false, reason: 'no-live-connections' } };
	}

	logService.warn(`[DataConnections] getSchema: ${instances.length} live data connections; pass profileId to choose one.`);
	return {
		kind: 'unavailable',
		result: {
			connected: false,
			reason: 'ambiguous',
			liveProfileIds: instances.map(instance => instance.profileId),
		},
	};
}

/**
 * Builds the getSchema payload: a bounded, JSON-serializable summary of a live connection's schema
 * tree, for Assistant to reason about the tables and columns a connection exposes. Unlike
 * getDataConnections this needs a live connection -- it walks the real schema over RPC, so when
 * there is no unambiguous live connection it reports why instead (see
 * {@link IDataConnectionSchemaUnavailableResult}).
 * @param accessor The services accessor.
 * @param args The command arguments; see {@link IDataConnectionSchemaCommandArgs}.
 */
export async function getDataConnectionSchema(
	accessor: ServicesAccessor,
	args: IDataConnectionSchemaCommandArgs = {},
): Promise<DataConnectionSchemaCommandResult> {
	// The payload command has no precondition (see its registration below), so this is how a caller
	// -- Assistant included -- finds out the feature is off: a reason it can act on, rather than an
	// empty summary indistinguishable from a connection with no tables.
	if (!isDataConnectionsCommandEnabled(accessor.get(IConfigurationService))) {
		return { connected: false, reason: 'disabled' };
	}

	const target = resolveSchemaTarget(
		accessor.get(IPositronDataConnectionsService),
		args.profileId,
		accessor.get(ILogService),
	);
	if (target.kind === 'unavailable') {
		return target.result;
	}

	// args carries the summary bounds directly, so it doubles as the options object.
	return summarizeDataConnectionSchema(target.instance.connectionHandle, args);
}

// The ids of the two payload commands. One command per payload, matching every other
// agentCompatible command in the workbench, so each carries its own argument schema and each shows
// up on its own in the positron-commands skill's reference file (#15343).
export const GET_CONNECTIONS_COMMAND_ID = 'positronDataConnections.getConnections';
export const GET_SCHEMA_COMMAND_ID = 'positronDataConnections.getSchema';

// Registered through CommandsRegistry rather than registerAction2, so neither payload command takes
// a Command Palette slot: running one would show the user nothing, since the return value is for a
// programmatic caller. The Command Palette entries that display these payloads live in
// positronDataConnectionsInspectActions.ts.
//
// That also means neither has a precondition -- registerAction2 only records one in MenuRegistry
// when f1 is set, and MenuRegistry is the only place the agent path reads preconditions from. This
// is the always-registered pattern these payloads want: Assistant discovers them once, and learns
// the feature is off from the payload itself (an empty list, or reason 'disabled') rather than by
// the command vanishing from getAgentAllowedCommands() mid-session.
CommandsRegistry.registerCommand({
	id: GET_CONNECTIONS_COMMAND_ID,
	handler: getDataConnections,
	metadata: {
		description: localize(
			'positron.dataConnections.getConnections.description',
			"Read the data connections the user has configured, whether or not they are currently connected."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		returns: 'An array of saved connection profiles: identity, driver, whether the connection is live, redacted parameter values, and the connection code per language. Empty when no connection is configured, or when the dataConnections.enabled setting is off.',
	},
});

CommandsRegistry.registerCommand({
	id: GET_SCHEMA_COMMAND_ID,
	handler: getDataConnectionSchema,
	metadata: {
		description: localize(
			'positron.dataConnections.getSchema.description',
			"Read the schema -- the tables and columns -- of a data connection that is currently live."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which connection to summarize, and how far to walk its schema.',
			// Every property below is optional, so the argument object as a whole is too. Saying so
			// keeps the agent path from reporting it as required (see #15343).
			isOptional: true,
			schema: {
				type: 'object',
				required: [],
				properties: {
					profileId: {
						type: 'string',
						description: 'The profile to summarize, as reported by positronDataConnections.getConnections. Optional when exactly one connection is live.',
					},
					maxDepth: {
						type: 'number',
						description: 'How many levels of the schema tree to walk.',
					},
					maxNodesPerLevel: {
						type: 'number',
						description: 'How many nodes to return under any one parent.',
					},
					maxTotalNodes: {
						type: 'number',
						description: 'How many nodes to return across the whole tree.',
					},
				},
			},
		}],
		returns: 'A bounded tree of the connection\'s schema nodes, with truncated set when a cap left nodes out. When there is no summary to give, an object with connected: false and a reason of \'disabled\', \'not-connected\', \'no-live-connections\', or \'ambiguous\' -- the last of which also lists liveProfileIds to choose from.',
	},
});
