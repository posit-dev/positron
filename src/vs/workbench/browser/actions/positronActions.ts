/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { ITelemetryData } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { workspacesCategory } from 'vs/workbench/browser/actions/workspaceActions';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EnterMultiRootWorkspaceSupportContext } from 'vs/workbench/common/contextkeys';
import { showNewFolderModalDialog } from 'vs/workbench/browser/positronModalDialogs/newFolderModalDialog';
import { showNewFolderFromGitModalDialog } from 'vs/workbench/browser/positronModalDialogs/newFolderFromGitModalDialog';

/**
 * The PositronNewFolderAction.
 */
export class PositronNewFolderAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.newFolder';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronNewFolderAction.ID,
			title: {
				value: localize('positronNewFolder', "New Folder..."),
				// mnemonicTitle: localize({ key: 'miPositronNewFolder', comment: ['&& denotes a mnemonic'] }, "New F&&older..."),
				original: 'New Folder...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: EnterMultiRootWorkspaceSupportContext,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 4,
			}
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		// Get the services we need to create the new workspace, if the user accept the dialog.
		const commandService = accessor.get(ICommandService);
		const fileService = accessor.get(IFileService);
		const pathService = accessor.get(IPathService);

		// Show the new folder modal dialog. If the result is undefined, the user canceled the operation.
		const result = await showNewFolderModalDialog(accessor);
		if (!result) {
			return;
		}

		// Create the new folder.
		const folder = URI.file((await pathService.path).join(result.parentFolder, result.folder));
		if (!(await fileService.exists(folder))) {
			await fileService.createFolder(folder);
		}
		await commandService.executeCommand(
			'vscode.openFolder',
			folder,
			{
				forceNewWindow: result.newWindow,
				forceReuseWindow: !result.newWindow
			}
		);
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
		const commandService = accessor.get(ICommandService);
		const configService = accessor.get(IConfigurationService);

		const result = await showNewFolderFromGitModalDialog(accessor);
		if (result?.repo) {
			// temporarily set openAfterClone to facilitate result.newWindow
			// then set it back afterwards
			const kGitOpenAfterClone = 'git.openAfterClone';
			const prevOpenAfterClone = configService.getValue(kGitOpenAfterClone);
			configService.updateValue(kGitOpenAfterClone, result.newWindow ? 'alwaysNewWindow' : 'always');
			try {
				await commandService.executeCommand('git.clone', result.repo, result.parentFolder);
			} finally {
				configService.updateValue(kGitOpenAfterClone, prevOpenAfterClone);
			}
		}
	}
}

/**
 * The PositronOpenWorkspaceInNewWindowAction.
 */
export class PositronOpenWorkspaceInNewWindowAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.openWorkspaceInNewWindow';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronOpenWorkspaceInNewWindowAction.ID,
			title: {
				value: localize('positronOpenWorkspaceInNewWindow', "Open Workspace in New Window..."),
				original: 'Open Workspace in New Window...'
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
		return fileDialogService.pickFolderAndOpen({ forceNewWindow: true, telemetryExtraData: data });
	}
}

// Register the actions defined above.
registerAction2(PositronNewFolderAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenWorkspaceInNewWindowAction);
