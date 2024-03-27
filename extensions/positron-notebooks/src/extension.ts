/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import path from 'path';
import * as vscode from 'vscode';
import { readFileSync } from 'fs';

/**
 * ProxyServerStyles type.
 */
export type ProxyServerStyles = { readonly [key: string]: string | number };

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Command that converts an image from the local file-system to a base64 string.
	context.subscriptions.push(
		vscode.commands.registerCommand(
			'positronNotebookHelpers.convertImageToBase64',
			async (imageSrc: string, baseLoc: string) => {
				const imageType = path.extname(imageSrc).slice(1);
				try {
					const data = readFileSync(path.join(baseLoc, imageSrc));
					return `data:image/${imageType};base64,${data.toString('base64')}`;
				} catch (e) {
					console.error(e);
					return 'failed to convert image to base64';
				}
			}
		)
	);
}
