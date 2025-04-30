/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IPathService } from '../../../services/path/common/pathService.js';
import { PositronImportSettings, ResetPositronImportPrompt } from './actions.js';
import { getCodeSettingsPath, getImportWasPrompted, promptImport } from './helpers.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const POSITRON_SETTINGS_IMPORT_ENABLE_KEY = 'positron.importSettings.enable';
class PositronWelcomeContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IPathService private readonly pathService: IPathService,
		@IFileService private readonly fileService: IFileService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		if (isWeb) {
			return;
		}

		const enabledGlobally = this.configurationService.getValue<boolean>(POSITRON_SETTINGS_IMPORT_ENABLE_KEY);

		if (enabledGlobally === false) {
			return;
		}

		getCodeSettingsPath(this.pathService).then(async (codeSettingsPath) => {
			const codeSettingsExist = await this.fileService.exists(codeSettingsPath);

			this.contextKeyService.createKey('positron.settingsImport.hasCodeSettings', codeSettingsExist);
			this.registerActions();

			const alreadyPrompted = await getImportWasPrompted(this.storageService);

			if (codeSettingsExist && !alreadyPrompted) {
				promptImport(
					this.storageService,
					this.notificationService,
					this.commandService,
				);
			}
		});
	}

	private registerActions(): void {
		this._register(registerAction2(PositronImportSettings));
		this._register(registerAction2(ResetPositronImportPrompt));
	}
}

registerWorkbenchContribution2('positron.welcome', PositronWelcomeContribution, WorkbenchPhase.Eventually);

// Register the configuration setting
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		properties: {
			[POSITRON_SETTINGS_IMPORT_ENABLE_KEY]: {
				type: 'boolean',
				default: true,
				description: localize('positron.importSettings.enable', "Should Positron allow users to import settings from Visual Studio Code. Requires a restart to take effect."),
				doNotSuggest: true,
				scope: ConfigurationScope.APPLICATION_MACHINE
			}
		}
	});
