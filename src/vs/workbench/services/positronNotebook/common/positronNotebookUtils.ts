/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

/**
 * Configuration key for the default notebook editor setting
 */
export const POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY = 'positron.notebooks.defaultEditor';

/**
 * Get the user's preferred notebook editor from the feature flag
 * @param configurationService Configuration service
 * @returns 'positron' | 'vscode'
 */
export function getPreferredNotebookEditor(configurationService: IConfigurationService): 'positron' | 'vscode' {
	const value = configurationService.getValue<'positron' | 'vscode'>(POSITRON_NOTEBOOK_DEFAULT_EDITOR_CONFIG_KEY) || 'vscode';
	return value === 'positron' || value === 'vscode' ? value : 'vscode';
}

/**
 * Check if Positron notebooks are configured as the default editor for .ipynb files
 * @param configurationService Configuration service
 * @returns true if Positron notebooks are the default editor, false otherwise
 */
export function usingPositronNotebooks(configurationService: IConfigurationService): boolean {
	const editorAssociations = configurationService.getValue<Record<string, string>>('workbench.editorAssociations') || {};
	return editorAssociations['*.ipynb'] === 'workbench.editor.positronNotebook';
}
