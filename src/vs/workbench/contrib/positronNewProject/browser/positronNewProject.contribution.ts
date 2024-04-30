/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { InstantiationType, registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { NewProjectConfiguration } from 'vs/workbench/browser/positronNewProjectWizard/interfaces/newProjectConfiguration';
import { IWorkbenchContribution, WorkbenchPhase, registerWorkbenchContribution2 } from 'vs/workbench/common/contributions';
import { ILifecycleService, LifecyclePhase, StartupKind } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { projectWizardEnabled } from 'vs/workbench/services/positronNewProject/common/positronNewProjectEnablement';
import { IPositronNewProjectService, PositronNewProjectService } from 'vs/workbench/services/positronNewProject/common/positronNewProjectService';

// Register the Positron New Project service
registerSingleton(IPositronNewProjectService, PositronNewProjectService, InstantiationType.Delayed);

/**
 * PositronNewProjectContribution class.
 */
class PositronNewProjectContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.positronNewProject';

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
	) {
		super();
		// TODO: [New Project] Remove feature flag when New Project action is ready for release
		if (projectWizardEnabled(this._contextKeyService, this._configurationService)) {
			// Whether the project was opened in a new window or the existing window, the startup kind
			// will be `StartupKind.NewWindow`.
			if (this._lifecycleService.startupKind === StartupKind.NewWindow) {
				this.run().then(undefined, onUnexpectedError);
			}
		}
	}

	// TODO: move some of this logic to the PositronNewProjectService
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
			// TODO: Do new project initialization

			// Once initialization is done, remove the new project configuration from storage
			this._storageService.remove('positron.newProjectConfig', StorageScope.APPLICATION);
		}
	}
}

// Register the PositronNewProjectContribution
registerWorkbenchContribution2(PositronNewProjectContribution.ID, PositronNewProjectContribution, WorkbenchPhase.AfterRestored);
