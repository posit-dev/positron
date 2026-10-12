/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { URI } from '../../../../base/common/uri.js';
import { isCancellationError } from '../../../../base/common/errors.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { createFolderErrorMessage } from '../../utils/createFolder.js';
import type { PositronReactServices } from '../../../../base/browser/positronReactServices.js';
import type { NewFolderFlowState, NewFolderFlowStateManager } from '../newFolderFlowState.js';

/**
 * The services the New Folder Flow's accept step needs.
 */
export type AcceptNewFolderFlowServices = Pick<PositronReactServices, 'fileService' | 'logService' | 'notificationService'>;

/**
 * The parts of the New Folder Flow state manager the accept step reads.
 */
export type AcceptNewFolderFlowState = Pick<NewFolderFlowStateManager, 'folderName' | 'parentFolder' | 'getState'>;

/**
 * Accepts the New Folder Flow. Creates the folder while the dialog is still open, so that if
 * creation fails, the user keeps every choice and can go back to change the location. Then
 * disposes the dialog and runs the rest of the setup. Any failure is reported in a notification.
 * Never rejects.
 * @param flow The flow state manager. `getState()` is called only after the folder is created,
 * because it clears some language-specific choices that a retry must keep.
 * @param services The services to use.
 * @param dispose Disposes the dialog.
 * @param setUpFolder Runs everything after folder creation.
 */
export async function acceptNewFolderFlow(
	flow: AcceptNewFolderFlowState,
	services: AcceptNewFolderFlowServices,
	dispose: () => void,
	setUpFolder: (state: NewFolderFlowState, folder: URI, existed: boolean) => Promise<void>,
): Promise<void> {
	// Read these once: the Folder Name input stays editable while the folder is created, so the
	// state manager's values can change before the snapshot below.
	const folderName = flow.folderName;
	const parentFolder = flow.parentFolder;
	let folder: URI;
	let existed: boolean;
	try {
		folder = URI.joinPath(parentFolder, folderName);
		existed = await services.fileService.exists(folder);
		if (!existed) {
			await services.fileService.createFolder(folder);
		}
	} catch (err) {
		// The Folder Name and Location step already checked that the folder can be created, so
		// this is rare.
		services.logService.error('New Folder Flow: could not create the folder', err);
		services.notificationService.error(createFolderErrorMessage(err));
		return;
	}

	try {
		// Take the snapshot only now: getState() clears some language-specific choices, which
		// must survive a failed creation. The dialog is still open, so the state manager is not
		// disposed.
		const state = { ...flow.getState(), folderName, parentFolder };
		dispose();
		await setUpFolder(state, folder, existed);
	} catch (err) {
		// Opening the folder in this window may cancel the pending call as the window shuts down;
		// that is not a failure.
		if (isCancellationError(err)) {
			return;
		}
		services.logService.error('New Folder Flow: could not set up the new folder', err);
		services.notificationService.error(localize(
			'positron.newFolderFlow.setUpFolderFailed',
			"Could not set up the new folder '{0}': {1}",
			folderName, toErrorMessage(err)
		));
	}
}

/**
 * The New Folder Flow dialog's accept and cancel handlers.
 */
export interface NewFolderFlowDialogHandlers {
	/**
	 * Accepts the flow.
	 */
	readonly accept: () => Promise<void>;
	/**
	 * Cancels the flow and closes the dialog.
	 */
	readonly cancel: () => void;
}

/**
 * Creates the New Folder Flow dialog's accept and cancel handlers, which keep them from
 * overlapping. While an accept is in flight, a second accept and a cancel are ignored: the folder
 * is created before the dialog closes, and a cancel would not stop it from being set up. After a
 * cancel, a late accept is ignored, because a step can await other work before it calls accept.
 * @param accept Accepts the flow.
 * @param close Closes the dialog.
 * @returns The handlers.
 */
export function createNewFolderFlowDialogHandlers(
	accept: () => Promise<void>,
	close: () => void,
): NewFolderFlowDialogHandlers {
	let accepting = false;
	let closed = false;
	return {
		accept: async () => {
			if (accepting || closed) {
				return;
			}
			accepting = true;
			try {
				await accept();
			} finally {
				accepting = false;
			}
		},
		cancel: () => {
			if (accepting) {
				return;
			}
			closed = true;
			close();
		},
	};
}
