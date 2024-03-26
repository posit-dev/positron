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
registerAction2(PositronNewFolderAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenFolderInNewWindowAction);
