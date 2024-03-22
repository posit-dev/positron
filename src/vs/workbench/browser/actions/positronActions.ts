/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ITelemetryData } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { workspacesCategory } from 'vs/workbench/browser/actions/workspaceActions';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EnterMultiRootWorkspaceSupportContext } from 'vs/workbench/common/contextkeys';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { showNewFolderModalDialog } from 'vs/workbench/browser/positronModalDialogs/newFolderModalDialog';
import { showNewFolderFromGitModalDialog } from 'vs/workbench/browser/positronModalDialogs/newFolderFromGitModalDialog';
import { showNewProjectModalDialog } from 'vs/workbench/browser/positronModalDialogs/newProjectWizard/newProjectModalDialog';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';

/**
 * The PositronNewProjectAction.
 */
export class PositronNewProjectAction extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.newProject';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronNewProjectAction.ID,
			title: {
				value: localize('positronNewProject', "New Project..."),
				// mnemonicTitle: localize({ key: 'miPositronNewProject', comment: ['&& denotes a mnemonic'] }, "New P&&roject..."),
				original: 'New Project...'
			},
			category: workspacesCategory,
			f1: true,
			// TODO: remove feature flag IsDevelopmentContext when the feature is ready
			precondition: ContextKeyExpr.and(EnterMultiRootWorkspaceSupportContext, IsDevelopmentContext),
			menu: {
				id: MenuId.MenubarFileMenu,
				group: '1_newfolder',
				order: 3,
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

		// TODO: see if we can pass in the result of ContextKeyExpr.deserialize('!config.git.enabled || git.missing')
		// to the dialog so we can show a warning next to the git init checkbox if git is not configured.

		// Show the new folder modal dialog. If the result is undefined, the user canceled the operation.
		const result = await showNewProjectModalDialog(accessor);
		if (!result) {
			return;
		}

		// Create the new project.
		const folder = URI.file((await pathService.path).join(result.parentFolder, result.projectName));
		if (!(await fileService.exists(folder))) {
			await fileService.createFolder(folder);
		}
		await commandService.executeCommand(
			'vscode.openFolder',
			folder,
			{
				forceNewWindow: result.openInNewWindow,
				forceReuseWindow: !result.openInNewWindow
			}
		);

		// TODO: whether the folder is opened in a new window or not, we will need to store the
		// project configuration in some workspace state so that we can use it to start the runtime.
		// The extension host gets destroyed when a new project is opened in the same window.
		//   - Where can the new project config be stored?
		//       - See IStorageService, maybe StorageScope.WORKSPACE and StorageTarget.MACHINE

		// 1) Create the directory for the new project (done above)
		// 2) Set up the initial workspace for the new project
		//   For Python
		//     - If new environment creation is selected, create the .venv/.conda/etc. as appropriate
		//     - If git init selected, create the .gitignore and README.md
		//     - Create an unsaved Python file
		//     - Set the active interpreter to the selected interpreter
		//   For R
		//     - If renv selected, run renv::init()
		//     - Whether or not git init selected, create the .gitignore and README.md
		//     - Create an unsaved R file
		//     - Set the active interpreter to the selected interpreter
		//   For Jupyter Notebook
		//     - If git init selected, create the .gitignore and README.md
		//     - Create an unsaved notebook file
		//     - Set the active interpreter to the selected interpreter

		// Other Thoughts
		//   - Can the interpreter discovery at startup be modified to directly use the selected
		//     interpreter, so that the user doesn't have to wait for the interpreter discovery to
		//     complete before the runtime is started?
	}
}

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
		// Show the new folder modal dialog.
		await showNewFolderModalDialog(
			accessor.get(ICommandService),
			accessor.get(IFileDialogService),
			accessor.get(IFileService),
			accessor.get(IKeybindingService),
			accessor.get(IWorkbenchLayoutService),
			accessor.get(IPathService)
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
		// Show the new folder from Git modal dialog.
		await showNewFolderFromGitModalDialog(
			accessor.get(ICommandService),
			accessor.get(IConfigurationService),
			accessor.get(IFileDialogService),
			accessor.get(IKeybindingService),
			accessor.get(IWorkbenchLayoutService),
		);
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
registerAction2(PositronNewProjectAction);
registerAction2(PositronNewFolderAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenFolderInNewWindowAction);

