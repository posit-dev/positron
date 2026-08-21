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
import { quoteCompactToken } from '../../../services/positronDataConnections/common/dataConnectionCompactFormat.js';
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
 * Payload for a single language a data connection profile supports: the secret-free generated code
 * for the profile's preferred (or default) variant, and the name of the variable that code binds
 * the connection to.
 */
export interface IDataConnectionCodeLanguageResult {
	// The secret-free generated connection code for the profile's preferred variant (falling back to
	// the driver's default, variants[0], when unset or stale). Meant to be run verbatim.
	code: string;

	// The name of the variable the generated code binds the connection/board/engine to (e.g.
	// 'conn', 'con', 'engine', 'board'), parsed from the code's first top-level assignment.
	// Undefined if no such assignment could be found.
	variableName?: string;
}

/**
 * Payload for a single data connection profile, as returned by the getConnections command: the
 * catalog entry for one saved connection, with no generated code. Everything Assistant needs to
 * discover a configured connection cold (with no live instance) and decide which one the user
 * means; the code to open it comes from getConnectionCode, for the one profile it settles on.
 *
 * The two fields a caller acts on -- the id it passes to getConnectionCode or getSchema, and
 * whether the connection is already live -- stay structured. Everything descriptive is folded into
 * one `summary` line (see {@link formatConnectionSummary}), because a field-per-fact object spends
 * a large share of a profile's size on JSON keys that repeat for every profile.
 */
export interface IDataConnectionsGetConnectionsResult {
	profileId: string;

	// Whether a live instance currently exists for this profile.
	connected: boolean;

	// The profile's name, driver, mechanism, code languages and parameter values, as a single line.
	// Never contains cleartext secrets; see {@link formatConnectionSummary}.
	summary: string;
}

// The characters a summary line uses as delimiters: `|` between its fields, `,` between parameters,
// and `=` between a parameter and its value. Notably not `.`, which is unsafe in a schema path but
// ordinary inside a hostname. A value containing one of these is quoted; see quoteCompactToken.
const SUMMARY_UNSAFE_CHARACTERS = '|,=';

/**
 * Renders a profile's descriptive fields as one line:
 *
 *     name=<connectionName> | driver=<driverId> | mechanism=<mechanismId> | languages=<id>, ... | parameters=<key>=<value>, ...
 *
 * The keys are spelled out rather than left positional so the line stays self-describing if it is
 * ever read out of context (a truncated payload, a log line). The driver's display name is left
 * out: it is a prettier spelling of the id ("Snowflake" for `snowflake`), which a consumer can say
 * for itself.
 *
 * The parameters are nested inside a single `parameters=` field rather than appended as fields of
 * their own, so that a driver free to name its parameters anything can't collide with the reserved
 * keys: an extension whose parameter id is `driver` would otherwise emit a second `driver=` token
 * on the same line, and a consumer reading the line by key would take either one for the driver id.
 * Only the first `=` in the field separates the key from the parameter list.
 *
 * `languages` lists the language ids the driver can generate connection code for -- what
 * getConnectionCode can be asked for, and which sessions this connection is usable from. It is
 * absent when the driver is unregistered (extension not installed, or not yet activated), which is
 * the same condition that makes getConnectionCode report `no-driver`. A registered driver that
 * supports no languages at all still gets the field, empty, so "driver missing" and "driver
 * generates no code" (getConnectionCode's `no-code`) stay distinguishable in the line.
 *
 * The parameter values are the redacted set built by {@link getRedactedParameterValues}, so this
 * never renders a cleartext secret: a secret parameter appears in its redacted display form or not
 * at all.
 * @param profile The data connection profile.
 * @param mechanismId The id of the mechanism the profile was configured with.
 * @param languageIds The language ids the profile's driver supports, or undefined when the driver is
 * unregistered.
 * @param parameterValues The profile's redacted parameter values.
 */
function formatConnectionSummary(
	profile: IDataConnectionProfile,
	mechanismId: string,
	languageIds: readonly string[] | undefined,
	parameterValues: DataConnectionParameterValues,
): string {
	const quote = (value: string) => quoteCompactToken(value, SUMMARY_UNSAFE_CHARACTERS);

	const fields = [
		`name=${quote(profile.connectionName)}`,
		`driver=${quote(profile.driverMetadata.id)}`,
		`mechanism=${quote(mechanismId)}`,
	];
	if (languageIds !== undefined) {
		fields.push(`languages=${languageIds.map(quote).join(', ')}`);
	}

	const parameters = Object.entries(parameterValues)
		.map(([key, value]) => `${quote(key)}=${quote(String(value))}`)
		.join(', ');
	if (parameters) {
		fields.push(`parameters=${parameters}`);
	}

	return fields.join(' | ');
}

