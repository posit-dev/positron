/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { decodeImageDataUrl, getImageExtensionForMimeType } from '../../../services/positronPlots/common/imageDataUrl.js';
import { IPositronPlotsService } from '../../../services/positronPlots/common/positronPlots.js';

/**
 * Returns the extensionless display name for a cell image, such as
 * `notebook_cell1`. Supply imageIndex only for multi-image cells.
 */
export function getImageOutputName(documentUri: URI, cellIndex: number, imageIndex?: number): string {
	const documentName = basename(documentUri);
	const nameWithoutExt = documentName.substring(0, documentName.length - extname(documentUri).length);
	const cellName = `${nameWithoutExt}_cell${cellIndex + 1}`;
	return imageIndex === undefined ? cellName : `${cellName}_image${imageIndex + 1}`;
}

/**
 * Returns the default export filename for a named image output.
 */
export function getDefaultImageFilename(name: string, mimeType: string): string {
	return `${name}${getImageExtensionForMimeType(mimeType)}`;
}

/**
 * Saves an image output to a user-selected file.
 * @param targetUri Optional destination that bypasses the dialog in tests.
 * @returns `true` when the image was written; otherwise `false`.
 */
export async function saveImageOutput(
	dataUrl: string,
	documentUri: URI,
	name: string,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	logService: ILogService,
	notificationService: INotificationService,
	targetUri?: URI,
): Promise<boolean> {
	const decoded = decodeImageDataUrl(dataUrl);
	if (!decoded) {
		notificationService.error(localize('positron.notebook.saveImageFailed', "Failed to save image"));
		return false;
	}

	try {
		// Default to the source document's directory.
		const extension = getImageExtensionForMimeType(decoded.mimeType);
		const filename = getDefaultImageFilename(name, decoded.mimeType);
		const defaultDir = dirname(documentUri);
		const defaultUri = defaultDir.with({ path: `${defaultDir.path}/${filename}` });

		const saveUri = targetUri ?? await fileDialogService.showSaveDialog({
			title: localize('positron.notebook.saveImageTitle', "Save Image"),
			defaultUri,
			filters: [
				{ name: localize('positron.notebook.imageFiles', "Image Files"), extensions: [extension.substring(1)] }
			]
		});

		if (!saveUri) {
			return false;
		}

		await fileService.writeFile(saveUri, decoded.data);
		notificationService.info(localize('positron.notebook.imageSaved', "{0} saved", basename(saveUri)));
		return true;
	} catch (error) {
		logService.error('Failed to save notebook image output:', error);
		notificationService.error(localize('positron.notebook.saveImageFailed', "Failed to save image"));
		return false;
	}
}

/**
 * Opens an image output in a plot editor without writing it to disk. The plot
 * client is released when the editor closes.
 * @param code Code that produced the image, when available.
 */
export async function openImageOutputInNewTab(
	dataUrl: string,
	documentUri: URI,
	name: string,
	plotsService: IPositronPlotsService,
	logService: ILogService,
	notificationService: INotificationService,
	code?: string,
): Promise<void> {
	try {
		// Include the source document in the identity so identical outputs from
		// same-named documents do not share a tab.
		await plotsService.openImageInEditor(dataUrl, { name, code, scope: documentUri.toString() });
	} catch (error) {
		logService.error('Failed to open notebook image output in a new tab:', error);
		notificationService.error(localize('positron.notebook.openOutputFailed', "Failed to open output"));
	}
}
