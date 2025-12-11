/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as vscode from 'vscode';
import { readFile } from 'fs';
import * as https from 'https';
import * as http from 'http';

// Make sure this matches the error message type defined where used
// (src/vs/workbench/contrib/positronNotebook/browser/notebookCells/DeferredImage.tsx)
type ConversionErrorMsg = {
	status: 'error';
	message: string;
};

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Command that converts an image from the local file-system to a base64 string.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronNotebookHelpers.convertImageToBase64',
			async (imageSrc: string, baseLoc: string) => new Promise<string | ConversionErrorMsg>((resolve) => {
				const fullImagePath = path.join(baseLoc, imageSrc);
				const fileExtension = path.extname(imageSrc).slice(1);
				const mimeType = mimeTypeMap[fileExtension.toLowerCase()];
				if (!mimeType) {
					resolve({
						status: 'error',
						message: `Unsupported file type: "${fileExtension}."`,
					});
					return;
				}
				try {
					readFile(fullImagePath, (err, data) => {
						if (err) {
							resolve({
								status: 'error',
								message: err.message,
							});
						} else if (!data) {
							resolve({
								status: 'error',
								message: `No data found in file "${fullImagePath}."`,
							});
						} else {
							resolve(`data:${mimeType};base64,${data.toString('base64')}`);
						}
					});
				} catch (e) {
					return {
						status: 'error',
						message: e instanceof Error ? e.message : `Error occured while converting image ${fullImagePath} to base64.`,
					};
				}
			})
		)
	);

	/**
	 * Command that fetches a remote image and converts it to a base64 data URL.
	 *
	 * This command is used to load remote SVG images in Positron notebooks.
	 * Positron notebooks render markdown directly in the main window context
	 * and not in a webview like built-in VS Code notebooks. VS Code blocks
	 * remote SVGs unless it is for the notebook webview (see `src/vs/code/electron-main/app.ts`)
	 */
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronNotebookHelpers.fetchRemoteImage',
			(imageUrl: string) => new Promise<string | ConversionErrorMsg>((resolve) => {
				// Determine protocol
				const protocol = imageUrl.startsWith('https:') ? https : http;

				try {
					protocol.get(imageUrl, (response) => {
						// Check for successful response
						if (response.statusCode !== 200) {
							resolve({
								status: 'error',
								message: `Failed to fetch image: HTTP ${response.statusCode}`,
							});
							return;
						}

						// Get MIME type from response headers or infer from URL
						let mimeType = response.headers['content-type'];
						if (!mimeType || !mimeType.startsWith('image/')) {
							// Try to infer from URL extension
							const urlExtension = path.extname(new URL(imageUrl).pathname).slice(1);
							mimeType = mimeTypeMap[urlExtension.toLowerCase()];
							if (!mimeType) {
								resolve({
									status: 'error',
									message: `Unsupported or missing content type: ${response.headers['content-type']}`,
								});
								return;
							}
						}

						// Collect response data
						const chunks: Buffer[] = [];
						response.on('data', (chunk) => {
							chunks.push(Buffer.from(chunk));
						});

						response.on('end', () => {
							try {
								const buffer = Buffer.concat(chunks);
								const base64 = buffer.toString('base64');
								resolve(`data:${mimeType};base64,${base64}`);
							} catch (e) {
								resolve({
									status: 'error',
									message: e instanceof Error ? e.message : 'Failed to convert image to base64',
								});
							}
						});

						response.on('error', (err) => {
							resolve({
								status: 'error',
								message: err.message,
							});
						});
					}).on('error', (err) => {
						resolve({
							status: 'error',
							message: err.message,
						});
					});
				} catch (e) {
					resolve({
						status: 'error',
						message: e instanceof Error ? e.message : `Error occurred while fetching image ${imageUrl}`,
					});
				}
			})
		)
	);
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
