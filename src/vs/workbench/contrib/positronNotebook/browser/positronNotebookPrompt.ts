/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Categories } from '../../../../platform/action/common/actionCommonCategories.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { POSITRON_NOTEBOOK_ENABLED_KEY } from '../common/positronNotebookConfig.js';
import { URI } from '../../../../base/common/uri.js';

const NOTEBOOK_PROMPT_DISMISSED_KEY = 'positron.notebook.promptDismissed';

/**
 * Workbench contribution that prompts users to try the new Positron notebook editor
 * when they open a .ipynb file without having the new notebook editor enabled.
 */
export class PositronNotebookPromptContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNotebookPrompt';

	private static _instance: PositronNotebookPromptContribution | undefined;

	private _shownThisSession = false;

	/**
	 * Resets the session flag so the prompt can be shown again in the current session.
	 */
	static resetSessionFlag(): void {
		if (PositronNotebookPromptContribution._instance) {
			PositronNotebookPromptContribution._instance._shownThisSession = false;
		}
	}

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService private readonly openerService: IOpenerService,
	) {
		super();

		PositronNotebookPromptContribution._instance = this;

		this._register(this.editorService.onDidActiveEditorChange(() => {
			this._checkAndPrompt();
		}));
	}

	private _checkAndPrompt(): void {
		// Check if we've already shown the notification this session
		if (this._shownThisSession) {
			return;
		}

		// Check if the active editor is a notebook
		const activeEditor = this.editorService.activeEditor;
		if (!activeEditor?.resource?.path.endsWith('.ipynb')) {
			return;
		}

		// Check if the new notebook editor is already enabled
		const notebookEnabled = this.configurationService.getValue<boolean>(POSITRON_NOTEBOOK_ENABLED_KEY);
		if (notebookEnabled) {
			return;
		}

		// Check if user has permanently dismissed the prompt
		const dismissed = this.storageService.getBoolean(NOTEBOOK_PROMPT_DISMISSED_KEY, StorageScope.PROFILE, false);
		if (dismissed) {
			return;
		}

		this._shownThisSession = true;

		// Show the notification
		this.notificationService.prompt(
			Severity.Info,
			localize(
				'positron.notebook.prompt',
				'Positron has a new editor for Jupyter notebooks designed with out-of-the-box integrated data exploration, AI assistance that understands notebooks, debugging, and more.'
			),
			[
				{
					label: localize('positron.notebook.prompt.learnMore', 'Learn more'),
					run: () => {
						this.openerService.open(URI.parse('https://positron.posit.co/positron-notebook-editor'));
					}
				},
				{
					label: localize('positron.notebook.prompt.tryNow', 'Try now'),
					run: () => {
						this.commandService.executeCommand('workbench.action.openSettings', 'positron.notebook.enabled');
					}
				},
				{
					label: localize('positron.notebook.prompt.later', 'Later'),
					run: () => { }
				},
				{
					label: localize('positron.notebook.prompt.dontShowAgain', "Don't show again"),
					run: () => {
						this.storageService.store(NOTEBOOK_PROMPT_DISMISSED_KEY, true, StorageScope.PROFILE, StorageTarget.USER);
					}
				}
			],
			{
				sticky: true,
				onCancel: () => { }
			}
		);
	}
}

/**
 * Action to reset the notebook prompt so it shows again.
 * Useful for testing or if users change their mind.
 */
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'positron.notebook.resetPrompt',
			title: localize2('positron.notebook.resetPrompt', 'Reset Positron Notebook Prompt'),
			category: Categories.Developer,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		const storageService = accessor.get(IStorageService);
		const notificationService = accessor.get(INotificationService);

		storageService.store(NOTEBOOK_PROMPT_DISMISSED_KEY, false, StorageScope.PROFILE, StorageTarget.USER);
		PositronNotebookPromptContribution.resetSessionFlag();
		notificationService.info(localize('positron.notebook.promptReset', 'Notebook prompt has been reset. Open a notebook to see the prompt again.'));
	}
});