/**
 * The mechanism to generate code for: the profile's configured mechanism when the driver still
 * offers it, falling back to the stored id when it has gone stale. Shared by the catalog's
 * `mechanism=` field and getConnectionCode, so the mechanism the catalog reports is always the one
 * code is generated for.
 * @param driver The registered driver for the profile.
 * @param profile The data connection profile.
 */
function resolveMechanismId(driver: IDataConnectionDriver, profile: IDataConnectionProfile): string {
	return resolveDataConnectionMechanism(driver.metadata, profile.mechanismId)?.id ?? profile.mechanismId;
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
 * @param requestedLanguageId The only language to generate code for. Omitted, every language the
 * driver supports is generated -- one round trip to the driver each, which is why the catalog
 * (getConnections) asks for none of them.
 */
async function getLanguagePayloads(
	profile: IDataConnectionProfile,
	mechanismId: string,
	driver: IDataConnectionDriver,
	logService: ILogService,
	requestedLanguageId?: string,
): Promise<Record<string, IDataConnectionCodeLanguageResult>> {
	const languages: Record<string, IDataConnectionCodeLanguageResult> = {};
	const languageIds = requestedLanguageId === undefined
		? driver.metadata.supportedLanguageIds
		: driver.metadata.supportedLanguageIds.includes(requestedLanguageId) ? [requestedLanguageId] : [];

	await Promise.all(languageIds.map(async languageId => {
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
			code: variant.code,
			variableName: extractConnectionVariableName(variant.code),
		};
	}));

	return languages;
}

/**
 * Builds the getDataConnections payload: the catalog of every saved data connection profile, for
 * cold-start Assistant awareness (no live connection required). Returns an empty list when the
 * commands are gated off -- see {@link isDataConnectionsCommandEnabled}.
 *
 * Deliberately carries no generated connection code. Generating it costs a round trip to the driver
 * per profile per language, and the answer to "which connections do I have?" needs none of it: a
 * caller that has settled on one profile asks getConnectionCode for that profile alone.
 * @param accessor The services accessor.
 */
export async function getDataConnections(accessor: ServicesAccessor): Promise<IDataConnectionsGetConnectionsResult[]> {
	if (!isDataConnectionsCommandEnabled(accessor.get(IConfigurationService))) {
		return [];
	}

	const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

	return Promise.all(dataConnectionsService.getProfiles().map(async profile => {
		// The driver may be unregistered (extension not installed, or not yet activated); fall back
		// to the profile's own mechanismId and report no code languages in that case.
		const driver = dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		const mechanismId = driver ? resolveMechanismId(driver, profile) : profile.mechanismId;

		const parameterValues = await getRedactedParameterValues(profile, dataConnectionsService);

		return {
			profileId: profile.id,
			connected: dataConnectionsService.getInstanceForProfile(profile.id) !== undefined,
			summary: formatConnectionSummary(
				profile, mechanismId, driver?.metadata.supportedLanguageIds, parameterValues),
		};
	}));
}

/**
 * Arguments for the getConnectionCode command.
 */
export interface IDataConnectionCodeCommandArgs {
	// The profile to generate connection code for, as reported by getConnections. Required: this
	// command exists to generate code for one profile, and generating it for a profile the caller
	// did not name is exactly the cost the catalog avoids.
	profileId: string;

	// The only language to generate code for. Omitted, every language the profile's driver supports
	// is generated -- usually two, so naming the session's language halves the payload.
	languageId?: string;
}

/**
 * Why getConnectionCode produced no code. Each reason calls for a different next step, and none of
 * them is fixed by retrying the same call.
 *
 * - `disabled`: the dataConnections.enabled feature flag is off.
 * - `not-found`: no saved profile has the id the caller named, or the caller named none at all.
 * - `no-driver`: the profile's driver is unregistered -- its extension isn't installed, or hasn't
 *   activated yet -- so there is nothing to generate code with.
 * - `no-code`: the driver is registered but produced no code. Either the caller named a language it
 *   doesn't support, or code generation failed for the profile's current parameters.
 */
export type DataConnectionCodeUnavailableReason =
	| 'disabled'
	| 'not-found'
	| 'no-driver'
	| 'no-code';

/**
 * What getConnectionCode returns in place of code. `available: false` is the discriminant against
 * {@link IDataConnectionCodeResult} (which has no such field).
 */
export interface IDataConnectionCodeUnavailableResult {
	available: false;

	reason: DataConnectionCodeUnavailableReason;

