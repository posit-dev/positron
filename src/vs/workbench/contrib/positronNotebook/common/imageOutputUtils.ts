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
 * Build the display name for a cell's image output, without a file extension,
 * e.g. "notebook_cell1" for the first cell of notebook.ipynb.
 * @param imageIndex Position of the image among the cell's image outputs. Pass it
 * only when the cell holds more than one image, to keep the common single-image
 * name unsuffixed; the second image of a cell then becomes "notebook_cell1_image2".
 */
export function getImageOutputName(documentUri: URI, cellIndex: number, imageIndex?: number): string {
	const documentName = basename(documentUri);
	const nameWithoutExt = documentName.substring(0, documentName.length - extname(documentUri).length);
	const cellName = `${nameWithoutExt}_cell${cellIndex + 1}`;
	return imageIndex === undefined ? cellName : `${cellName}_image${imageIndex + 1}`;
}

/**
 * Build the default filename for exporting a cell's image output,
 * e.g. "notebook_cell1.png".
 * @param name An image output name from {@link getImageOutputName}.
 */
export function getDefaultImageFilename(name: string, mimeType: string): string {
	return `${name}${getImageExtensionForMimeType(mimeType)}`;
}

/**
 * Save a cell's image output to a file chosen via a save dialog.
 * @param targetUri Optional target path that bypasses the dialog (for testing).
 * @returns Whether the image was saved (false if cancelled or failed).
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
		// Default to the document's directory, under the output's name.
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
			return false; // User cancelled
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
 * Open a cell's image output in a new editor tab.
 *
 * Opens a plot editor tab backed by the image data itself, so nothing is
 * written to disk and the image is released when the tab is closed. Shared by
 * the notebook editor and Quarto inline output.
 */
export async function openImageOutputInNewTab(
	dataUrl: string,
	name: string,
	plotsService: IPositronPlotsService,
	logService: ILogService,
	notificationService: INotificationService,
): Promise<void> {
	try {
		await plotsService.openImageInEditor(dataUrl, name);
	} catch (error) {
		logService.error('Failed to open notebook image output in a new tab:', error);
		notificationService.error(localize('positron.notebook.openOutputFailed', "Failed to open output"));
	}
}
