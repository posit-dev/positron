/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { PdfPreviewProvider } from './pdfPreview';

/**
 * Activates the PDF Viewer extension.
 * @param context The extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(PdfPreviewProvider.register(context));
}