	// The languages the driver does support, present when `reason` is `no-code`. Turns a dead end
	// into a retry when the caller simply named the wrong language.
	supportedLanguageIds?: string[];
}

/**
 * The connection code for one profile: the code to run to open it, per language.
 */
export interface IDataConnectionCodeResult {
	profileId: string;

	// The profile's connection code, keyed by language id. Never empty -- a payload with no code is
	// reported as {@link IDataConnectionCodeUnavailableResult} instead.
	languages: Record<string, IDataConnectionCodeLanguageResult>;
}

/**
 * What getConnectionCode resolves to: the code, or the reason there isn't any.
 */
export type DataConnectionCodeCommandResult =
	IDataConnectionCodeResult | IDataConnectionCodeUnavailableResult;

/**
 * Builds the getConnectionCode payload: the secret-free code that opens one saved connection, in
 * the language(s) asked for. Split out of getConnections because the code is the bulk of what a
 * profile carries and generating it costs a round trip to the driver per language -- so it is
 * generated for the one profile a caller has settled on, rather than for every profile on every
 * "what connections do I have?" call.
 * @param accessor The services accessor.
 * @param args The command arguments; see {@link IDataConnectionCodeCommandArgs}.
 */
export async function getDataConnectionCode(
	accessor: ServicesAccessor,
	// Optional despite profileId being required, because the argument object arrives from a command
	// invocation: a caller that passes nothing gets the same reason as one that passes an id no
	// profile has, rather than a TypeError.
	args?: IDataConnectionCodeCommandArgs,
): Promise<DataConnectionCodeCommandResult> {
	if (!isDataConnectionsCommandEnabled(accessor.get(IConfigurationService))) {
		return { available: false, reason: 'disabled' };
	}

	const dataConnectionsService = accessor.get(IPositronDataConnectionsService);
	const logService = accessor.get(ILogService);

	const profile = args?.profileId === undefined
		? undefined
		: dataConnectionsService.getProfile(args.profileId);
	if (!profile) {
		logService.warn(args?.profileId === undefined
			? '[DataConnections] getConnectionCode: called without a profileId.'
			: `[DataConnections] getConnectionCode: no profile with id ${args.profileId}.`);
		return { available: false, reason: 'not-found' };
	}

	const driver = dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
	if (!driver) {
		logService.warn(`[DataConnections] getConnectionCode: driver ${profile.driverMetadata.id} is not registered.`);
		return { available: false, reason: 'no-driver' };
	}

	const languages = await getLanguagePayloads(profile, resolveMechanismId(driver, profile), driver, logService, args?.languageId);
	if (Object.keys(languages).length === 0) {
		// Either the requested language isn't supported, or generation failed (which
		// getLanguagePayloads has already logged). Naming what the driver does support lets the
		// caller retry the first case without another round trip to find out.
		return {
			available: false,
			reason: 'no-code',
			supportedLanguageIds: [...driver.metadata.supportedLanguageIds],
		};
	}

	return { profileId: profile.id, languages };
}

/**
 * Arguments for the getSchema command. Extends the summarizer's own bounds so a caller can cap the
 * walk, and the field docs live in one place (see {@link IDataConnectionSchemaSummaryOptions}).
 */
export interface IDataConnectionSchemaCommandArgs extends IDataConnectionSchemaSummaryOptions {
	// The profile to summarize. The profile is connected automatically when it isn't live yet.
	// Optional: when omitted, the one live connection is summarized -- or, when nothing is live,
	// the one saved profile is connected and summarized.
	profileId?: string;
}

/**
 * Why getSchema produced no summary. Distinguishing these is the point: each one calls for a
 * different next step from the caller, and Assistant can't read the log line that says which
 * happened.
 *
 * - `disabled`: the dataConnections.enabled feature flag is off.
 * - `not-found`: no saved profile has the id the caller named.
 * - `no-driver`: the target profile's driver is unregistered -- its extension isn't installed, or
 *   hasn't activated yet -- so there is nothing to connect with.
 * - `connect-failed`: the target profile isn't live and the automatic connection attempt failed.
 * - `no-connections`: nothing is live and no profile is saved, so there is nothing to summarize or
 *   connect.
 * - `ambiguous`: the caller named no profile and there are several candidates -- the live
 *   connections, or every saved profile when none is live.
 */
export type DataConnectionSchemaUnavailableReason =
	| 'disabled'
	| 'not-found'
	| 'no-driver'
	| 'connect-failed'
	| 'no-connections'
	| 'ambiguous';

