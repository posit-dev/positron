/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { IUntitledTextResourceEditorInput } from '../../../common/editor.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { IsDevelopmentContext } from '../../../../platform/contextkey/common/contextkeys.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_DATA_CONNECTIONS_ENABLED_KEY } from './positronDataConnectionsConfiguration.js';
import { IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';
import { DataConnectionParameterValues, IDataConnectionDriver, IDataConnectionProfile, resolveDataConnectionMechanism } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';

// The id of the getConnections command. Always registered, regardless of the
// dataConnections.enabled feature flag -- see getDataConnections for why.
export const GET_CONNECTIONS_COMMAND_ID = 'positronDataConnections.getConnections';

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
const CONNECTION_VARIABLE_PATTERN = /^(\w+)\s*(?:=|<-)\s*\S/m;

/**
 * Parses the name of the variable a generated connection code snippet binds, from its first
 * top-level assignment.
 * @param code The generated connection code.
 */
function extractConnectionVariableName(code: string): string | undefined {
	return CONNECTION_VARIABLE_PATTERN.exec(code)?.[1];
}

/**
 * Builds the profile's parameter values for the getConnections payload: non-secret values as-is,
 * plus a redacted display string for each secret parameter that has one. Never reads a secret
 * parameter's cleartext value directly -- redaction is delegated to
 * {@link IPositronDataConnectionsService.getRedactedParameterValue}, which keeps the cleartext
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

	for (const parameterId of dataConnectionsService.getProfileSecretIds(profile.id)) {
		const redacted = await dataConnectionsService.getRedactedParameterValue(profile.id, parameterId);
		if (redacted !== undefined) {
			parameterValues[parameterId] = redacted;
		}
	}

	return parameterValues;
}

/**
 * Builds the per-language connection code payload for a profile, using the profile's preferred
 * variant per language (falling back to the driver's default) -- the same generateConnectionCode
 * call dataConnectionEntryRow.tsx uses to populate the Connect With dialog.
 * @param profile The data connection profile.
 * @param mechanismId The id of the mechanism the profile was configured with.
 * @param driver The registered driver for the profile.
 */
async function getLanguagePayloads(
	profile: IDataConnectionProfile,
	mechanismId: string,
	driver: IDataConnectionDriver,
): Promise<Record<string, IDataConnectionsGetConnectionsLanguageResult>> {
	const languages: Record<string, IDataConnectionsGetConnectionsLanguageResult> = {};

	for (const languageId of driver.metadata.supportedLanguageIds) {
		// The profile's own parameterValues never contains secret values, so this is always the
		// secret-free preview.
		const variants = await driver.generateConnectionCode(mechanismId, languageId, profile.parameterValues);
		if (variants.length === 0) {
			continue;
		}

		const preferredVariantId = profile.preferredCodeVariants?.[languageId];
		const variant = variants.find(v => v.id === preferredVariantId) ?? variants[0];

		languages[languageId] = {
			preferredVariantId: variant.id,
			code: variant.code,
			variableName: extractConnectionVariableName(variant.code),
		};
	}

	return languages;
}

/**
 * Builds the getConnections payload: a flat JSON summary of every saved data connection profile,
 * for cold-start Assistant awareness (no live connection required). Returns an empty list when
 * the dataConnections.enabled feature flag is off, so the command stays registered and
 * Assistant-side feature detection is a simple getCommands() check.
 * @param accessor The services accessor.
 */
export async function getDataConnections(accessor: ServicesAccessor): Promise<IDataConnectionsGetConnectionsResult[]> {
	const configurationService = accessor.get(IConfigurationService);
	if (configurationService.getValue<boolean>(POSITRON_DATA_CONNECTIONS_ENABLED_KEY) !== true) {
		return [];
	}

	const dataConnectionsService = accessor.get(IPositronDataConnectionsService);

	const results: IDataConnectionsGetConnectionsResult[] = [];
	for (const profile of dataConnectionsService.getProfiles()) {
		// The driver may be unregistered (extension not installed, or not yet activated); fall back
		// to the profile's own mechanismId and report no per-language code in that case.
		const driver = dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
		const mechanism = driver ? resolveDataConnectionMechanism(driver.metadata, profile.mechanismId) : undefined;
		const mechanismId = mechanism?.id ?? profile.mechanismId;

		results.push({
			profileId: profile.id,
			connectionName: profile.connectionName,
			driverId: profile.driverMetadata.id,
			driverName: profile.driverMetadata.name,
			mechanismId,
			connected: dataConnectionsService.getInstanceForProfile(profile.id) !== undefined,
			parameterValues: await getRedactedParameterValues(profile, dataConnectionsService),
			languages: driver ? await getLanguagePayloads(profile, mechanismId, driver) : {},
		});
	}

	return results;
}

CommandsRegistry.registerCommand(GET_CONNECTIONS_COMMAND_ID, getDataConnections);

// Developer-only Command Palette entry that runs getConnections and opens its JSON payload in a
// new untitled editor. Assistant consumes the command directly via executeCommand; this exists
// solely so the payload can be inspected by hand while developing against it.
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positronDataConnections.debugGetConnections',
			title: localize2('positron.dataConnections.debugGetConnections', 'Get Data Connections (Debug)'),
			category: Categories.Developer,
			f1: true,
			precondition: IsDevelopmentContext, // hide this from release builds -- manual testing aid only
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const editorService = accessor.get(IEditorService);

		const result = await commandService.executeCommand(GET_CONNECTIONS_COMMAND_ID);

		await editorService.openEditor({
			resource: undefined,
			contents: JSON.stringify(result, null, 2),
			languageId: 'json',
			options: { pinned: true },
		} satisfies IUntitledTextResourceEditorInput);
	}
});
