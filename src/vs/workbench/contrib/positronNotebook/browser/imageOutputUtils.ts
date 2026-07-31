/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64 } from '../../../../base/common/buffer.js';
import { getExtensionForMimeType } from '../../../../base/common/mime.js';
import { basename, dirname, extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';

/** An image output data URL decoded into its MIME type and binary contents. */
export interface DecodedImageDataUrl {
	mimeType: string;
	data: VSBuffer;
}

/**
 * Decode an image output data URL into its MIME type and binary contents.
 * Handles both base64 data URLs (PNG outputs) and URL-encoded data URLs
 * (SVG outputs, see getOutputContents.ts).
 * @returns The decoded image, or undefined if the data URL is malformed.
 */
export function decodeImageDataUrl(dataUrl: string): DecodedImageDataUrl | undefined {
	const match = /^data:(?<mimeType>[^;,]+)(?<base64>;base64)?,(?<payload>.*)$/s.exec(dataUrl);
	if (!match?.groups) {
		return undefined;
	}
	const { mimeType, base64, payload } = match.groups;
	if (base64) {
		try {
			return { mimeType, data: decodeBase64(payload) };
		} catch {
			return undefined;
		}
	}
	let text: string;
	try {
		text = decodeURIComponent(payload);
	} catch {
		// Raw payload may contain literal '%' that is not URL-encoded
		text = payload;
	}
	return { mimeType, data: VSBuffer.fromString(text) };
}

/** File extension (including the dot) for an image MIME type, defaulting to '.png'. */
export function getImageExtensionForMimeType(mimeType: string): string {
	return getExtensionForMimeType(mimeType) ?? '.png';
}

/**
 * Build the default filename for exporting a cell's image output,
 * e.g. "notebook_cell1.png" for the first cell of notebook.ipynb.
 */
export function getDefaultImageFilename(notebookUri: URI, cellIndex: number, mimeType: string): string {
	const extension = getImageExtensionForMimeType(mimeType);
	const notebookName = basename(notebookUri);
	const nameWithoutExt = notebookName.substring(0, notebookName.length - extname(notebookUri).length);
	return `${nameWithoutExt}_cell${cellIndex + 1}${extension}`;
}

/**
 * Save an image output to a file chosen via a save dialog.
 * @param targetUri Optional target path that bypasses the dialog (for testing).
 * @returns Whether the image was saved (false if cancelled or failed).
 */
export async function saveImageOutput(
	dataUrl: string,
	notebookUri: URI,
	cellIndex: number,
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
		// Default to the notebook's directory with a name derived from the notebook and cell.
		const extension = getImageExtensionForMimeType(decoded.mimeType);
		const filename = getDefaultImageFilename(notebookUri, cellIndex, decoded.mimeType);
		const defaultDir = dirname(notebookUri);
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
 * Open an image output in a new editor tab.
 * The image editor can only display file-backed resources, so the image is
 * written to a hidden temp file next to the notebook and opened as a preview
 * editor, matching the Quarto inline output popout behavior.
 */
export async function openImageOutputInNewTab(
	dataUrl: string,
	notebookUri: URI,
	cellIndex: number,
	editorService: IEditorService,
	fileService: IFileService,
	logService: ILogService,
	notificationService: INotificationService,
): Promise<void> {
	const decoded = decodeImageDataUrl(dataUrl);
	if (!decoded) {
		notificationService.error(localize('positron.notebook.openOutputFailed', "Failed to open output"));
		return;
	}

	try {
		const filename = getDefaultImageFilename(notebookUri, cellIndex, decoded.mimeType);
		const tempDir = dirname(notebookUri);
		const tempUri = tempDir.with({ path: `${tempDir.path}/.positron-temp-${filename}` });

		await fileService.writeFile(tempUri, decoded.data);

		await editorService.openEditor({
			resource: tempUri,
			options: {
				pinned: false,
				preserveFocus: false,
			}
		});
	} catch (error) {
		logService.error('Failed to open notebook image output in a new tab:', error);
		notificationService.error(localize('positron.notebook.openOutputFailed', "Failed to open output"));
	}
}
