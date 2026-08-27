/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { showConnectDataConnectionWith } from './dialogs/connectDataConnectionWith.js';
import { bindConnectionToFreeVariable } from '../../../services/positronDataConnections/common/dataConnectionCode.js';
import { IDataConnectionCodeVariant, resolveDataConnectionMechanism } from '../../../services/positronDataConnections/common/interfaces/dataConnectionDriver.js';
import { IDataConnectionSessionBinding, IPositronDataConnectionsService } from '../../../services/positronDataConnections/common/interfaces/positronDataConnectionsService.js';

/**
 * Opens the Connect With dialog for a saved connection, in a given language, and reports what the
 * user connected.
 *
 * Everything between "which connection, in which language" and a dialog on screen: finding the
 * driver, resolving the mechanism the connection was configured with, generating the code, and
 * arranging for the code to be regenerated with secrets if the user asks for them. Shared because
 * there are two ways in and they must behave identically -- the Data Connections pane's actions
 * menu, and an extension that wants the user's connection in their session (see
 * `positron.dataConnections.connectDataConnectionWith`). The second is the reason this returns
 * something: a caller that is going to write code against the connection needs to know which
 * session it landed in and what the variable is called.
 *
 * The dialog is shown rather than skipped even when there is nothing to choose. The code runs in
 * the user's console and may carry their stored password, and neither is something to decide on
 * their behalf.
 *
 * @param dataConnectionsService The data connections service.
 * @param notificationService The notification service, for the two ways this can have nothing to
 *   show: the driver is unavailable, or it cannot generate code from the saved parameters.
 * @param profileId The connection to connect to.
 * @param languageId The language to connect in, one of the driver's supported language ids.
 * @returns The connection the user made, or undefined if they dismissed the dialog or it could not
 *   be shown.
 */
export async function connectDataConnectionWith(
	dataConnectionsService: IPositronDataConnectionsService,
	notificationService: INotificationService,
	profileId: string,
	languageId: string,
	takenVariableNames: readonly string[] = [],
): Promise<IDataConnectionSessionBinding | undefined> {
	const profile = dataConnectionsService.getProfile(profileId);
	if (!profile) {
		notificationService.error(localize(
			'positron.dataConnections.noSuchProfile',
			"There is no saved connection to connect to."
		));
		return undefined;
	}

	const driver = dataConnectionsService.driverManager.getDriver(profile.driverMetadata.id);
	if (!driver) {
		// Two reasons a driver is missing, and they call for different things from the user, so
		// they are reported differently: one is waiting a moment, the other is installing an
		// extension.
		notificationService.error(dataConnectionsService.driverManager.driversLoaded
			? localize(
				'positron.dataConnections.driverNotInstalled',
				"Driver '{0}' is not available for connection '{1}'. The extension that provides it may not be installed or enabled.",
				profile.driverMetadata.name,
				profile.connectionName
			)
			: localize(
				'positron.dataConnections.driverStillLoading',
				"Driver '{0}' is still loading for connection '{1}'. Please try again in a moment.",
				profile.driverMetadata.name,
				profile.connectionName
			));
		return undefined;
	}

	// Resolve the mechanism id (falling back to the first for pre-mechanisms profiles) once for
	// both code generation calls below.
	const mechanismId = resolveDataConnectionMechanism(driver.metadata, profile.mechanismId)?.id ?? profile.mechanismId;

	// The in-memory profile's parameterValues never contains secret values (those live in secret
	// storage), so this is the default, secret-free preview. Secret values are only pulled in if
	// the user explicitly opts in via the dialog's Include Secrets action.
	const variants = await driver.generateConnectionCode(mechanismId, languageId, profile.parameterValues);
	if (variants.length === 0) {
		notificationService.error(localize(
			'positron.dataConnections.codeGenerationFailed',
			"Could not generate connection code for '{0}'.",
			profile.connectionName
		));
		return undefined;
	}

	return showConnectDataConnectionWith({
		languageId,
		connectionName: profile.connectionName,
		driver,
		mechanismId,
		profileId: profile.id,
		// Regenerates the code with secret values (e.g. passwords) pulled from secret storage.
		// Invoked only after the user confirms the Include Secrets action in the dialog.
		generateSecretVariants: async () => {
			const profileWithSecrets = await dataConnectionsService.getProfileWithSecrets(profile.id);
			if (!profileWithSecrets) {
				return [];
			}
			return freeOfTakenNames(
				await driver.generateConnectionCode(mechanismId, languageId, profileWithSecrets.parameterValues),
				takenVariableNames,
			);
		},
		variants: freeOfTakenNames(variants, takenVariableNames),
	});
}

/**
 * Rebinds each variant's connection code to a variable name the target session does not already
 * hold, so that connecting to a second database does not overwrite the first.
 *
 * Applied to the variants rather than to the chosen one, because the user can switch variants in
 * the dialog and each one binds its own name -- `conn` for a DBAPI connection, `engine` for a
 * SQLAlchemy one -- so each has to be checked against what is taken.
 * @param variants The generated variants.
 * @param taken The variable names already in use in the target session.
 */
function freeOfTakenNames(
	variants: IDataConnectionCodeVariant[],
	taken: readonly string[],
): IDataConnectionCodeVariant[] {
	if (taken.length === 0) {
		return variants;
	}
	return variants.map(variant => ({
		...variant,
		code: bindConnectionToFreeVariable(variant.code, taken).code,
	}));
}
