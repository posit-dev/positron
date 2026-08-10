/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { AI_ENABLED_KEY } from '../../positronAssistant/common/positronAIConfiguration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IDataConnectionInstance } from '../../../services/positronDataConnections/common/interfaces/dataConnectionInstance.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionProfile, resolveDataConnectionMechanism } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionSchemaSummary, IDataConnectionSchemaSummaryOptions, summarizeDataConnectionSchema } from '../../../services/positronDataConnections/common/dataConnectionSchemaSummary.js';

/**
 * Whether the data connections commands should produce a payload at all. They exist solely for
 * Assistant to consume, so they go quiet when the dataConnections.enabled feature flag is off, or
 * when the ai.enabled main switch is off. The command stays registered either way, so
 * Assistant-side feature detection is a simple getCommands() check.
 * @param configurationService The configuration service.
 */
export function isDataConnectionsCommandEnabled(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) === true
		&& configurationService.getValue<boolean>(AI_ENABLED_KEY) !== false;
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
 * Arguments for the getSchema sub-command. Extends the summarizer's own bounds so a caller can cap
 * the walk, and the field docs live in one place (see {@link IDataConnectionSchemaSummaryOptions}).
 */
export interface IDataConnectionSchemaCommandArgs extends IDataConnectionSchemaSummaryOptions {
	// The profile whose live connection to summarize. Optional: when omitted and exactly one
	// connection is live, that one is summarized.
	profileId?: string;
}

/**
 * Resolves which live connection getSchema should summarize. Returns undefined -- with the reason
 * logged -- rather than guessing when there's no unambiguous answer, since a summary of the wrong
 * connection is worse for the caller than none at all.
 * @param dataConnectionsService The data connections service.
 * @param profileId The requested profile id, if the caller named one.
 * @param logService The log service.
 */
function resolveSchemaTarget(
	dataConnectionsService: IPositronDataConnectionsService,
	profileId: string | undefined,
	logService: ILogService,
): IDataConnectionInstance | undefined {
	if (profileId !== undefined) {
		const instance = dataConnectionsService.getInstanceForProfile(profileId);
		if (!instance) {
			logService.warn(`[DataConnections] getSchema: profile ${profileId} has no live connection.`);
		}
		return instance;
	}

	const instances = dataConnectionsService.getInstances();
	if (instances.length === 1) {
		return instances[0];
	}

	logService.warn(instances.length === 0
		? '[DataConnections] getSchema: no live data connections to summarize.'
		: `[DataConnections] getSchema: ${instances.length} live data connections; pass profileId to choose one.`);
	return undefined;
}

/**
 * Builds the getSchema payload: a bounded, JSON-serializable summary of a live connection's schema
 * tree, for Assistant to reason about the tables and columns a connection exposes. Unlike
 * getDataConnections this needs a live connection -- it walks the real schema over RPC. Returns
 * undefined when the commands are gated off (see {@link isDataConnectionsCommandEnabled}) or when
 * there is no unambiguous connection to summarize.
 * @param accessor The services accessor.
 * @param args The sub-command arguments; see {@link IDataConnectionSchemaCommandArgs}.
 */
export async function getDataConnectionSchema(
	accessor: ServicesAccessor,
	args: IDataConnectionSchemaCommandArgs = {},
): Promise<IDataConnectionSchemaSummary | undefined> {
	if (!isDataConnectionsCommandEnabled(accessor.get(IConfigurationService))) {
		return undefined;
	}

	const instance = resolveSchemaTarget(
		accessor.get(IPositronDataConnectionsService),
		args.profileId,
		accessor.get(ILogService),
	);
	if (!instance) {
		return undefined;
	}

	// args carries the summary bounds directly, so it doubles as the options object.
	return summarizeDataConnectionSchema(instance.connectionHandle, args);
}
