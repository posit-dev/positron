/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { ITelemetryData } from '../../../base/common/actions.js';
import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { workspacesCategory } from './workspaceActions.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { EnterMultiRootWorkspaceSupportContext } from '../../common/contextkeys.js';
import { showNewFolderFromGitModalDialog } from '../positronModalDialogs/newFolderFromGitModalDialog.js';
import { showNewFolderFlowModalDialog } from '../positronNewFolderFlow/newFolderFlowModalDialog.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';

/**
 * The PositronNewFolderFromTemplateAction.
 */
export class PositronNewFolderFromTemplateAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.newFolderFromTemplate';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronNewFolderFromTemplateAction.ID,
			title: {
				value: localize('positronNewFolderFromTemplate', "New Folder from Template..."),
				original: 'New Folder from Template...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: EnterMultiRootWorkspaceSupportContext,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 3,
			},
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		// TODO: see if we can pass in the result of ContextKeyExpr.deserialize('!config.git.enabled || git.missing')
		// to the dialog so we can show a warning next to the git init checkbox if git is not configured.

		// Show the new folder flow modal dialog.
		await showNewFolderFlowModalDialog(accessor.get(IInstantiationService));
	}
}


/**
 * The PositronNewFolderFromGitAction.
 */
export class PositronNewFolderFromGitAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.newFolderFromGit';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronNewFolderFromGitAction.ID,
			title: {
				value: localize('positronNewFolderFromGit', "New Folder from Git..."),
				// mnemonicTitle: localize({ key: 'miPositronNewFolderFromGit', comment: ['&& denotes a mnemonic'] }, "New Folder from G&&it..."),
				original: 'New Folder from Git...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: ContextKeyExpr.and(
				EnterMultiRootWorkspaceSupportContext,
				ContextKeyExpr.deserialize('config.git.enabled && !git.missing')
			),
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 5,
			}
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		// Show the new folder from Git modal dialog.
		await showNewFolderFromGitModalDialog();
	}
}

/**
 * The PositronOpenFolderInNewWindowAction.
 */
export class PositronOpenFolderInNewWindowAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.openWorkspaceInNewWindow';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronOpenFolderInNewWindowAction.ID,
			title: {
				value: localize('positronOpenFolderInNewWindow', "Open Folder in New Window..."),
				original: 'Open Folder in New Window...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: EnterMultiRootWorkspaceSupportContext,
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 * @param data The ITelemetryData for the invocation.
	 */
	override async run(accessor: ServicesAccessor, data?: ITelemetryData): Promise<void> {
		const fileDialogService = accessor.get(IFileDialogService);
		return fileDialogService.pickFolderAndOpen({
			forceNewWindow: true,
			telemetryExtraData: data
		});
	}
}

// Register the actions defined above.
registerAction2(PositronNewFolderFromTemplateAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenFolderInNewWindowAction);
