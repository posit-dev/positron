/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INotificationService, NeverShowAgainScope, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { PositronImportSettings } from './actions.js';


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
				run: async () => {
					setImportWasPrompted(storageService);
					await commandService.executeCommand(PositronImportSettings.ID);
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