/**
 * What getSchema returns in place of a summary. `connected: false` is the discriminant against
 * {@link IDataConnectionSchemaSummary} (which has no such field); `reason` says which of the
 * no-summary cases occurred.
 */
export interface IDataConnectionSchemaUnavailableResult {
	connected: false;

	reason: DataConnectionSchemaUnavailableReason;

	// The profiles the caller could name, present when `reason` is `ambiguous`: the live
	// connections, or every saved profile when none is live. Turns a dead end into a retry: the
	// caller can pick one of these and call again.
	candidateProfileIds?: string[];
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
 * Produces a live connection for the given profile, connecting it when it isn't live yet. The
 * connect is the service's own -- it resolves the profile's stored secrets itself, so nothing
 * secret passes through here -- and it is attempted only after the cheap checks that would make it
 * throw, so `not-found` and `no-driver` come back as their own reasons rather than folding into
 * `connect-failed`.
 * @param dataConnectionsService The data connections service.
 * @param profileId The profile to summarize.
 * @param logService The log service.
 */
async function connectSchemaTarget(
	dataConnectionsService: IPositronDataConnectionsService,
	profileId: string,
	logService: ILogService,
): Promise<SchemaTarget> {
	// An already-live connection is summarized as-is: it shouldn't stop working because its driver
	// was unregistered after it connected, so the driver check below applies only to a new connect.
	const instance = dataConnectionsService.getInstanceForProfile(profileId);
	if (instance) {
		return { kind: 'instance', instance };
	}

	const profile = dataConnectionsService.getProfile(profileId);
	if (!profile) {
		logService.warn(`[DataConnections] getSchema: no profile with id ${profileId}.`);
		return { kind: 'unavailable', result: { connected: false, reason: 'not-found' } };
	}

	if (!dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id)) {
		logService.warn(`[DataConnections] getSchema: driver ${profile.driverMetadata.id} is not registered.`);
		return { kind: 'unavailable', result: { connected: false, reason: 'no-driver' } };
	}

	try {
		return { kind: 'instance', instance: await dataConnectionsService.connect(profileId) };
	} catch (err) {
		logService.error(`[DataConnections] getSchema: connecting profile ${profileId} failed: ${err}`);
		return { kind: 'unavailable', result: { connected: false, reason: 'connect-failed' } };
	}
}

/**
 * Resolves which connection getSchema should summarize, connecting it first when it isn't live. A
 * named profile is always the target; unnamed, the target is the one live connection, or -- when
 * nothing is live -- the one saved profile. Reports the reason rather than guessing when there's
 * no unambiguous answer, since a summary of the wrong connection is worse for the caller than none
 * at all.
 * @param dataConnectionsService The data connections service.
 * @param profileId The requested profile id, if the caller named one.
 * @param logService The log service.
 */
async function resolveSchemaTarget(
	dataConnectionsService: IPositronDataConnectionsService,
	profileId: string | undefined,
	logService: ILogService,
): Promise<SchemaTarget> {
	if (profileId !== undefined) {
		return connectSchemaTarget(dataConnectionsService, profileId, logService);
	}

	const instances = dataConnectionsService.getInstances();
	if (instances.length === 1) {
		return { kind: 'instance', instance: instances[0] };
	}

	if (instances.length > 1) {
		logService.warn(`[DataConnections] getSchema: ${instances.length} live data connections; pass profileId to choose one.`);
		return {
			kind: 'unavailable',
			result: {
				connected: false,
				reason: 'ambiguous',
				candidateProfileIds: instances.map(instance => instance.profileId),
			},
		};
	}

	// Nothing is live, so fall back to the saved profiles: a single one is as unambiguous a target
	// as a single live connection, and connecting it is the point of the auto-connect.
	const profiles = dataConnectionsService.getProfiles();
	if (profiles.length === 1) {
		return connectSchemaTarget(dataConnectionsService, profiles[0].id, logService);
	}

	if (profiles.length === 0) {
		logService.warn('[DataConnections] getSchema: no data connections to summarize.');
		return { kind: 'unavailable', result: { connected: false, reason: 'no-connections' } };
	}

	logService.warn(`[DataConnections] getSchema: ${profiles.length} configured data connections and none live; pass profileId to choose one.`);
	return {
		kind: 'unavailable',
		result: {
			connected: false,
			reason: 'ambiguous',
			candidateProfileIds: profiles.map(profile => profile.id),
		},
	};
}

