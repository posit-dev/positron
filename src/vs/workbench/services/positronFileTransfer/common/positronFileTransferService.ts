/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IPositronFileTransferService = createDecorator<IPositronFileTransferService>('positronFileTransferService');

/**
 * Tracks files that flow into or out of the workspace through the Positron
 * file explorer (drag-and-drop, "Upload...", and "Download..."). Used by the
 * Positron extension API to publish `onDidUploadFile` and `onDidDownloadFile`
 * events for auditing.
 */
export interface IPositronFileTransferService {
	readonly _serviceBrand: undefined;

	/**
	 * Fires after a file has been written into the workspace via upload or
	 * import. Folder operations fire one event per file written.
	 */
	readonly onDidUploadFile: Event<URI>;

	/**
	 * Fires after a file has been read from the workspace for download.
	 * Folder operations fire one event per file read.
	 */
	readonly onDidDownloadFile: Event<URI>;

	/**
	 * Records an upload of `resource` (the destination URI in the workspace)
	 * and fires `onDidUploadFile`.
	 */
	notifyFileUploaded(resource: URI): void;

	/**
	 * Records a download of `resource` (the source URI in the workspace)
	 * and fires `onDidDownloadFile`.
	 */
	notifyFileDownloaded(resource: URI): void;
}
