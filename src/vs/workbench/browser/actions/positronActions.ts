/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { workspacesCategory } from 'vs/workbench/browser/actions/workspaceActions';
import { showNewWorkspaceDialog } from 'vs/workbench/browser/parts/positronTopBar/dialogs/newWorkspaceDialog';
import { showNewWorkspaceFromGitDialog } from 'vs/workbench/browser/parts/positronTopBar/dialogs/newWorkspaceFromGitDialog';
import { EnterMultiRootWorkspaceSupportContext } from 'vs/workbench/common/contextkeys';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

export class PositronNewWorkspaceAction extends Action2 {

	static readonly ID = 'positron.workbench.action.newWorkspace';

	constructor() {
		super({
			id: PositronNewWorkspaceAction.ID,
			title: {
				value: localize('positronNewWorkspace', "New Workspace..."),
				mnemonicTitle: localize({ key: 'miPositronNewWorkspace', comment: ['&& denotes a mnemonic'] }, "New W&&orkspace..."),
				original: 'New Workspace...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: EnterMultiRootWorkspaceSupportContext,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newworkspace',
				order: 4,
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {

		const commandService = accessor.get(ICommandService);
		const pathService = accessor.get(IPathService);
		const fileService = accessor.get(IFileService);

		const result = await showNewWorkspaceDialog(accessor);
		if (result?.directory) {
			const workspaceDir = URI.file((await pathService.path).join(result.parentDirectory, result.directory));
			if (!(await fileService.exists(workspaceDir))) {
				await fileService.createFolder(workspaceDir);
			}
			await commandService.executeCommand(
				'vscode.openFolder',
				workspaceDir,
				{
					forceNewWindow: result.newWindow,
					forceReuseWindow: !result.newWindow
				}
			);
		}
	}
}

export class PositronNewWorkspaceFromGitAction extends Action2 {

	static readonly ID = 'positron.workbench.action.newWorkspaceFromGit';

	constructor() {
		super({
			id: PositronNewWorkspaceFromGitAction.ID,
			title: {
				value: localize('positronNewWorkspaceFromGit', "New Workspace from Git..."),
				mnemonicTitle: localize({ key: 'miPositronNewWorkspaceFromGit', comment: ['&& denotes a mnemonic'] }, "New Workspace from G&&it..."),
				original: 'New Workspace from Git...'
			},
			category: workspacesCategory,
			f1: true,
			precondition: EnterMultiRootWorkspaceSupportContext,
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newworkspace',
				order: 5,
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const configService = accessor.get(IConfigurationService);
		const contextKeyService = accessor.get(IContextKeyService);
		const notificationService = accessor.get(INotificationService);

		// check if git is available
		const gitEnabled = configService.getValue('git.enabled');
		if (!gitEnabled) {
			notificationService.error(localize('positronGitNotEnabled', "Git is not current enabled."));
			return;
		}
		const gitMissing = contextKeyService.getContextKeyValue('git.missing');
		if (gitMissing) {
			notificationService.error(localize('positronGitMissing', "Git is not currently installed."));
			return;
		}

		const result = await showNewWorkspaceFromGitDialog(accessor);
		if (result?.repo) {
			// temporarily set openAfterClone to facilitate result.newWindow
			// then set it back afterwards
			const kGitOpenAfterClone = 'git.openAfterClone';
			const prevOpenAfterClone = configService.getValue(kGitOpenAfterClone);
			configService.updateValue(kGitOpenAfterClone, result.newWindow ? 'alwaysNewWindow' : 'always');
			try {
				await commandService.executeCommand('git.clone', result.repo, result.parentDirectory);
			} finally {
				configService.updateValue(kGitOpenAfterClone, prevOpenAfterClone);
			}
		}
	}
}

// --- Actions Registration
registerAction2(PositronNewWorkspaceAction);
registerAction2(PositronNewWorkspaceFromGitAction);