/**
 * Builds the getSchema payload: a bounded, JSON-serializable summary of a connection's schema tree,
 * for Assistant to reason about the tables and columns a connection exposes. The walk needs a live
 * connection -- it reads the real schema over RPC -- but the target doesn't have to be live up
 * front: an unambiguous target that isn't connected yet is connected automatically first (see
 * {@link connectSchemaTarget}). When there is no unambiguous target, or the connect fails, it
 * reports why instead (see {@link IDataConnectionSchemaUnavailableResult}).
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

	const target = await resolveSchemaTarget(
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

// The ids of the three payload commands. One command per payload, matching every other
// agentCompatible command in the workbench, so each carries its own argument schema and each shows
// up on its own in the positron-commands skill's reference file (#15343).
export const GET_CONNECTIONS_COMMAND_ID = 'positronDataConnections.getConnections';
export const GET_CONNECTION_CODE_COMMAND_ID = 'positronDataConnections.getConnectionCode';
export const GET_SCHEMA_COMMAND_ID = 'positronDataConnections.getSchema';

// Registered through CommandsRegistry rather than registerAction2, so no payload command takes a
// Command Palette slot: running one would show the user nothing, since the return value is for a
// programmatic caller. The Command Palette entries that display these payloads live in
// positronDataConnectionsInspectActions.ts.
//
// That also means none has a precondition -- registerAction2 only records one in MenuRegistry when
// f1 is set, and MenuRegistry is the only place the agent path reads preconditions from. This is the
// always-registered pattern these payloads want: Assistant discovers them once, and learns the
// feature is off from the payload itself (an empty list, or reason 'disabled') rather than by the
// command vanishing from getAgentAllowedCommands() mid-session.
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
		returns: 'An array of saved connection profiles, without connection code (ask positronDataConnections.getConnectionCode for that, once you know which profile you want). Each entry has profileId, connected, and a one-line summary of the rest: name=<name> | driver=<id> | mechanism=<id> | languages=<languageId>, ... | parameters=<key>=<value>, ... -- the driver\'s own parameters all nest inside the single parameters= field (split it at its first = only), with secrets in redacted form only. `languages` is absent when the driver\'s extension is not installed or has not activated, and present but empty when the driver generates no code. Empty when no connection is configured, or when the dataConnections.enabled setting is off.',
	},
});

CommandsRegistry.registerCommand({
	id: GET_CONNECTION_CODE_COMMAND_ID,
	handler: getDataConnectionCode,
	metadata: {
		description: localize(
			'positron.dataConnections.getConnectionCode.description',
			"Read the code that opens one of the data connections the user has configured."
		),
		// Advertise this command to AI agents (positron.ai.getAgentAllowedCommands).
		agentCompatible: true,
		args: [{
			name: 'args',
			description: 'Which connection to generate code for, and for which language.',
			schema: {
				type: 'object',
				required: ['profileId'],
				properties: {
					profileId: {
						type: 'string',
						description: 'The profile to generate connection code for, as reported by positronDataConnections.getConnections.',
					},
					languageId: {
						type: 'string',
						description: 'The only language to generate code for, e.g. \'r\' or \'python\'. Omitted, every language the driver supports is generated; naming the language of the session you will run the code in roughly halves the payload.',
					},
				},
			},
		}],
		returns: 'The profileId, plus the connection code per language under languages[<languageId>].code and the variable that code binds under .variableName. The code is secret-free and meant to be run verbatim. When there is no code to give, an object with available: false and a reason of \'disabled\', \'not-found\', \'no-driver\', or \'no-code\' -- the last of which also lists supportedLanguageIds, in case the language asked for was simply the wrong one.',
	},
});

CommandsRegistry.registerCommand({
	id: GET_SCHEMA_COMMAND_ID,
	handler: getDataConnectionSchema,
	metadata: {
		description: localize(
			'positron.dataConnections.getSchema.description',
			"Read the schema -- the tables and columns -- of a data connection, connecting it first when it is not live yet."
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
						description: 'The profile to summarize, as reported by positronDataConnections.getConnections; it is connected automatically when it is not live yet. Optional when exactly one connection is live, or when nothing is live and exactly one profile is saved.',
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
		returns: 'The schema as one line per object in `lines`, each of the form `<path> [<kind>][ <dataType>][ PK][ (<column>:<type>, ...)][ +<n> more]`: a dot-joined path from the root, the object\'s kind, a table\'s columns folded onto its own line, and a count of children a cap left out (root-level objects a cap left out appear as a bare trailing `+<n> more` line). A name containing a delimiter is quoted as a JSON string. `truncated` is set when any cap applied. When there is no summary to give, an object with connected: false and a reason of \'disabled\', \'not-found\', \'no-driver\', \'connect-failed\', \'no-connections\', or \'ambiguous\' -- the last of which also lists candidateProfileIds to choose from.',
	},
});
