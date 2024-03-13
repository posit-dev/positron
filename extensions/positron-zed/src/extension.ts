/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ZedRuntimeManager } from './manager';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extention context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register the Zed runtime manager with the Positron runtime.
	positron.runtime.registerLanguageRuntimeManager(new ZedRuntimeManager(context));
}
