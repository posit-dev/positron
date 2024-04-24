/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
// import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectConfiguration';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';
import { ILifecycleService, LifecyclePhase, StartupKind } from 'vs/workbench/services/lifecycle/common/lifecycle';
// import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

class PositronNewProjectContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNewProject';

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		// @ICommandService private readonly _commandService: ICommandService,
		// @IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
	) {
		super();
		console.log('PositronNewProjectContribution constructor');
		// TODO: remove dev build feature flag
		if (IsDevelopmentContext.getValue(this._contextKeyService) === true) {
			console.log('PositronNewProjectContribution dev build');
			// Whether the project was opened in a new window or the existing window, the startup kind
			// will be `StartupKind.NewWindow`.
			if (this._lifecycleService.startupKind === StartupKind.NewWindow) {
				console.log('PositronNewProjectContribution new window');
				this.run().then(undefined, onUnexpectedError);
			} else {
				console.log('PositronNewProjectContribution not new window: ', this._lifecycleService.startupKind);
			}
		}
	}

	private async run() {
		// Not sure if needed: wait until after the workbench has been restored
		await this._lifecycleService.when(LifecyclePhase.Restored);

		const newProjectConfigStr = this._storageService.get('positron.newProjectConfig', StorageScope.APPLICATION);

		if (!newProjectConfigStr) {
			this._logService.error('No new project configuration found in storage');
			return;
		}

		const newProjectConfig = JSON.parse(newProjectConfigStr) as NewProjectConfiguration;
		const newProjectPath = newProjectConfig.projectFolder;
		const currentFolderPath = this._contextService.getWorkspace().folders[0].uri.fsPath;

		if (newProjectPath === currentFolderPath) {
			console.log('New project path matches current workspace folder path!');

			// Do new project initialization

			// Remove the new project configuration from storage
			this._storageService.remove('positron.newProjectConfig', StorageScope.APPLICATION);
		} else {
			console.log('New project path does not match current workspace folder path');
			console.log('\tNew project path:', newProjectPath);
			console.log('\tCurrent workspace folder path:', currentFolderPath);
		}

	}
}

registerWorkbenchContribution2(PositronNewProjectContribution.ID, PositronNewProjectContribution, WorkbenchPhase.AfterRestored);
