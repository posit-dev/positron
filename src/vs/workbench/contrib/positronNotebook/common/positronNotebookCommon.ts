/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const POSITRON_NOTEBOOK_EDITOR_ID = 'workbench.editor.positronNotebook';
export const POSITRON_NOTEBOOK_EDITOR_INPUT_ID = 'workbench.input.positronNotebook';

/**
 * Check if Positron notebooks are configured as the default editor for .ipynb files
 * @param configurationService Configuration service
 * @returns true if Positron notebooks are the default editor, false otherwise
 */

export function usingPositronNotebooks(configurationService: IConfigurationService): boolean {
	const editorAssociations = configurationService.getValue<Record<string, string>>('workbench.editorAssociations') || {};
	return editorAssociations['*.ipynb'] === 'workbench.editor.positronNotebook';
}
