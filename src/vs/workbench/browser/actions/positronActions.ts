/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2025 Posit Software, PBC. All rights reserved.
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
import { showNewFolderFromGitModalDialog } from '../positronModalDialogs/newFolderFromGitModalDialog.js';
import { showNewFolderFlowModalDialog } from '../positronNewFolderFlow/newFolderFlowModalDialog.js';
import { ILanguageRuntimeService } from '../../services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../services/runtimeSession/common/runtimeSessionService.js';
import { IRuntimeStartupService } from '../../services/runtimeStartup/common/runtimeStartupService.js';
import { ILogService } from '../../../platform/log/common/log.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IPositronNewFolderService } from '../../services/positronNewFolder/common/positronNewFolder.js';
import { IWorkspaceTrustManagementService } from '../../../platform/workspace/common/workspaceTrust.js';
import { ILabelService } from '../../../platform/label/common/label.js';

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
		await showNewFolderFlowModalDialog(
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
			accessor.get(IPositronNewFolderService),
			accessor.get(IRuntimeSessionService),
			accessor.get(IRuntimeStartupService),
			accessor.get(IWorkspaceTrustManagementService),
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

// Register the actions defined above.
registerAction2(PositronNewFolderFromTemplateAction);
registerAction2(PositronNewFolderFromGitAction);
registerAction2(PositronOpenFolderInNewWindowAction);
