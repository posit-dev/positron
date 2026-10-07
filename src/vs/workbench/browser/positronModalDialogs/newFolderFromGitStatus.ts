/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceTimeout } from '../../../base/common/async.js';
import { Event } from '../../../base/common/event.js';
import { ICommandRegistry } from '../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';

/**
 * Whether Git can be used to clone a repository, and if not, why not.
 * - available: the Git extension found Git and registered 'git.clone'.
 * - disabled: the 'git.enabled' setting is off.
 * - missing: the Git extension did not find Git.
 * - notReady: the Git extension has not registered its commands, and has not reported a missing
 *   Git; it is disabled, failed to activate, or is still searching for Git.
 */
export type GitStatus = 'available' | 'disabled' | 'missing' | 'notReady';

/**
 * The services the Git status checks read.
 */
interface IGitStatusServices {
	readonly extensionService: IExtensionService;
	readonly commandRegistry: ICommandRegistry;
	readonly contextKeyService: IContextKeyService;
	readonly configurationService: IConfigurationService;
}

/**
 * How long to wait for the Git extension to register 'git.clone' after it has activated. Turning
 * 'git.enabled' on after startup makes the Git extension search for Git without activating again.
 */
const gitRegistrationGracePeriodMs = 3000;

/**
 * Gets the Git status when it is known without waiting for the Git extension.
 * @param services The services to use.
 * @returns The Git status, or undefined if checkGitStatus must wait for the Git extension.
 */
export function getGitStatusNow(services: IGitStatusServices): GitStatus | undefined {
	// When Git is disabled, the Git extension neither searches for Git nor registers its commands.
	if (services.configurationService.getValue<boolean>('git.enabled') === false) {
		return 'disabled';
	}
	if (services.commandRegistry.getCommand('git.clone')) {
		return 'available';
	}
	return undefined;
}

/**
 * Checks whether Git can be used to clone a repository, waiting for the Git extension if needed.
 * @param services The services to use.
 * @param gracePeriodMs How long to wait for 'git.clone' after the Git extension has activated.
 * @returns The Git status.
 */
export async function checkGitStatus(
	services: IGitStatusServices,
	gracePeriodMs = gitRegistrationGracePeriodMs
): Promise<GitStatus> {
	const status = getGitStatusNow(services);
	if (status) {
		return status;
	}

	// The Git extension registers its commands while it activates, and only if it finds Git. Wait
	// for activation to finish so a check right after startup is not too early.
	const gitExtensionId = new ExtensionIdentifier('vscode.git');
	try {
		await services.extensionService.activateById(gitExtensionId, {
			startup: false,
			extensionId: gitExtensionId,
			activationEvent: 'api'
		});
	} catch {
		// A disabled or broken Git extension leaves 'git.clone' unregistered, reported below.
	}

	// Not 'git.missing' first: the Git extension leaves it unset when the extension is disabled,
	// or when 'git.enabled' is turned on after startup and Git is not found.
	if (services.commandRegistry.getCommand('git.clone')) {
		return 'available';
	}
	if (services.contextKeyService.getContextKeyValue<boolean>('git.missing') === true) {
		return 'missing';
	}

	// The Git extension may still be searching for Git, after 'git.enabled' was turned on.
	const registered = Event.toPromise(
		Event.filter(services.commandRegistry.onDidRegisterCommand, id => id === 'git.clone')
	);
	await raceTimeout(registered, gracePeriodMs, () => registered.cancel());
	return services.commandRegistry.getCommand('git.clone') ? 'available' : 'notReady';
}
