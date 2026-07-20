/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from './positronNotebookConfig.js';

export const POSITRON_NOTEBOOK_EDITOR_ID = 'workbench.editor.positronNotebook';

export const POSITRON_NOTEBOOK_EDITOR_INPUT_ID = 'workbench.input.positronNotebook';

export const POSITRON_EXECUTE_CELL_COMMAND_ID = 'positronNotebook.cell.execute';

export const SELECT_KERNEL_ID_POSITRON = 'positronNotebook.selectKernel';

/**
 * Returns whether Positron Notebooks should be used.
 * @param configurationService Configuration service
 * @returns true if Positron notebooks are configured as the default editor
 */
export function usingPositronNotebooks(configurationService: IConfigurationService): boolean {
	return configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
}

export const POSITRON_NOTEBOOK_CATEGORY = localize2('positronNotebook.category', 'Notebook');

// Group IDs used to organize cell actions in menus and context menus
export enum PositronNotebookCellActionGroup {
	Clipboard = '0_clipboard',
	CellType = '1_celltype',
	Insert = '2_insert',
	Order = '3_order',
	Execution = '4_execution',
	Tags = '5_tags',
}

// Group IDs used to visually differentiate actions in the cell action bar
// Primary actions are shown more prominently than others
export enum PositronNotebookCellActionBarLeftGroup {
	Primary = '0_primary',
}

// Group IDs for output actions menu
export enum PositronNotebookCellOutputActionGroup {
	Copy = '0_copy',
	Visibility = '1_visibility',
	Destructive = '2_destructive',
}

/**
 * Enum of Positron Notebook Action IDs
 * Not exhaustive; add here when Action IDs are referenced in more than one place.
 */
export enum PositronNotebookActionId {
	CopyOutput = 'positronNotebook.cell.copyOutput',
	CopyOutputImage = 'positronNotebook.cell.copyOutputImage',
	CopyOutputJson = 'positronNotebook.cell.copyOutputJson',
	SaveOutputImage = 'positronNotebook.cell.saveOutputImage',
	OpenOutputImageInNewTab = 'positronNotebook.cell.openOutputImageInNewTab',
}

/**
 * Check if a given string is a valid Positron Notebook Action ID
 * Not exhaustive; add actions to the PositronNotebookActionId enum when action IDs
 * are referenced in more than one place.
 */
export function isPositronNotebookActionId(id: string): id is PositronNotebookActionId {
	return (Object.values(PositronNotebookActionId) as string[]).includes(id);
}
