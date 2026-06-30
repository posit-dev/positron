/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import { StoredModelConfig } from './configTypes.js';

export function getStoredModels(context: vscode.ExtensionContext): StoredModelConfig[] {
	return context.globalState.get('positron.assistant.models') || [];
}
