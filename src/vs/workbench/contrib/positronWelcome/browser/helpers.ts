/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, NeverShowAgainScope, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { PositronImportSettings } from './actions.js';
import * as platform from '../../../../base/common/platform.js';

const wasPromptedKey = 'positron.welcome.promptedImport';

export async function getImportWasPrompted(
	storageService: IStorageService,
): Promise<boolean> {
	return storageService.getBoolean(wasPromptedKey, StorageScope.PROFILE, false);
}

export function setImportWasPrompted(
	storageService: IStorageService,
	state: boolean = true
) {
	storageService.store(wasPromptedKey, state, StorageScope.PROFILE, StorageTarget.MACHINE);
}

export async function promptImport(
	storageService: IStorageService,
	notificationService: INotificationService,
	commandService: ICommandService,
) {
	// Show the prompt to the user.
	// The prompt will show up in the notification center.
	notificationService.prompt(
		Severity.Info,
		`Import settings from Visual Studio Code into Positron`,
		[
			// Open the import settings command and set the import was prompted flag to true.
			// This will prevent the prompt from showing up again.
			{
				label: 'Import',
				run: () => {
					commandService.executeCommand(PositronImportSettings.ID);
					// TODO @samclark2015: Uncomment this when the import command is implemented.
					// setImportWasPrompted(storageService);
				},
			},
			// Dismisses notification, but will prompt again on next launch.
			{
				label: 'Later',
				run: () => { },
			},
		],
		{
			// Adds a "Don't show again" action to the prompt.
			// This will allow the user to dismiss the prompt and not show it again.
			neverShowAgain: {
				id: wasPromptedKey,
				scope: NeverShowAgainScope.PROFILE,
			},
			sticky: true,
			onCancel: () => { },
		}
	);
}

export async function getCodeSettingsPath(pathService: IPathService): Promise<URI> {
	const path = await pathService.path;
	const homedir = await pathService.userHome();

	let appDataPath: URI;
	switch (platform.OS) {
		case platform.OperatingSystem.Windows:
			if (process.env['APPDATA']) {
				appDataPath = URI.parse(process.env['APPDATA']);
			} else {
				const userProfile = process.env['USERPROFILE'];
				if (typeof userProfile !== 'string') {
					throw new Error('Windows: Unexpected undefined %USERPROFILE% environment variable');
				}

				appDataPath = URI.parse(path.join(userProfile, 'AppData', 'Roaming'));
			}
			break;
		case platform.OperatingSystem.Macintosh:
			appDataPath = homedir.with({ path: path.join(homedir.path, 'Library', 'Application Support') });
			break;
		case platform.OperatingSystem.Linux:
			appDataPath = process.env['XDG_CONFIG_HOME'] ? URI.parse(process.env['XDG_CONFIG_HOME']) : homedir.with({ path: path.join(homedir.path, '.config') });
			break;
		default:
			throw new Error('Platform not supported');
	}

	return appDataPath.with({ path: path.join(appDataPath.path, 'Code', 'User', 'settings.json') });
}
