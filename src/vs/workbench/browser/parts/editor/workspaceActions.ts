/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { localize } from '../../../../nls.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';


/**
 * Command to clear recent workspaces. This is an adaptation of the
 * ClearRecentFilesAction that only clears workspaces; Positron uses it to offer
 * a convenient "clear recently opened" option for workspaces in the workspace
 * picker.
 */
export class ClearRecentWorkspacesAction extends Action2 {

	static readonly ID = 'workbench.action.clearRecentWorkspaces';

	constructor() {
		super({
			id: ClearRecentWorkspacesAction.ID,
			title: { value: localize('clearRecentWorkspaces', "Clear Recently Opened"), original: 'Clear Recently Opened' },
			// Don't show this in the Command Palette; it would be confused with
			// workbench.action.clearRecentFiles
			f1: false,
			category: Categories.File
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const workspacesService = accessor.get(IWorkspacesService);

		// Ask for confirmation
		const { confirmed } = await dialogService.confirm({
			type: 'warning',
			message: localize('confirmClearWorkspacesMessage', "Do you want to clear all recently opened workspaces?"),
			detail: localize('confirmClearDetail', "This action is irreversible!"),
			primaryButton: localize({ key: 'clearButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Clear")
		});

		if (!confirmed) {
			return;
		}

		// Clear global recently opened
		workspacesService.clearRecentlyOpened();
	}
}

registerAction2(ClearRecentWorkspacesAction);
