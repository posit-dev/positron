/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as vscode from 'vscode';
import { readFile } from 'fs';

// Make a debounced error logger function so we don't spam the console with errors as a user is
// typing in a file name.
const errorLogger = debouncedError(300);
/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Command that converts an image from the local file-system to a base64 string.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronNotebookHelpers.convertImageToBase64',
			async (imageSrc: string, baseLoc: string) => new Promise<string | null>((resolve) => {
				const fileExtension = path.extname(imageSrc).slice(1);
				const mimeType = mimeTypeMap[fileExtension];
				if (!mimeType) {
					errorLogger(`Unsupported file type: "${fileExtension}."`);
					resolve(null);
					return;
				}
				try {
					readFile(path.join(baseLoc, imageSrc), (err, data) => {
						if (err) {
							errorLogger(err);
							resolve(null);
						} else if (!data) {
							errorLogger('No data found.');
							resolve(null);
						} else {
							resolve(`data:${mimeType};base64,${data.toString('base64')}`);
						}
					});
				} catch (e) {
					errorLogger(e);
					return null;
				}
			})
		)
	);
}

/**
 * Simple debounced error logger.
 * @param wait The time to wait before logging the error.
 * @returns A debounced error logger function.
 */
function debouncedError(wait: number) {
	// In case we want to swap for a different log function
	const errorFn = console.error;
	let timeout: ReturnType<typeof setTimeout> | null = null;

	function debounceWrapper(...args: Parameters<typeof console.error>): void {
		if (!wait) {
			errorFn(...args);
			return;
		}

		// Reset the timeout
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}

		timeout = setTimeout(function () {
			timeout = null;
			errorFn(...args);
		}, wait);

		return;
	}

	return debounceWrapper;
}


/**
 * Map image file extension to MIME type.
 *
 * Supports all the 'image' types from [this list](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types/Common_types)
 */
const mimeTypeMap: Record<string, string> = {
	png: 'image/png',
	apng: 'image/apng',
	avif: 'image/avif',
	ico: 'image/vnd.microsoft.icon',
	jpeg: 'image/jpeg',
	jpg: 'image/jpeg',
	gif: 'image/gif',
	bmp: 'image/bmp',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	tiff: 'image/tiff',
	tif: 'image/tiff',
};
