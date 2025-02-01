/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { ZedRuntimeManager } from './manager';

/**
 * Activates the extension.
 * @param context An ExtensionContext that contains the extension context.
 */
export function activate(context: vscode.ExtensionContext) {
	// Register the Zed runtime manager with the Positron runtime.
	positron.runtime.registerLanguageRuntimeManager('zed', new ZedRuntimeManager(context));
}
