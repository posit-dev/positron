/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { ICommandRegistry, ICommandService } from '../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { INotificationService, Severity } from '../../../platform/notification/common/notification.js';
import { ExtensionIdentifier } from '../../../platform/extensions/common/extensions.js';
import { IExtensionService } from '../../services/extensions/common/extensions.js';

/**
 * The services checkGitAvailable reads.
 */
interface IGitAvailabilityServices {
	readonly extensionService: IExtensionService;
	readonly commandRegistry: ICommandRegistry;
	readonly configurationService: IConfigurationService;
	readonly commandService: ICommandService;
	readonly notificationService: INotificationService;
}

/**
 * Checks that Git is enabled and installed before a flow that needs it, and tells the user how to
 * fix it when it is not.
 *
 * Preconditions only disable menu entries; command links (for example on the Welcome page) still
 * run the command. Without this check, the flow fails later with "command 'git.clone' not found",
 * because the Git extension registers no commands when Git is disabled or not found.
 *
 * @param services The services to use.
 * @returns true if Git is available, false if Git is disabled or missing.
 */
export async function checkGitAvailable(services: IGitAvailabilityServices): Promise<boolean> {
	// When Git is disabled, the Git extension neither searches for Git nor registers its commands.
	// Turning the setting on takes effect without a reload.
	if (services.configurationService.getValue<boolean>('git.enabled') === false) {
		services.notificationService.prompt(
			Severity.Warning,
			localize(
				'positron.gitDisabled',
				"Git is required to create a folder from a Git repository, but Git is disabled. Turn on the '{0}' setting to use it.",
				'git.enabled'
			),
			[{
				label: localize('positron.openGitSettings', "Open Settings"),
				run: () => services.commandService.executeCommand('workbench.action.openSettings', 'git.enabled')
			}]
		);
		return false;
	}

	// The Git extension registers its commands while it activates, and only if it finds Git. Wait
	// for activation to finish so a command run right after startup does not check too early.
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

	// Not 'git.missing': the Git extension leaves it unset when the extension is disabled, or when
	// 'git.enabled' is turned on after startup and Git is not found.
	if (services.commandRegistry.getCommand('git.clone')) {
		return true;
	}

	const message = localize(
		'positron.gitMissing',
		"Git is required to create a folder from a Git repository, but Git was not found. Install Git, or set its location with the '{0}' setting, then reload the window.",
		'git.path'
	);

	// The Git extension searches for Git only when it activates, so after installing Git the user
	// must reload the window before the extension can find it.
	services.notificationService.prompt(Severity.Warning, message, [{
		label: localize('positron.reloadWindowAfterGitInstall', "Reload Window"),
		run: () => services.commandService.executeCommand('workbench.action.reloadWindow')
	}]);

	return false;
}
