/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IClipboardService } from '../../../../platform/clipboard/common/clipboardService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { toBase64ImageDataUrl } from '../../../services/positronPlots/common/imageDataUrl.js';

/**
 * Shape of the arg passed to `positronNotebook.cell.copyOutputImage` to target
 * a specific image output.
 */
export interface CopyImageMenuArg {
	imageDataUrl: string;

	/**
	 * Id of the output the image belongs to, used to tell a cell's image outputs
	 * apart. Absent if the click didn't land on an image carrying the id.
	 */
	outputId?: string;
}

export function isCopyImageMenuArg(arg: unknown): arg is CopyImageMenuArg {
	return typeof arg === 'object' && arg !== null && typeof (arg as CopyImageMenuArg).imageDataUrl === 'string';
}

/**
 * Copy an image data URL to the clipboard, logging and notifying the user on failure.
 */
export async function copyImageToClipboard(
	dataUrl: string,
	clipboardService: IClipboardService,
	logService: ILogService,
	notificationService: INotificationService,
): Promise<void> {
	try {
		await clipboardService.writeImage(toBase64ImageDataUrl(dataUrl));
	} catch (err) {
		logService.error('Failed to copy image to clipboard:', err);
		notificationService.error(localize('copyImageFailed', "Failed to copy image to clipboard"));
	}
}
