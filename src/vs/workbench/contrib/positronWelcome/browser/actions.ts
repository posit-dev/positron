/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { localize } from '../../../../nls.js';
import { Action2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { COMPARE_WITH_SAVED_COMMAND_ID } from '../../files/browser/fileConstants.js';
import { getCodeSettingsPath, setImportWasPrompted } from './helpers.js';

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
				value: localize('positron.importSettings', "Import Settings..."),
				original: 'Import Settings...'
			},
			category: 'Preferences',
			f1: true,
			precondition: ContextKeyExpr.equals('positron.settingsImport.hasCodeSettings', true),
		});
	}

	/**
	 * Runs action.
	 * @param accessor The services accessor.
	 */
	override async run(accessor: ServicesAccessor): Promise<void> {
		const pathService = accessor.get(IPathService);
		const commandService = accessor.get(ICommandService);
		const prefService = accessor.get(IPreferencesService);
		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);
		const loggingService = accessor.get(ILogService);

		const positronSettingsPath = await prefService.getEditableSettingsURI(ConfigurationTarget.USER);
		if (!positronSettingsPath) {
			loggingService.trace('No Positron settings found');
			return;
		}

		const codeSettingsPath = await getCodeSettingsPath(pathService);
		if (!codeSettingsPath) {
			loggingService.trace('No Visual Studio Code settings found');
			return;
		}
		console.log(`Looking for settings at: ${codeSettingsPath.fsPath}`);

		const codeSettingsContent = await fileService
			.readFile(codeSettingsPath)
			.then(content => content.value.toString());


		if (await fileService.exists(positronSettingsPath)) {
			await commandService.executeCommand(COMPARE_WITH_SAVED_COMMAND_ID, positronSettingsPath);
			console.log(`Positron settings already exist at: ${positronSettingsPath.fsPath}`);
		} else {
			await fileService.createFile(positronSettingsPath);
			await editorService.openEditor({
				resource: positronSettingsPath
			});
			console.log(`Positron settings created at: ${positronSettingsPath.fsPath}`);
		}

		const editor = editorService.activeEditor;
		const model = editorService.activeTextEditorControl?.getModel();

		if (model && 'original' in model && 'modified' in model) {
			model.modified.setValue('// Settings imported from Visual Studio Code\n' + codeSettingsContent);
		} else if (model && 'setValue' in model) {
			model.setValue('// Settings imported from Visual Studio Code\n' + codeSettingsContent);
		}

		const disposables = new DisposableStore();

		const notification = notificationService.prompt(
			Severity.Info,
			localize('positron.importSettingsPrompt', "Save imported Visual Studio Code settings?"),
			[
				{
					label: localize('positron.importSettings.acceptLabel', "Accept"), run: async () => {
						await editor?.save(0);
						await editor?.dispose();

						disposables.dispose();
					}
				},
				{
					label: localize('positron.importSettings.rejecttLabel', "Reject"), run: async () => {
						await editor?.revert(0);
						await editor?.dispose();

						disposables.dispose();
					}
				},
			],
			{
				sticky: true
			}
		);

		disposables.add(
			editorService.onDidCloseEditor(e => {
				if (e.editor.editorId === editor?.editorId) {
					notification.close();
					disposables.dispose();
				}
			})
		);

		if (editor) {
			disposables.add(
				editor.onDidChangeDirty(() => {
					if (!editor.isDirty()) {
						notification.close();
						disposables.dispose();
					}
				})
			);
		}
	}
}

export class ResetPositronImportPrompt extends Action2 {
	static readonly ID = 'positron.workbench.action.resetImportPrompt';

	constructor() {
		super({
			id: ResetPositronImportPrompt.ID,
			title: {
				value: localize(
					'positron.settingsImport.resetImportPrompt',
					"Reset Import Settings Prompt"
				),
				original: 'Reset Import Settings Prompt'
			},
			category: 'Preferences',
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const storageService = accessor.get(IStorageService);
		setImportWasPrompted(storageService, false);
	}
}
