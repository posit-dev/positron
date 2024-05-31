/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationRegistry,
} from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { positronConfigurationNodeBase } from 'vs/workbench/services/languageRuntime/common/languageRuntime';

// Key for the configuration setting
export const USE_POSITRON_PROJECT_WIZARD_CONFIG_KEY =
	'positron.work-In-ProgressProjectWizardFeatures';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * work-in-progress features in the Positron Project Wizard.
 * @param configurationService The configuration service
 * @returns Whether to enable work-in-progress Positron Project Wizard features
 */
export function projectWizardWorkInProgressEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_POSITRON_PROJECT_WIZARD_CONFIG_KEY)
	);
}

// Register the configuration setting
const configurationRegistry = Registry.as<IConfigurationRegistry>(
	Extensions.Configuration
);
configurationRegistry.registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[USE_POSITRON_PROJECT_WIZARD_CONFIG_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.enablePositronProjectWizardWorkInProgress',
				'**CAUTION**: Enable work-in-progress Project Wizard features which may result in unexpected behaviour.'
			),
		},
	},
});
