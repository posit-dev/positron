/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { URI } from '../../../base/common/uri.js';
import { toErrorMessage } from '../../../base/common/errorMessage.js';
import { FileSystemProviderErrorCode, toFileSystemProviderErrorCode } from '../../../platform/files/common/files.js';
import type { PositronReactServices } from '../../../base/browser/positronReactServices.js';

/**
 * The command, registered by the `positron-file-transfer` extension, that checks whether the user
 * can create a folder in a folder. `extensions/canCreateFolderCommand.vitest.ts` keeps this in step
 * with the extension.
 */
export const CAN_CREATE_FOLDER_IN_COMMAND = 'positron.fileTransfer.canCreateFolderIn';

/**
 * The services needed to check that a folder can be created.
 */
export type CheckCanCreateFolderServices = Pick<PositronReactServices, 'commandService' | 'logService'>;

/**
 * The message for a location the user cannot write to.
 */
function noPermissionMessage(): string {
	return localize(
		'positron.createFolder.noPermissions',
		"You don't have permission to create a folder in this location."
	);
}

/**
 * Converts an error from creating a folder into a message for the user.
 * @param error The error.
 * @returns The message.
 */
export function createFolderErrorMessage(error: unknown): string {
	if (toFileSystemProviderErrorCode(error as Error) === FileSystemProviderErrorCode.NoPermissions) {
		return noPermissionMessage();
	}
	return localize(
		'positron.createFolder.failed',
		"Could not create the folder: {0}",
		toErrorMessage(error)
	);
}

/**
 * Checks that the user can create a folder in the given folder, by asking the extension host. The
 * renderer cannot answer this itself: a file stat reports the owner's write permission, not the
 * current user's, and the file service has no access check. The extension host runs where the
 * files are, as the user who owns the session. It has no side effects, so it can run as the user
 * types.
 *
 * When the extension host cannot tell, or cannot be asked, the check passes, and the real creation
 * reports any error.
 * @param parentFolder The folder to create a folder in.
 * @param services The services to use.
 * @returns The error message if a folder cannot be created there, otherwise undefined.
 */
export async function checkCanCreateFolderIn(parentFolder: URI, services: CheckCanCreateFolderServices): Promise<string | undefined> {
	try {
		const canCreate = await services.commandService.executeCommand<boolean | undefined>(
			CAN_CREATE_FOLDER_IN_COMMAND,
			parentFolder
		);
		return canCreate === false ? noPermissionMessage() : undefined;
	} catch (err) {
		services.logService.info(`[CreateFolder] Could not check ${parentFolder.toString()}`, err);
		return undefined;
	}
}
