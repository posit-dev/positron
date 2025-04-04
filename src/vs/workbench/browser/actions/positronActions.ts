/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../nls.js';
import { ITelemetryData } from '../../../base/common/actions.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { ServicesAccessor } from '../../../editor/browser/editorExtensions.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IFileDialogService } from '../../../platform/dialogs/common/dialogs.js';
import { ContextKeyExpr } from '../../../platform/contextkey/common/contextkey.js';
import { IPathService } from '../../services/path/common/pathService.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { workspacesCategory } from './workspaceActions.js';
import { Action2, MenuId, registerAction2 } from '../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { EnterMultiRootWorkspaceSupportContext } from '../../common/contextkeys.js';
import { IWorkbenchLayoutService } from '../../services/layout/browser/layoutService.js';
import { showNewFolderModalDialog } from '../positronModalDialogs/newFolderModalDialog.js';
import { showNewFolderFromGitModalDialog } from '../positronModalDialogs/newFolderFromGitModalDialog.js';
import { showNewProjectModalDialog } from '../positronNewProjectWizard/newProjectModalDialog.js';
import { ILanguageRuntimeService } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IPositronNewProjectService } from '../../services/positronNewProject/common/positronNewProject.js';
import { IWorkspaceTrustManagementService } from '../../../platform/workspace/common/workspaceTrust.js';
import { ILabelService } from '../../../platform/label/common/label.js';
import * as platform from '../../../base/common/platform.js';
import { URI } from '../../../base/common/uri.js';

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

		// Show the new project modal dialog.
		await showNewProjectModalDialog(
			accessor.get(ICommandService),
			accessor.get(IConfigurationService),
			accessor.get(IFileDialogService),
			accessor.get(IFileService),
			accessor.get(IKeybindingService),
			accessor.get(ILabelService),
			accessor.get(ILanguageRuntimeService),
			accessor.get(IWorkbenchLayoutService),
			accessor.get(ILogService),
			accessor.get(IOpenerService),
			accessor.get(IPathService),
			accessor.get(IPositronNewProjectService),
			accessor.get(IRuntimeSessionService),
			accessor.get(IRuntimeStartupService),
			accessor.get(IWorkspaceTrustManagementService),
		);
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
			accessor.get(ILabelService),
			accessor.get(IWorkbenchLayoutService),
			accessor.get(IPathService),
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
			accessor.get(ILabelService),
			accessor.get(IWorkbenchLayoutService),
			accessor.get(IPathService),
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

export class PositronImportSettings extends Action2 {
	/**
	 * The action ID.
	 */
	static readonly ID = 'positron.workbench.action.importSettings';

	/**
	 * Constructor.
	 */
	constructor() {
		super({
			id: PositronImportSettings.ID,
			title: {
				value: localize('positronImportSettings', "Import Settings..."),
				original: 'Import Settings...'
			},
			category: 'Preferences',
			f1: true,
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		const pathService = accessor.get(IPathService);
		const fileService = accessor.get(IFileService);

		const codeSettingsPath = await this.getCodeSettingsPath(pathService);
		const codeSettingsContent = await fileService.readFile(codeSettingsPath);

		alert(`Import settings from ${codeSettingsContent.value.toString()}`);
	}

	private async getCodeSettingsPath(pathService: IPathService): Promise<URI> {
		const path = await pathService.path;
		const homedir = await pathService.userHome();

		let appDataPath: URI;
		switch (platform.OS) {
			case platform.OperatingSystem.Windows:
				if (process.env['APPDATA']) {
					appDataPath = URI.parse(process.env['APPDATA']);
				} else {
					const userProfile = process.env['USERPROFILE'];
					if (typeof userProfile !== 'string') {
						throw new Error('Windows: Unexpected undefined %USERPROFILE% environment variable');
					}

					appDataPath = URI.parse(path.join(userProfile, 'AppData', 'Roaming'));
				}
				break;
			case platform.OperatingSystem.Macintosh:
				appDataPath = homedir.with({ path: path.join(homedir.path, 'Library', 'Application Support') });
				break;
			case platform.OperatingSystem.Linux:
				appDataPath = process.env['XDG_CONFIG_HOME'] ? URI.parse(process.env['XDG_CONFIG_HOME']) : homedir.with({ path: path.join(homedir.path, '.config') });
				break;
			default:
				throw new Error('Platform not supported');
		}

		return appDataPath.with({ path: path.join(appDataPath.path, 'Code', 'User', 'settings.json') });
	}


}

// Register the actions defined above.
registerAction2(PositronNewProjectAction);
registerAction2(PositronNewFolderAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenFolderInNewWindowAction);
registerAction2(PositronImportSettings);
