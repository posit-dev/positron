/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from './positronNotebookConfig.js';

export const POSITRON_NOTEBOOK_EDITOR_ID = 'workbench.editor.positronNotebook';

export const POSITRON_NOTEBOOK_EDITOR_INPUT_ID = 'workbench.input.positronNotebook';

export const POSITRON_EXECUTE_CELL_COMMAND_ID = 'positronNotebook.cell.execute';

/**
 * Returns whether Positron Notebooks should be used.
 * @param configurationService Configuration service
 * @returns true if Positron notebooks are configured as the default editor
 */
export function usingPositronNotebooks(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
}

// Group IDs used to visually differentiate actions in the cell action bar
// Primary actions are shown more prominently than others
export enum PositronNotebookCellActionBarLeftGroup {
	Primary = '0_primary',
}
