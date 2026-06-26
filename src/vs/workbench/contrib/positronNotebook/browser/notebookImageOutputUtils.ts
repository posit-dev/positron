/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, decodeBase64 } from '../../../../base/common/buffer.js';
import { basename, dirname, extname } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { toBase64DataUrl } from './copyImageUtils.js';

/**
 * Derive a file extension (including leading dot) from an image data URL's
 * `data:` prefix. Falls back to `.png` for unknown / missing MIME types.
 */
export function imageExtensionFromDataUrl(dataUrl: string): string {
	const match = /^data:([^;,]+)/.exec(dataUrl);
	const mime = match?.[1]?.toLowerCase() ?? '';
	switch (mime) {
		case 'image/png':
			return '.png';
		case 'image/svg+xml':
			return '.svg';
		case 'image/jpeg':
		case 'image/jpg':
			return '.jpg';
		case 'image/gif':
			return '.gif';
		case 'image/webp':
			return '.webp';
		default:
			return '.png';
	}
}

/**
 * Decode an image data URL into raw bytes. Handles both base64-encoded data
 * URLs (`data:image/png;base64,...`) and URL-encoded SVG data URLs
 * (`data:image/svg+xml,<encoded>`), normalizing the latter to base64 first.
 */
export function imageBytesFromDataUrl(dataUrl: string): Uint8Array | undefined {
	const normalized = toBase64DataUrl(dataUrl);
	const marker = ';base64,';
	const index = normalized.indexOf(marker);
	if (index === -1) {
		return undefined;
	}
	const base64 = normalized.substring(index + marker.length);
	if (!base64) {
		return undefined;
	}
	try {
		return decodeBase64(base64).buffer;
	} catch {
		return undefined;
	}
}

/**
 * Build the default filename for a saved plot: `<docNameNoExt>_cell<index><ext>`.
 */
export function defaultImageFileName(notebookUri: URI, cellIndex: number, ext: string): string {
	const docName = basename(notebookUri);
	const docNameWithoutExt = docName.substring(0, docName.length - extname(notebookUri).length);
	return `${docNameWithoutExt}_cell${cellIndex}${ext}`;
}

export interface ImageOutputTarget {
	readonly dataUrl: string;
	readonly notebookUri: URI;
	readonly cellIndex: number;
}

/**
 * Show a save dialog and write a plot image to disk. Returns `false` if the
 * user cancelled or the image could not be decoded, `true` on a successful
 * write. The optional `targetPath` bypasses the dialog (used for testing).
 */
export async function saveImageFromDataUrl(
	target: ImageOutputTarget,
	fileDialogService: IFileDialogService,
	fileService: IFileService,
	logService: ILogService,
	notificationService: INotificationService,
	targetPath?: URI,
): Promise<boolean> {
	const { dataUrl, notebookUri, cellIndex } = target;
	try {
		const ext = imageExtensionFromDataUrl(dataUrl);
		const defaultFilename = defaultImageFileName(notebookUri, cellIndex, ext);
		const defaultDir = dirname(notebookUri);
		const defaultUri = defaultDir.with({ path: `${defaultDir.path}/${defaultFilename}` });

		let saveUri: URI | undefined;
		if (targetPath) {
			saveUri = targetPath;
		} else {
			saveUri = await fileDialogService.showSaveDialog({
				title: localize('positronNotebook.saveImageTitle', "Save Image"),
				defaultUri,
				filters: [
					{ name: localize('positronNotebook.imageFiles', "Image Files"), extensions: [ext.substring(1)] }
				]
			});
		}

		if (!saveUri) {
			return false; // User cancelled
		}

		const bytes = imageBytesFromDataUrl(dataUrl);
		if (!bytes) {
			throw new Error('Invalid data URL format');
		}

		await fileService.writeFile(saveUri, VSBuffer.wrap(bytes));

		const savedFilename = basename(saveUri);
		notificationService.info(localize('positronNotebook.imageSaved', "{0} saved", savedFilename));
		return true;
	} catch (error) {
		logService.error('[PositronNotebook] Save image failed:', error);
		notificationService.error(localize('positronNotebook.saveImageFailed', "Failed to save image"));
		return false;
	}
}

/**
 * Write a plot image to a temporary file next to the notebook document and open
 * it in a new editor tab.
 */
export async function openImageInEditorFromDataUrl(
	target: ImageOutputTarget,
	fileService: IFileService,
	editorService: IEditorService,
): Promise<void> {
	const { dataUrl, notebookUri, cellIndex } = target;
	const bytes = imageBytesFromDataUrl(dataUrl);
	if (!bytes) {
		throw new Error('Invalid data URL format');
	}

	const ext = imageExtensionFromDataUrl(dataUrl);
	const filename = defaultImageFileName(notebookUri, cellIndex, ext);

	const tempDir = dirname(notebookUri);
	const tempUri = tempDir.with({ path: `${tempDir.path}/.positron-temp-${filename}` });

	await fileService.writeFile(tempUri, VSBuffer.wrap(bytes));

	await editorService.openEditor({
		resource: tempUri,
		options: {
			pinned: false,
			preserveFocus: false,
		}
	});
}
